import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const PRODUCT_DIRECTORY = fileURLToPath(
  new URL("../../src/v2/product/", import.meta.url),
);

const BANNED_IMPORT_DIRECTORY =
  /(?:^|[/\\])(?:config(?:\.[^/\\]+)?|providers?|model)(?:$|[/\\])/iu;
const BANNED_PROVIDER_MODULE =
  /(?:^|[/\\.-])(?:provider|deepseek)(?:$|[/\\.-])/iu;
const BANNED_CAPTURE_PATH =
  /(?:\.runtime[/\\]|(?:expected|locked|followups)(?:[/\\][^\s"'`)]*|\.(?:json|m?js)))/iu;

function importSpecifiers(source) {
  return [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/gu),
    ...source.matchAll(/\bimport\s+["']([^"']+)["']/gu),
  ].map((match) => match[1]);
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|[^:])\/\/.*$/gmu, "$1");
}

async function productEntries() {
  const names = await readdir(PRODUCT_DIRECTORY);
  return names
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(PRODUCT_DIRECTORY, name));
}

async function collectProductImportGraph() {
  const pending = await productEntries();
  const visited = new Map();

  while (pending.length > 0) {
    const file = path.resolve(pending.pop());
    if (visited.has(file)) continue;
    const source = await readFile(file, "utf8");
    visited.set(file, source);

    const executableSource = stripComments(source);
    assert.doesNotMatch(executableSource, /\bimport\s*\(/u, `${file}: dynamic import`);
    assert.doesNotMatch(executableSource, /\brequire\s*\(/u, `${file}: require`);
    assert.doesNotMatch(
      executableSource,
      /\bprocess\s*(?:\.\s*env|\[\s*["']env["']\s*\])/u,
      `${file}: environment access`,
    );
    assert.doesNotMatch(
      executableSource,
      /\b(?:globalThis\s*\.\s*)?fetch\s*\(/u,
      `${file}: fetch`,
    );
    assert.doesNotMatch(executableSource, BANNED_CAPTURE_PATH, `${file}: legacy data path`);

    for (const specifier of importSpecifiers(source)) {
      assert.doesNotMatch(specifier, BANNED_IMPORT_DIRECTORY, `${file}: ${specifier}`);
      assert.doesNotMatch(specifier, BANNED_PROVIDER_MODULE, `${file}: ${specifier}`);
      assert.doesNotMatch(specifier, BANNED_CAPTURE_PATH, `${file}: ${specifier}`);
      if (!specifier.startsWith(".")) continue;
      const resolved = path.resolve(path.dirname(file), specifier);
      assert.doesNotMatch(resolved, BANNED_IMPORT_DIRECTORY, `${file}: ${resolved}`);
      assert.doesNotMatch(resolved, BANNED_PROVIDER_MODULE, `${file}: ${resolved}`);
      assert.doesNotMatch(resolved, BANNED_CAPTURE_PATH, `${file}: ${resolved}`);
      pending.push(resolved);
    }
  }
  return visited;
}

test("the complete Phase 2A-O product import graph stays offline and answer-free", async () => {
  const entries = await productEntries();
  const graph = await collectProductImportGraph();

  assert.ok(entries.length >= 10);
  for (const entry of entries) {
    assert.ok(graph.has(path.resolve(entry)), entry);
  }
  assert.ok(graph.size > entries.length);
});

test("the product graph never performs network access while modules are inspected", async (t) => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network is forbidden in Phase 2A-O");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await collectProductImportGraph();
  assert.equal(fetchCalls, 0);
});
