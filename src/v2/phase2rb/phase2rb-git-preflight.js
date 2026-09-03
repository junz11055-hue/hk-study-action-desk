import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { PHASE2RB_REPOSITORY_ROOT } from "./phase2rb-deepseek-config.js";

const execFileAsync = promisify(execFile);
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export class Phase2rbImplementationPreflightError extends Error {
  constructor() {
    super("The Phase 2R-B implementation must be a clean Git commit.");
    this.name = "Phase2rbImplementationPreflightError";
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

export async function inspectFrozenPhase2rbImplementation({
  repositoryRoot = PHASE2RB_REPOSITORY_ROOT,
  execFileImpl = execFileAsync,
} = {}) {
  try {
    const status = await execFileImpl(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 1_000_000 },
    );
    if (stdout(status).trim().length !== 0) {
      throw new Phase2rbImplementationPreflightError();
    }
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
      throw new Phase2rbImplementationPreflightError();
    }
    return Object.freeze({ commitSha: commit, gitClean: true });
  } catch (error) {
    if (error instanceof Phase2rbImplementationPreflightError) throw error;
    throw new Phase2rbImplementationPreflightError();
  }
}
