import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const CAPTURE_ENTRY = fileURLToPath(
  new URL(
    "../../src/v2/phase2rb/phase2rb-candidate-capture.js",
    import.meta.url,
  ),
);
const EVALUATION_ENTRIES = [
  fileURLToPath(
    new URL(
      "../../src/v2/phase2rb/phase2rb-evaluation-runner.js",
      import.meta.url,
    ),
  ),
  fileURLToPath(
    new URL("../../src/v2/phase2rb/run-phase2rb-evaluate.js", import.meta.url),
  ),
];

const NETWORK_OR_PROCESS_BUILTINS = new Set([
  "child_process",
  "dgram",
  "dns",
  "http",
  "http2",
  "https",
  "net",
  "tls",
  "node:child_process",
  "node:dgram",
  "node:dns",
  "node:http",
  "node:http2",
  "node:https",
  "node:net",
  "node:tls",
]);

const CAPTURE_BANNED_PATHS = [
  "/docs/fixtures/",
  "/src/services/",
  "/src/server.js",
  "/public/",
  "/src/v2/phase2/core-overlap-oracle-projector.js",
  "/src/v2/phase2/core-semantic-evaluator.js",
  "/src/v2/phase2/phase2-evaluation-truth-loader.js",
  "/src/v2/phase2/phase2-evaluation-truth-manifest.js",
  "/src/v2/phase2rb/phase2rb-evaluation-runner.js",
  "/src/v2/phase2rb/run-phase2rb-evaluate.js",
];

const EVALUATION_BANNED_PATHS = [
  "/src/agent/",
  "/src/config.js",
  "/src/services/",
  "/src/server.js",
  "/public/",
  "/src/v2/model/",
  "/src/v2/phase2rb/phase2rb-candidate-capture.js",
  "/src/v2/phase2rb/phase2rb-deepseek-config.js",
  "/src/v2/phase2rb/phase2rb-git-preflight.js",
  "/src/v2/phase2rb/run-phase2rb-deepseek.js",
];

function importSpecifiers(source) {
  return [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/gu),
    ...source.matchAll(/\bimport\s+["']([^"']+)["']/gu),
  ].map((match) => match[1]);
}

function portablePath(filePath) {
  return path.resolve(filePath).split(path.sep).join("/");
}

async function collectImportGraph(entries, { bannedPaths, bannedBuiltins }) {
  const pending = [...entries];
  const visited = new Map();
  while (pending.length > 0) {
    const file = path.resolve(pending.pop());
    if (visited.has(file)) continue;
    const source = await readFile(file, "utf8");
    visited.set(file, source);
    assert.doesNotMatch(source, /\bimport\s*\(|\brequire\s*\(/u, file);

    for (const specifier of importSpecifiers(source)) {
      assert.equal(
        bannedBuiltins.has(specifier),
        false,
        `${file}: forbidden builtin ${specifier}`,
      );
      if (!specifier.startsWith(".")) continue;
      const resolved = path.resolve(path.dirname(file), specifier);
      const portable = portablePath(resolved);
      for (const bannedPath of bannedPaths) {
        assert.equal(
          portable.includes(bannedPath),
          false,
          `${file}: import graph reaches ${portable}`,
        );
      }
      pending.push(resolved);
    }
  }
  return visited;
}

test("Phase 2R-B Capture graph cannot reach expected truth, Oracle, evaluator, locked data, or services", async () => {
  const graph = await collectImportGraph([CAPTURE_ENTRY], {
    bannedPaths: CAPTURE_BANNED_PATHS,
    bannedBuiltins: new Set(["child_process", "node:child_process"]),
  });
  assert.ok(graph.has(path.resolve(CAPTURE_ENTRY)));
  for (const [file, source] of graph) {
    assert.doesNotMatch(
      source,
      /base-development\.json|base-locked\.json|mutations\.locked\.json|state-transitions\.locked\.json|followups\.json/iu,
      file,
    );
    assert.doesNotMatch(source, /\.listen\s*\(/u, file);
  }
});

test("Phase 2R-B Evaluation graph cannot reach Key, config, provider client, network, listener, or child process", async () => {
  const graph = await collectImportGraph(EVALUATION_ENTRIES, {
    bannedPaths: EVALUATION_BANNED_PATHS,
    bannedBuiltins: NETWORK_OR_PROCESS_BUILTINS,
  });
  for (const entry of EVALUATION_ENTRIES) {
    assert.ok(graph.has(path.resolve(entry)));
  }
  for (const [file, source] of graph) {
    assert.doesNotMatch(
      source,
      /\bprocess\.env\b|--env-file|dotenv(?:\/config|\.config)|loadPhase2rbDeepSeekConfig/u,
      file,
    );
    assert.doesNotMatch(
      source,
      /\b(?:globalThis\.)?(?:fetch|WebSocket|EventSource)\b|\.listen\s*\(/u,
      file,
    );
  }
});
