import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const entries = [
  "../../src/v2/phase2rc/phase2rc-request-contract.js",
  "../../src/v2/phase2rc/phase2rc-semantic-gate.js",
].map((specifier) => fileURLToPath(new URL(specifier, import.meta.url)));

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

test("Phase 2R-C implementation graph is offline-only and answer-free", async () => {
  const pending = [...entries];
  const visited = new Set();
  while (pending.length > 0) {
    const file = path.resolve(pending.pop());
    if (visited.has(file)) continue;
    visited.add(file);
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /\bimport\s*\(|\brequire\s*\(/u, file);
    assert.doesNotMatch(
      source,
      /\bprocess\.env\b|--env-file|dotenv|\.listen\s*\(|\bfetch\s*\(/u,
      file,
    );
    assert.doesNotMatch(
      source,
      /base-development|base-locked|evaluation|capture|deepseek-responses-client|src\/server|src\/config/u,
      file,
    );
    for (const specifier of imports(source)) {
      assert.equal(bannedBuiltins.has(specifier), false, specifier);
      if (specifier.startsWith(".")) {
        pending.push(path.resolve(path.dirname(file), specifier));
      }
    }
  }
  assert.ok(visited.size >= entries.length);
});
