import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  loadPhase2DevelopmentInputs,
  PHASE2_DEVELOPMENT_SNAPSHOT_URL,
} from "../../src/v2/phase2/development-input-loader.js";

const MODEL_PATH_ENTRIES = [
  fileURLToPath(
    new URL("../../src/v2/phase2/development-input-loader.js", import.meta.url),
  ),
  fileURLToPath(
    new URL("../../src/v2/phase2/phase2-model-input-validator.js", import.meta.url),
  ),
  fileURLToPath(
    new URL(
      "../../src/v2/validation/phase2-core-candidate-validator.js",
      import.meta.url,
    ),
  ),
];
const OFFLINE_RUNNER_ENTRY = fileURLToPath(
  new URL("../../src/v2/phase2/run-phase2a-offline.js", import.meta.url),
);

const BANNED_IMPORT_PATHS = [
  "/src/v2/phase2/development-input-snapshot-builder.js",
  "/src/v2/phase2/core-overlap-oracle-projector.js",
  "/src/v2/phase2/core-semantic-evaluator.js",
  "/src/v2/phase2/phase2-evaluation-truth-manifest.js",
  "/src/v2/model/",
  "/src/agent/deepseek-responses-client.js",
  "/src/server.js",
  "/src/config.js",
  "/scripts/",
];

const BANNED_BUILTINS = new Set([
  "http",
  "https",
  "http2",
  "net",
  "tls",
  "dns",
  "dgram",
  "child_process",
  "node:http",
  "node:https",
  "node:http2",
  "node:net",
  "node:tls",
  "node:dns",
  "node:dgram",
  "node:child_process",
]);

const ALLOWED_EXTERNAL_IMPORTS = new Set(["ajv/dist/2020.js"]);
const ALLOWED_BUILTINS = new Set([
  "node:crypto",
  "node:fs/promises",
  "node:path",
  "node:url",
]);

const OFFLINE_RUNNER_BANNED_IMPORT_PATHS = [
  "/src/v2/model/",
  "/src/agent/deepseek-responses-client.js",
  "/src/server.js",
  "/src/config.js",
  "/public/",
];

function importSpecifiers(source) {
  return [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/gu),
    ...source.matchAll(/\bimport\s+["']([^"']+)["']/gu),
  ].map((match) => match[1]);
}

async function collectImportGraph(
  entries,
  { bannedImportPaths = BANNED_IMPORT_PATHS } = {},
) {
  const pending = [...entries];
  const visited = new Map();

  while (pending.length > 0) {
    const file = path.resolve(pending.pop());
    if (visited.has(file)) continue;
    const source = await readFile(file, "utf8");
    visited.set(file, source);
    assert.doesNotMatch(source, /\bimport\s*\(/u, `${file}: dynamic import`);
    assert.doesNotMatch(source, /\brequire\s*\(/u, `${file}: require`);

    for (const specifier of importSpecifiers(source)) {
      assert.equal(
        BANNED_BUILTINS.has(specifier),
        false,
        `model path imports forbidden network/process builtin: ${specifier}`,
      );
      if (!specifier.startsWith(".")) {
        assert.equal(
          ALLOWED_EXTERNAL_IMPORTS.has(specifier) ||
            ALLOWED_BUILTINS.has(specifier),
          true,
          `model path imports an unapproved external or aliased module: ${specifier}`,
        );
        continue;
      }
      const resolved = path.resolve(path.dirname(file), specifier);
      for (const banned of bannedImportPaths) {
        assert.equal(
          resolved.includes(banned),
          false,
          `model path reaches evaluation/provider module: ${resolved}`,
        );
      }
      pending.push(resolved);
    }
  }

  return visited;
}

function hasKeyRecursively(value, prohibitedKey) {
  if (Array.isArray(value)) {
    return value.some((item) => hasKeyRecursively(item, prohibitedKey));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).some(
      ([key, child]) =>
        key === prohibitedKey || hasKeyRecursively(child, prohibitedKey),
    );
  }
  return false;
}

test("production Model Input path cannot reach snapshot builder, fixture projector, Oracle, or provider", async () => {
  const graph = await collectImportGraph(MODEL_PATH_ENTRIES);
  assert.ok(graph.size >= MODEL_PATH_ENTRIES.length);

  for (const [file, source] of graph) {
    assert.doesNotMatch(source, /\bprocess\.env\b/u, file);
    assert.doesNotMatch(source, /--env-file|dotenv\.config/u, file);
    assert.doesNotMatch(source, /base-development\.json/u, file);
  }

  const loaderPath = MODEL_PATH_ENTRIES[0];
  const loaderSource = graph.get(loaderPath);
  assert.ok(loaderSource);
  assert.doesNotMatch(
    loaderSource,
    /development-input-snapshot-builder|projectPhase2DevelopmentInput/u,
  );
  assert.doesNotMatch(loaderSource, /base-development\.json/u);
});

test("fixed Phase 2A CLI import graph has no provider, config, env, network, or listener path", async () => {
  const graph = await collectImportGraph([OFFLINE_RUNNER_ENTRY], {
    bannedImportPaths: OFFLINE_RUNNER_BANNED_IMPORT_PATHS,
  });
  assert.ok(graph.has(path.resolve(OFFLINE_RUNNER_ENTRY)));

  for (const [file, source] of graph) {
    assert.doesNotMatch(source, /\bprocess\.env\b/u, file);
    assert.doesNotMatch(source, /--env-file|dotenv\.config/u, file);
    assert.doesNotMatch(
      source,
      /\b(?:globalThis\.)?(?:fetch|WebSocket|EventSource)\b/u,
      file,
    );
    assert.doesNotMatch(source, /\.listen\s*\(/u, file);
  }
});

test("production Loader opens only the fixed answer-free snapshot and exposes no expected data", async (t) => {
  const opened = [];
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network is forbidden in Phase 2A");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const inputs = await loadPhase2DevelopmentInputs({
    readFileImpl: async (url, encoding) => {
      opened.push(url.href);
      return await readFile(url, encoding);
    },
  });

  assert.equal(inputs.length, 16);
  assert.deepEqual(opened, [PHASE2_DEVELOPMENT_SNAPSHOT_URL.href]);
  assert.equal(fetchCalls, 0);
  assert.equal(hasKeyRecursively(inputs, "expected"), false);
  assert.equal(hasKeyRecursively(inputs, "oracle"), false);
  assert.doesNotMatch(
    JSON.stringify(inputs),
    /base-development|base-locked|mutations\.locked|state-transitions\.locked|followups\.json/iu,
  );
});
