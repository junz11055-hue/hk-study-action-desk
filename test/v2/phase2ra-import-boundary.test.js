import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  loadPhase2rDevelopmentInputs,
  PHASE2R_SOURCE_CONTEXT_SNAPSHOT_URL,
} from "../../src/v2/phase2r/phase2r-development-input-loader.js";

const entries = [
  fileURLToPath(
    new URL(
      "../../src/v2/phase2r/phase2r-development-input-loader.js",
      import.meta.url,
    ),
  ),
  fileURLToPath(
    new URL(
      "../../src/v2/phase2r/phase2r-model-input-validator.js",
      import.meta.url,
    ),
  ),
];

const adapterEntry = fileURLToPath(
  new URL(
    "../../src/v2/model/phase2r-core-model-adapter.js",
    import.meta.url,
  ),
);

const bannedBuiltins = new Set([
  "http", "https", "http2", "net", "tls", "dns", "dgram",
  "node:http", "node:https", "node:http2", "node:net", "node:tls",
  "node:dns", "node:dgram", "child_process", "node:child_process",
]);

function imports(source) {
  return [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/gu),
    ...source.matchAll(/\bimport\s+["']([^"']+)["']/gu),
  ].map((match) => match[1]);
}

async function importGraph() {
  const pending = [...entries];
  const visited = new Map();
  while (pending.length > 0) {
    const file = path.resolve(pending.pop());
    if (visited.has(file)) continue;
    const source = await readFile(file, "utf8");
    visited.set(file, source);
    assert.doesNotMatch(source, /\bimport\s*\(|\brequire\s*\(/u, file);
    for (const specifier of imports(source)) {
      assert.equal(bannedBuiltins.has(specifier), false, specifier);
      if (!specifier.startsWith(".")) continue;
      const resolved = path.resolve(path.dirname(file), specifier);
      assert.doesNotMatch(
        resolved,
        /development-input-snapshot-builder|source-context-builder|core-overlap-oracle|semantic-evaluator|evaluation-truth|src\/v2\/model|deepseek-responses-client|src\/server|src\/config|scripts/u,
      );
      pending.push(resolved);
    }
  }
  return visited;
}

async function adapterImportGraph() {
  const pending = [adapterEntry];
  const visited = new Map();
  while (pending.length > 0) {
    const file = path.resolve(pending.pop());
    if (visited.has(file)) continue;
    const source = await readFile(file, "utf8");
    visited.set(file, source);
    assert.doesNotMatch(source, /\bimport\s*\(|\brequire\s*\(/u, file);
    for (const specifier of imports(source)) {
      if (!specifier.startsWith(".")) continue;
      pending.push(path.resolve(path.dirname(file), specifier));
    }
  }
  return visited;
}

function hasKey(value, target) {
  if (Array.isArray(value)) return value.some((item) => hasKey(item, target));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, child]) => key === target || hasKey(child, target),
  );
}

test("Phase 2R Input graph cannot reach answers, provider, config, network, or services", async () => {
  const graph = await importGraph();
  for (const [file, source] of graph) {
    assert.doesNotMatch(source, /\bprocess\.env\b|--env-file|dotenv\.config/u, file);
    assert.doesNotMatch(source, /base-development|base-locked|mutations\.locked/u, file);
    assert.doesNotMatch(source, /\bfetch\s*\(|\.listen\s*\(/u, file);
  }
});

test("Phase 2R adapter graph has no environment loader, service, or dynamic import path", async () => {
  const graph = await adapterImportGraph();
  for (const [file, source] of graph) {
    assert.doesNotMatch(
      source,
      /\bprocess\.env\b|--env-file|dotenv(?:\/config|\.config)|src\/server|\.listen\s*\(/u,
      file,
    );
  }
});

test("Phase 2R offline loader performs zero network calls and exposes no answer fields", async (t) => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network forbidden");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const inputs = await loadPhase2rDevelopmentInputs();
  assert.equal(inputs.length, 16);
  assert.equal(fetchCalls, 0);
  assert.equal(hasKey(inputs, "expected"), false);
  assert.equal(hasKey(inputs, "oracle"), false);
  assert.match(PHASE2R_SOURCE_CONTEXT_SNAPSHOT_URL.href, /phase2r-source-context-v1\.json$/u);
});
