import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { DEV001_CAPTURED_REPLAY_CANDIDATE } from "../../src/v2/product/fixtures/offline-candidates.js";
import { createPhase2aoTaskService } from "../../src/v2/product/task-service.js";
import { createPhase2aoTaskStore } from "../../src/v2/product/task-store.js";

const SESSION = `sha256:${"f".repeat(64)}`;
const REQUEST = Object.freeze({
  contractVersion: "synthetic-analysis-request/v1",
  caseId: "DEV001",
});

async function tempDirectory(t) {
  const created = await mkdtemp(path.join(tmpdir(), "phase2al-chain-"));
  const directory = await realpath(created);
  t.after(async () => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function submit(service, idempotencyKey) {
  return await service.submit({
    sessionScopeDigest: SESSION,
    idempotencyKey,
    request: REQUEST,
  });
}

test("Injected Live Analyzer uses the unchanged Candidate Gate, Harness, task API and provenance", async (t) => {
  const terminalCalls = [];
  let analyzerCalls = 0;
  const analyzer = {
    executionMode: "live_model",
    async analyze({ caseId, taskId }) {
      analyzerCalls += 1;
      assert.equal(caseId, "DEV001");
      assert.match(taskId, /^[0-9a-f-]{36}$/u);
      return {
        executionMode: "live_model",
        candidate: structuredClone(DEV001_CAPTURED_REPLAY_CANDIDATE),
      };
    },
    async recordTaskTerminal(value) {
      terminalCalls.push(value);
    },
  };
  const taskStore = await createPhase2aoTaskStore({
    directory: await tempDirectory(t),
    clock: () => new Date("2026-09-01T03:00:00.000Z"),
  });
  const service = createPhase2aoTaskService({
    taskStore,
    executionMode: "live_model",
    analyzer,
    executionTimeoutMs: 90_000,
    clock: () => new Date("2026-09-01T03:00:01.000Z"),
  });
  const first = await submit(service, "55555555-5555-4555-8555-555555555555");
  const coalesced = await submit(service, "66666666-6666-4666-8666-666666666666");
  await service.drain();
  const task = await service.getTask({
    taskId: first.task.taskId,
    sessionScopeDigest: SESSION,
  });

  assert.equal(coalesced.task.taskId, first.task.taskId);
  assert.equal(analyzerCalls, 1);
  assert.equal(task.status, "succeeded");
  assert.equal(task.executionMode, "live_model");
  assert.equal(task.resource.card.provenance.sourceMode, "live_model");
  assert.match(task.resource.card.provenance.disclosure, /本次 DeepSeek/u);
  assert.equal(terminalCalls.length, 1);
  assert.equal(terminalCalls[0].status, "succeeded");
  assert.match(terminalCalls[0].candidateHash, /^sha256:/u);
  assert.match(terminalCalls[0].actionCardHash, /^sha256:/u);

  const refreshed = await service.getTask({
    taskId: first.task.taskId,
    sessionScopeDigest: SESSION,
  });
  assert.equal(refreshed.taskId, task.taskId);
  assert.equal(analyzerCalls, 1);
});

test("Invalid Live Candidate fails closed without Mock or Replay fallback", async (t) => {
  const terminalCalls = [];
  const taskStore = await createPhase2aoTaskStore({
    directory: await tempDirectory(t),
  });
  const service = createPhase2aoTaskService({
    taskStore,
    executionMode: "live_model",
    executionTimeoutMs: 90_000,
    analyzer: {
      executionMode: "live_model",
      async analyze() {
        return { executionMode: "live_model", candidate: {} };
      },
      async recordTaskTerminal(value) {
        terminalCalls.push(value);
      },
    },
  });
  const submitted = await submit(
    service,
    "77777777-7777-4777-8777-777777777777",
  );
  await service.drain();
  const task = await service.getTask({
    taskId: submitted.task.taskId,
    sessionScopeDigest: SESSION,
  });

  assert.equal(task.status, "failed");
  assert.equal(task.resource, null);
  assert.equal(task.error.code, "CANDIDATE_VALIDATION_FAILED");
  assert.equal(terminalCalls.length, 1);
  assert.equal(terminalCalls[0].status, "failed");
  assert.equal(terminalCalls[0].errorCode, "CANDIDATE_VALIDATION_FAILED");
});
