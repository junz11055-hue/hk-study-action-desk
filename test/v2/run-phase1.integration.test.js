import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ModelRequestError } from "../../src/agent/deepseek-responses-client.js";
import { validatePhase1RunRecord } from "../../src/v2/contracts/phase1-run-record-v1.schema.js";
import { createPhase1MockModelClient } from "../../src/v2/model/phase1-model-adapter.js";
import { main as runMockMain } from "../../src/v2/phase1/run-phase1-mock.js";
import {
  acquirePhase1SmokeLock,
  main as runSmokeMain,
} from "../../src/v2/phase1/run-phase1-smoke.js";
import { runPhase1 } from "../../src/v2/phase1/phase1-runner.js";

function captureStream() {
  let text = "";
  return {
    write(chunk) {
      text += String(chunk);
    },
    read() {
      return text;
    },
  };
}

async function temporaryPhase1(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "phase1-offline-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    runsDirectory: path.join(root, "runs"),
    lockPath: path.join(root, "smoke.lock"),
  };
}

test("fixed mock entry writes one valid private success record without network", async (t) => {
  const temporary = await temporaryPhase1(t);
  const stdout = captureStream();
  const stderr = captureStream();
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("offline Phase 1 mock attempted network access");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await runMockMain(["--case", "DEV001"], {
    runsDirectory: temporary.runsDirectory,
    stdout,
    stderr,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.record.status, "succeeded");
  assert.equal(result.record.execution_mode, "mock");
  assert.equal(result.record.provider, "mock");
  assert.equal(result.record.model, null);
  assert.equal(result.record.attempts.length, 1);
  assert.equal(result.record.hashes.candidate_hash, result.record.hashes.delivered_output_hash);
  assert.deepEqual(validatePhase1RunRecord(result.record), { valid: true, errors: [] });
  assert.equal(networkCalls, 0);
  assert.equal(stderr.read(), "");
  assert.doesNotMatch(stdout.read(), /COMP7101 students|You are a constrained|candidate/);

  const persisted = JSON.parse(await readFile(result.recordPath, "utf8"));
  assert.deepEqual(persisted, result.record);
  assert.equal((await stat(temporary.runsDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(result.recordPath)).mode & 0o777, 0o600);
});

test("mock CLI rejects every mode override before fixture or provider work", async (t) => {
  const temporary = await temporaryPhase1(t);
  const stdout = captureStream();
  const stderr = captureStream();
  let fixtureReads = 0;

  const result = await runMockMain(
    ["--case", "DEV001", "--mode", "deepseek"],
    {
      runsDirectory: temporary.runsDirectory,
      readFileImpl: async () => {
        fixtureReads += 1;
        throw new Error("must not read");
      },
      stdout,
      stderr,
    },
  );

  assert.equal(result.exitCode, 2);
  assert.equal(result.record.error.code, "invalid_cli_input");
  assert.equal(result.record.attempts.length, 0);
  assert.equal(fixtureReads, 0);
  assert.equal(stdout.read(), "");
  assert.match(stderr.read(), /invalid_cli_input/);
  assert.deepEqual(validatePhase1RunRecord(result.record), { valid: true, errors: [] });
});

test("a failed mock preserves three-attempt exhaustion and never falls back to preset", async (t) => {
  const temporary = await temporaryPhase1(t);
  let providerCalls = 0;
  const modelClient = {
    configured: true,
    provider: "mock",
    model: "phase1-offline-mock",
    async createStructuredAttempt() {
      providerCalls += 1;
      throw new ModelRequestError("timeout", {
        retryable: true,
        code: "model_timeout",
        outcome: "timeout",
      });
    },
  };

  const result = await runPhase1({
    executionMode: "mock",
    argv: ["--case", "DEV001"],
    modelClient,
    runsDirectory: temporary.runsDirectory,
    sleepImpl: async () => {},
    stdout: captureStream(),
    stderr: captureStream(),
  });

  assert.equal(result.exitCode, 4);
  assert.equal(providerCalls, 3);
  assert.equal(result.record.error.code, "model_timeout");
  assert.equal(result.record.attempt_budget_exhausted, true);
  assert.equal(result.record.attempts.length, 3);
  assert.equal(result.record.candidate, null);
  assert.equal(JSON.stringify(result.record).includes("preset"), false);
  assert.deepEqual(validatePhase1RunRecord(result.record), { valid: true, errors: [] });
});

test("smoke lock excludes a second entry before configuration or model access", async (t) => {
  const temporary = await temporaryPhase1(t);
  const owner = await acquirePhase1SmokeLock({
    lockPath: temporary.lockPath,
    runId: "00000000-0000-4000-8000-000000000001",
  });
  let configLoads = 0;

  const result = await runSmokeMain(["--case", "DEV001"], {
    runsDirectory: temporary.runsDirectory,
    lockPath: temporary.lockPath,
    configLoader: async () => {
      configLoads += 1;
      throw new Error("must not load config while lock is held");
    },
    stdout: captureStream(),
    stderr: captureStream(),
  });
  await owner.release();

  assert.equal(result.exitCode, 3);
  assert.equal(result.record.error.code, "smoke_lock_unavailable");
  assert.equal(result.record.attempts.length, 0);
  assert.equal(configLoads, 0);
  assert.deepEqual(validatePhase1RunRecord(result.record), { valid: true, errors: [] });
});

test("smoke entry with no Key fails closed, performs zero fetches and releases its lock", async (t) => {
  const temporary = await temporaryPhase1(t);
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("missing Key must fail before fetch");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await runSmokeMain(["--case", "DEV001"], {
    runsDirectory: temporary.runsDirectory,
    lockPath: temporary.lockPath,
    configLoader: async () => ({
      deepseek: {
        apiKey: "",
        model: "deepseek-v4-flash",
        baseUrl: "https://api.deepseek.com",
        timeoutMs: 3_000,
        maxRetries: 3,
      },
    }),
    stdout: captureStream(),
    stderr: captureStream(),
  });

  assert.equal(result.exitCode, 3);
  assert.equal(result.record.error.code, "model_not_configured");
  assert.equal(result.record.attempts.length, 0);
  assert.equal(networkCalls, 0);
  await assert.rejects(stat(temporary.lockPath), (error) => error?.code === "ENOENT");
  assert.deepEqual(validatePhase1RunRecord(result.record), { valid: true, errors: [] });
});

test("run-record write failure is an honest exit 6 without a false success path", async () => {
  const result = await runPhase1({
    executionMode: "mock",
    argv: ["--case", "DEV001"],
    modelClient: createPhase1MockModelClient(),
    writeRecordImpl: async () => {
      const error = new Error("synthetic disk failure");
      error.code = "record_write_failed";
      throw error;
    },
    stdout: captureStream(),
    stderr: captureStream(),
  });

  assert.equal(result.exitCode, 6);
  assert.equal(result.record.status, "failed");
  assert.equal(result.record.error.code, "record_write_failed");
  assert.equal(result.recordPath, null);
  assert.deepEqual(validatePhase1RunRecord(result.record), { valid: true, errors: [] });
});
