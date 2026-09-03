import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { PHASE2RD_REPOSITORY_ROOT } from "./phase2rd-deepseek-config.js";

const execFileAsync = promisify(execFile);
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const ALLOWED_UNTRACKED = new Set([
  "AI产品Vibe Coding通用前端技术栈手册.md",
  "后端-前端.png",
]);

export class Phase2rdImplementationPreflightError extends Error {
  constructor() {
    super("The Phase 2R-D implementation must be a clean Git commit.");
    this.name = "Phase2rdImplementationPreflightError";
    this.code = "implementation_not_frozen";
  }
}

function stdout(result) {
  return typeof result === "string"
    ? result
    : typeof result?.stdout === "string"
      ? result.stdout
      : "";
}

function assertTrackedClean(source) {
  const records = source.split("\0").filter(Boolean);
  if (
    records.some(
      (record) =>
        !record.startsWith("?? ") ||
        !ALLOWED_UNTRACKED.has(record.slice(3)),
    )
  ) {
    throw new Phase2rdImplementationPreflightError();
  }
}

export async function inspectFrozenPhase2rdImplementation({
  repositoryRoot = PHASE2RD_REPOSITORY_ROOT,
  execFileImpl = execFileAsync,
} = {}) {
  try {
    const status = await execFileImpl(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 1_000_000 },
    );
    assertTrackedClean(stdout(status));
    const commit = stdout(
      await execFileImpl("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
        cwd: repositoryRoot,
        encoding: "utf8",
        maxBuffer: 1_000_000,
      }),
    )
      .trim()
      .toLowerCase();
    if (!COMMIT_PATTERN.test(commit)) {
      throw new Phase2rdImplementationPreflightError();
    }
    return Object.freeze({ commitSha: commit, gitClean: true });
  } catch (error) {
    if (error instanceof Phase2rdImplementationPreflightError) throw error;
    throw new Phase2rdImplementationPreflightError();
  }
}
