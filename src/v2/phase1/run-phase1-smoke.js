import { chmod, mkdir, open, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DeepSeekResponsesClient } from "../../agent/deepseek-responses-client.js";
import { parsePhase1Cli, runPhase1 } from "./phase1-runner.js";

export const DEFAULT_PHASE1_SMOKE_LOCK_PATH = fileURLToPath(
  new URL("../../../.runtime/phase-1/smoke.lock", import.meta.url),
);

export class Phase1SmokeLockError extends Error {
  constructor(message = "The Phase 1 smoke lock is unavailable") {
    super(message);
    this.name = "Phase1SmokeLockError";
    this.code = "smoke_lock_unavailable";
  }
}

function isoNow(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("clock must return a valid date");
  return date.toISOString();
}

export async function acquirePhase1SmokeLock({
  lockPath = DEFAULT_PHASE1_SMOKE_LOCK_PATH,
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
      // Preserve the lock acquisition error.
    }
    if (error?.code === "EEXIST") throw new Phase1SmokeLockError();
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

async function defaultConfigLoader() {
  // This import evaluates configuration (including the Key) only after the
  // exclusive lock has been acquired by main().
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
    ...(options.stdout ? { stdout: options.stdout } : {}),
    ...(options.stderr ? { stderr: options.stderr } : {}),
  };

  try {
    parsePhase1Cli(argv);
  } catch {
    return await runPhase1(shared);
  }

  let lock;
  try {
    lock = await acquirePhase1SmokeLock({
      lockPath: options.lockPath ?? DEFAULT_PHASE1_SMOKE_LOCK_PATH,
      runId,
      clock,
    });
  } catch (error) {
    return await runPhase1({
      ...shared,
      preflightError: {
        code: error instanceof Phase1SmokeLockError ? error.code : "internal_error",
      },
    });
  }

  try {
    let config;
    try {
      config = await (options.configLoader ?? defaultConfigLoader)();
    } catch {
      return await runPhase1({
        ...shared,
        preflightError: { code: "internal_error" },
      });
    }

    const modelClient = new DeepSeekResponsesClient({
      apiKey: config.deepseek.apiKey,
      model: config.deepseek.model,
      baseUrl: config.deepseek.baseUrl,
      timeoutMs: config.deepseek.timeoutMs,
      maxRetries: config.deepseek.maxRetries,
    });
    return await runPhase1({
      ...shared,
      modelClient,
      timeoutMs: config.deepseek.timeoutMs,
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
