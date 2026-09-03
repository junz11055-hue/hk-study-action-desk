import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DeepSeekResponsesClient } from "../../agent/deepseek-responses-client.js";
import {
  parsePhase1CoreCli,
  PHASE1_CORE_DEEPSEEK_BASE_URL,
  PHASE1_CORE_DEEPSEEK_MODEL,
  PHASE1_CORE_TIMEOUT_MS,
  runPhase1Core,
} from "./phase1-core-runner.js";

const execFileAsync = promisify(execFile);
const GIT_COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

// Intentionally shared with the legacy v1 smoke so the two real paths cannot overlap.
export const DEFAULT_PHASE1_CORE_SMOKE_LOCK_PATH = fileURLToPath(
  new URL("../../../.runtime/phase-1/smoke.lock", import.meta.url),
);
export const PHASE1_CORE_REPOSITORY_ROOT = fileURLToPath(
  new URL("../../../", import.meta.url),
);

export class Phase1CoreSmokeLockError extends Error {
  constructor() {
    super("The shared Phase 1 smoke lock is unavailable");
    this.name = "Phase1CoreSmokeLockError";
    this.code = "smoke_lock_unavailable";
  }
}

export class Phase1CoreImplementationPreflightError extends Error {
  constructor() {
    super("The Core implementation is not frozen in a clean Git commit");
    this.name = "Phase1CoreImplementationPreflightError";
    this.code = "implementation_not_frozen";
  }
}

export class Phase1CoreConfigurationError extends Error {
  constructor() {
    super("The Core DeepSeek configuration is not fixed to the approved values");
    this.name = "Phase1CoreConfigurationError";
    this.code = "model_configuration_invalid";
  }
}

function isoNow(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("clock must return a valid date");
  return date.toISOString();
}

export async function acquirePhase1CoreSmokeLock({
  lockPath = DEFAULT_PHASE1_CORE_SMOKE_LOCK_PATH,
  runId,
  clock = () => new Date(),
} = {}) {
  const directory = path.dirname(lockPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);

  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.chmod(0o600);
    await handle.writeFile(
      `${JSON.stringify({ pid: process.pid, run_id: runId, started_at: isoNow(clock) })}\n`,
      "utf8",
    );
    await handle.sync();
  } catch (error) {
    try {
      await handle?.close();
    } catch {
      // Preserve the original lock acquisition error.
    }
    if (error?.code === "EEXIST") throw new Phase1CoreSmokeLockError();
    throw error;
  }

  let released = false;
  return Object.freeze({
    lockPath,
    async release() {
      if (released) return;
      released = true;
      await handle.close();
      await unlink(lockPath);
    },
  });
}

function commandStdout(result) {
  if (typeof result === "string") return result;
  return typeof result?.stdout === "string" ? result.stdout : "";
}

export async function inspectFrozenCoreImplementation({
  repositoryRoot = PHASE1_CORE_REPOSITORY_ROOT,
  execFileImpl = execFileAsync,
} = {}) {
  try {
    const status = await execFileImpl(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 1_000_000 },
    );
    if (commandStdout(status).trim().length !== 0) {
      throw new Phase1CoreImplementationPreflightError();
    }
    const commit = await execFileImpl(
      "git",
      ["rev-parse", "--verify", "HEAD^{commit}"],
      { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 1_000_000 },
    );
    const commitSha = commandStdout(commit).trim().toLowerCase();
    if (!GIT_COMMIT_PATTERN.test(commitSha)) {
      throw new Phase1CoreImplementationPreflightError();
    }
    return Object.freeze({ commitSha, gitClean: true });
  } catch (error) {
    if (error instanceof Phase1CoreImplementationPreflightError) throw error;
    throw new Phase1CoreImplementationPreflightError();
  }
}

export function assertPhase1CoreDeepSeekConfiguration(config) {
  const deepseek = config?.deepseek;
  if (
    typeof deepseek?.apiKey !== "string" ||
    deepseek.model !== PHASE1_CORE_DEEPSEEK_MODEL ||
    deepseek.baseUrl !== PHASE1_CORE_DEEPSEEK_BASE_URL ||
    deepseek.timeoutMs !== PHASE1_CORE_TIMEOUT_MS
  ) {
    throw new Phase1CoreConfigurationError();
  }
  return deepseek;
}

async function defaultConfigLoader() {
  try {
    process.loadEnvFile(path.join(PHASE1_CORE_REPOSITORY_ROOT, ".env"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const { loadConfig } = await import("../../config.js");
  return loadConfig(process.env);
}

export async function main(argv = process.argv.slice(2), options = {}) {
  const runId = options.runId ?? randomUUID();
  const clock = options.clock ?? (() => new Date());
  const shared = {
    executionMode: "deepseek",
    argv,
    runId,
    clock,
    ...(options.runsDirectory ? { runsDirectory: options.runsDirectory } : {}),
    ...(options.readFileImpl ? { readFileImpl: options.readFileImpl } : {}),
    ...(options.writeRecordImpl ? { writeRecordImpl: options.writeRecordImpl } : {}),
    ...(options.loadContentFailureHashesImpl
      ? { loadContentFailureHashesImpl: options.loadContentFailureHashesImpl }
      : {}),
    ...(options.stdout ? { stdout: options.stdout } : {}),
    ...(options.stderr ? { stderr: options.stderr } : {}),
  };

  try {
    parsePhase1CoreCli(argv);
  } catch {
    return await runPhase1Core(shared);
  }

  let lock;
  try {
    lock = await acquirePhase1CoreSmokeLock({
      lockPath: options.lockPath ?? DEFAULT_PHASE1_CORE_SMOKE_LOCK_PATH,
      runId,
      clock,
    });
  } catch {
    return await runPhase1Core({
      ...shared,
      preflightError: { code: "smoke_lock_unavailable" },
    });
  }

  try {
    let implementation;
    const implementationInspector =
      options.implementationInspector ?? inspectFrozenCoreImplementation;
    try {
      implementation = await implementationInspector();
    } catch {
      return await runPhase1Core({
        ...shared,
        preflightError: { code: "implementation_not_frozen" },
      });
    }

    let deepseek;
    try {
      const config = await (options.configLoader ?? defaultConfigLoader)();
      deepseek = assertPhase1CoreDeepSeekConfiguration(config);
    } catch {
      return await runPhase1Core({
        ...shared,
        implementationCommitSha: implementation.commitSha,
        implementationGitClean: implementation.gitClean,
        preflightError: { code: "model_configuration_invalid" },
      });
    }

    try {
      const revalidated = await implementationInspector();
      if (
        revalidated.gitClean !== true ||
        revalidated.commitSha !== implementation.commitSha
      ) {
        throw new Phase1CoreImplementationPreflightError();
      }
      implementation = revalidated;
    } catch {
      return await runPhase1Core({
        ...shared,
        implementationCommitSha: implementation.commitSha,
        implementationGitClean: false,
        preflightError: { code: "implementation_not_frozen" },
      });
    }

    const modelClient = new DeepSeekResponsesClient({
      apiKey: deepseek.apiKey,
      model: PHASE1_CORE_DEEPSEEK_MODEL,
      baseUrl: PHASE1_CORE_DEEPSEEK_BASE_URL,
      timeoutMs: PHASE1_CORE_TIMEOUT_MS,
      maxRetries: 1,
      clock,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    return await runPhase1Core({
      ...shared,
      modelClient,
      implementationCommitSha: implementation.commitSha,
      implementationGitClean: implementation.gitClean,
    });
  } finally {
    await lock.release();
  }
}

const isDirectInvocation =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) {
  const result = await main();
  process.exitCode = result.exitCode;
}
