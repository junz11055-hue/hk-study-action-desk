import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const CAPTURE_ENTRY = fileURLToPath(
  new URL("../../src/v2/phase2/run-phase2b-deepseek.js", import.meta.url),
);
const EVALUATION_ENTRY = fileURLToPath(
  new URL("../../src/v2/phase2/run-phase2b-evaluate.js", import.meta.url),
);
const ALLOWED_EXTERNALS = new Set(["ajv/dist/2020.js"]);
const ALLOWED_BUILTINS = new Set([
  "node:child_process",
  "node:crypto",
  "node:fs",
  "node:fs/promises",
  "node:path",
  "node:url",
  "node:util",
]);

function importSpecifiers(source) {
  return [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/gu),
    ...source.matchAll(/\bimport\s+["']([^"']+)["']/gu),
  ].map((match) => match[1]);
}

async function importGraph(entry) {
  const pending = [entry];
  const graph = new Map();
  while (pending.length > 0) {
    const file = path.resolve(pending.pop());
    if (graph.has(file)) continue;
    const source = await readFile(file, "utf8");
    graph.set(file, source);
    assert.doesNotMatch(source, /\bimport\s*\(/u, `${file}: dynamic import`);
    assert.doesNotMatch(source, /\brequire\s*\(/u, `${file}: require`);
    for (const specifier of importSpecifiers(source)) {
      if (!specifier.startsWith(".")) {
        assert.equal(
          ALLOWED_EXTERNALS.has(specifier) || ALLOWED_BUILTINS.has(specifier),
          true,
          `${file}: unapproved import ${specifier}`,
        );
        continue;
      }
      pending.push(path.resolve(path.dirname(file), specifier));
    }
  }
  return graph;
}

test("Phase 2B capture process cannot reach expected, Oracle, or evaluator", async () => {
  const graph = await importGraph(CAPTURE_ENTRY);
  const paths = [...graph.keys()].join("\n");
  assert.doesNotMatch(
    paths,
    /core-overlap-oracle-projector|core-semantic-evaluator|phase2-evaluation-truth|phase2b-evaluation-runner|run-phase2b-evaluate/u,
  );
  for (const [file, source] of graph) {
    assert.doesNotMatch(source, /base-development\.json|\.locked\.json/u, file);
  }
  const captureSource = graph.get(
    fileURLToPath(
      new URL("../../src/v2/phase2/phase2b-candidate-capture.js", import.meta.url),
    ),
  );
  assert.ok(captureSource);
  assert.doesNotMatch(captureSource, /\.createStructured\s*\(/u);
  assert.match(captureSource, /analyzePhase2CoreCandidate/u);
});

test("Phase 2B evaluation process cannot reach Key, provider, network, or listener", async () => {
  const graph = await importGraph(EVALUATION_ENTRY);
  const paths = [...graph.keys()].join("\n");
  assert.doesNotMatch(
    paths,
    /deepseek-responses-client|phase1-core-model-adapter|phase2-core-model-adapter|phase2b-deepseek-config|phase2b-git-preflight|run-phase2b-deepseek/u,
  );
  for (const [file, source] of graph) {
    assert.doesNotMatch(source, /\bprocess\.env\b|loadEnvFile|\.listen\s*\(/u, file);
    assert.doesNotMatch(
      source,
      /\b(?:globalThis\.)?(?:fetch|WebSocket|EventSource)\b/u,
      file,
    );
    assert.doesNotMatch(source, /node:child_process/u, file);
  }
});
