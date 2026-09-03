import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { hashUtf8 } from "../validation/canonical-json.js";
import { PHASE2AL_REPOSITORY_ROOT } from "./phase2al-deepseek-config.js";

const execFileAsync = promisify(execFile);
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ALLOWED_UNTRACKED = Object.freeze([
  "AI产品Vibe Coding通用前端技术栈手册.md",
  "后端-前端.png",
]);

export const PHASE2AL_IMPLEMENTATION_MANIFEST_PATH = "src/v2/phase2al/phase2al-implementation-manifest.json";

export class Phase2alImplementationPreflightError extends Error {
  constructor(options = {}) {
    super("Phase 2A-L requires the approved frozen implementation commit.", options);
    this.name = "Phase2alImplementationPreflightError";
    this.code = "implementation_not_frozen";
  }
}
function fail(cause) {
  throw new Phase2alImplementationPreflightError(
    cause === undefined ? {} : { cause },
  );
}

function output(result) {
  return typeof result === "string" ? result : result?.stdout ?? "";
}

function assertStatus(source) {
  const records = source.split("\0").filter(Boolean);
  const expected = new Set(ALLOWED_UNTRACKED.map((file) => `?? ${file}`));
  if (
    records.length !== expected.size ||
    records.some((record) => !expected.delete(record)) ||
    expected.size !== 0
  ) {
    fail();
  }
}

async function loadAndVerifyManifest(repositoryRoot, readFileImpl) {
  let manifest;
  try {
    manifest = JSON.parse(
      await readFileImpl(
        path.join(repositoryRoot, PHASE2AL_IMPLEMENTATION_MANIFEST_PATH),
        "utf8",
      ),
    );
  } catch (error) {
    fail(error);
  }
  const entries = manifest?.files;
  if (
    manifest?.manifestVersion !== "phase2al-implementation-manifest-v1" ||
    !Array.isArray(entries) ||
    entries.length < 8
  ) {
    fail();
  }
  const seen = new Set();
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry.path !== "string" ||
      !/^(?:src|frontend)\//u.test(entry.path) ||
      entry.path.includes("..") ||
      path.isAbsolute(entry.path) ||
      seen.has(entry.path) ||
      !HASH_PATTERN.test(entry.sha256 ?? "")
    ) {
      fail();
    }
    seen.add(entry.path);
    let source;
    try {
      source = await readFileImpl(path.join(repositoryRoot, entry.path), "utf8");
    } catch (error) {
      fail(error);
    }
    if (hashUtf8(source) !== entry.sha256) fail();
  }
  return manifest;
}

export async function inspectFrozenPhase2alImplementation({
  repositoryRoot = PHASE2AL_REPOSITORY_ROOT,
  execFileImpl = execFileAsync,
  readFileImpl = readFile,
} = {}) {
  const root = path.resolve(repositoryRoot);
  try {
    const status = await execFileImpl(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { cwd: root, encoding: "utf8", maxBuffer: 1_000_000 },
    );
    assertStatus(output(status));
    const commit = output(
      await execFileImpl("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 1_000_000,
      }),
    )
      .trim()
      .toLowerCase();
    if (!COMMIT_PATTERN.test(commit)) fail();
    const manifest = await loadAndVerifyManifest(root, readFileImpl);
    return Object.freeze({
      commitSha: commit,
      gitClean: true,
      allowedUntracked: ALLOWED_UNTRACKED,
      implementationManifestVersion: manifest.manifestVersion,
    });
  } catch (error) {
    if (error instanceof Phase2alImplementationPreflightError) throw error;
    fail(error);
  }
}
