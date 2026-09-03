import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { validateActionCardV02 } from "../../src/v2/product/action-card-v02.js";
import { assertPhase2aoTaskDto } from "../../src/v2/product/contracts.js";
import { createPhase2aoOfflineAnalyzer } from "../../src/v2/product/offline-analyzers.js";
import { createPhase2aoTaskService } from "../../src/v2/product/task-service.js";
import { createPhase2aoTaskStore } from "../../src/v2/product/task-store.js";

const SESSION_A = `sha256:${"a".repeat(64)}`;
const KEY_A = "11111111-1111-4111-8111-111111111111";
const KEY_B = "22222222-2222-4222-8222-222222222222";
const REQUEST = Object.freeze({
  contractVersion: "synthetic-analysis-request/v1",
  caseId: "DEV001",
});

async function privateTempDirectory(t) {
  const created = await mkdtemp(path.join(tmpdir(), "phase2ao-service-"));
  const directory = await realpath(created);
  t.after(async () => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function serviceFixture(t, options = {}) {
  const directory = await privateTempDirectory(t);
  const taskStore = await createPhase2aoTaskStore({
    directory,
    clock: options.storeClock ?? (() => new Date("2026-09-01T00:00:00.000Z")),
  });
  const service = createPhase2aoTaskService({
    taskStore,
    executionMode: options.executionMode ?? "synthetic_mock",
    clock: options.clock ?? (() => new Date("2026-09-01T00:00:01.000Z")),
    ...(options.analyzer === undefined ? {} : { analyzer: options.analyzer }),
    ...(options.schedule === undefined ? {} : { schedule: options.schedule }),
    ...(options.executionTimeoutMs === undefined
      ? {}
      : { executionTimeoutMs: options.executionTimeoutMs }),
    ...(options.loadProductInput === undefined
      ? {}
      : { loadProductInput: options.loadProductInput }),
  });
  return { service, taskStore };
}

async function submit(service, idempotencyKey = KEY_A) {
  return await service.submit({
    sessionScopeDigest: SESSION_A,
    idempotencyKey,
    request: REQUEST,
  });
}

test("Task Service exposes queued state, coalesces work, and runs Analyzer exactly once", async (t) => {
  const jobs = [];
  const analyzer = createPhase2aoOfflineAnalyzer({
    executionMode: "synthetic_mock",
  });
  const { service } = await serviceFixture(t, {
    analyzer,
    schedule: (job) => jobs.push(job),
  });

  const first = await submit(service, KEY_A);
  const sameKey = await submit(service, KEY_A);
  const differentKey = await submit(service, KEY_B);
  assert.equal(first.statusCode, 202);
  assert.equal(first.task.status, "queued");
  assert.equal(first.task.cached, false);
  assert.equal(first.task.pollAfterMs, 250);
  assert.equal(sameKey.statusCode, 200);
  assert.equal(differentKey.statusCode, 200);
  assert.equal(sameKey.task.taskId, first.task.taskId);
  assert.equal(differentKey.task.taskId, first.task.taskId);
  assert.equal(jobs.length, 1);
  assert.equal(analyzer.callCount, 0);

  jobs.shift()();
  await service.drain();
  const task = await service.getTask({
    taskId: first.task.taskId,
    sessionScopeDigest: SESSION_A,
  });
  assert.equal(analyzer.callCount, 1);
  assert.equal(task.status, "succeeded");
  assert.equal(task.resource.status, "succeeded");
  assert.equal(task.cached, true);
  assert.equal(task.pollAfterMs, null);
  assert.equal(task.resource.card.contractVersion, "action-card-view-model/v0.2");
  assert.equal(task.resource.card.provenance.sourceMode, "synthetic_mock");
  assert.equal(task.resource.card.homeSection, "action_required");
  assert.equal(task.resource.card.dates[0].normalized.value, "2026-08-31T17:00:00+08:00");
  assert.equal(task.resource.card.capabilities.writeCalendar.state, "blocked");

  const serialized = JSON.stringify(task);
  for (const forbidden of [
    "sessionScopeDigest",
    "contractBundleHash",
    "candidateHash",
    "modelInput",
    "prompt",
    "apiKey",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }

  for (const mutate of [
    (value) => {
      value.resource.status = "partially_succeeded";
    },
    (value) => {
      value.executionMode = "captured_replay";
    },
    (value) => {
      value.resource.card.notification.id = "OTHER-NOTIFICATION";
    },
  ]) {
    const invalid = structuredClone(task);
    mutate(invalid);
    assert.throws(
      () =>
        assertPhase2aoTaskDto(invalid, {
          validateActionCard: validateActionCardV02,
        }),
      { name: "Phase2aoContractError" },
    );
  }
});

test("Task Service runs captured Replay through the same honest product chain", async (t) => {
  const analyzer = createPhase2aoOfflineAnalyzer({
    executionMode: "captured_replay",
  });
  const { service } = await serviceFixture(t, {
    analyzer,
    executionMode: "captured_replay",
  });
  const submitted = await submit(service);
  await service.drain();
  const task = await service.getTask({
    taskId: submitted.task.taskId,
    sessionScopeDigest: SESSION_A,
  });

  assert.equal(analyzer.callCount, 1);
  assert.equal(task.status, "succeeded");
  assert.equal(task.executionMode, "captured_replay");
  assert.equal(task.resource.card.provenance.sourceMode, "captured_replay");
  assert.match(task.resource.card.provenance.disclosure, /不是本次实时调用/u);
});

test("Task Service fails closed for invalid Candidate and never substitutes a card", async (t) => {
  let calls = 0;
  const analyzer = {
    executionMode: "synthetic_mock",
    async analyze() {
      calls += 1;
      return { executionMode: "synthetic_mock", candidate: {} };
    },
  };
  const { service } = await serviceFixture(t, { analyzer });
  const submitted = await submit(service);
  await service.drain();
  const task = await service.getTask({
    taskId: submitted.task.taskId,
    sessionScopeDigest: SESSION_A,
  });

  assert.equal(calls, 1);
  assert.equal(task.status, "failed");
  assert.equal(task.resource, null);
  assert.deepEqual(task.error, {
    code: "CANDIDATE_VALIDATION_FAILED",
    message: "AI 候选结果未通过冻结合同校验，无法安全展示。",
    retryable: false,
  });
});

test("Task Service restores succeeded and failed terminals after restart without rerunning Analyzer", async (t) => {
  const succeededDirectory = await privateTempDirectory(t);
  const succeededStore = await createPhase2aoTaskStore({
    directory: succeededDirectory,
  });
  const succeededAnalyzer = createPhase2aoOfflineAnalyzer({
    executionMode: "synthetic_mock",
  });
  const succeededService = createPhase2aoTaskService({
    taskStore: succeededStore,
    analyzer: succeededAnalyzer,
    executionMode: "synthetic_mock",
    clock: () => new Date("2026-09-01T00:00:01.000Z"),
  });
  const succeededSubmission = await submit(succeededService);
  await succeededService.drain();
  assert.equal(succeededAnalyzer.callCount, 1);

  const restartedSucceededAnalyzer = createPhase2aoOfflineAnalyzer({
    executionMode: "synthetic_mock",
  });
  const restartedSucceededService = createPhase2aoTaskService({
    taskStore: await createPhase2aoTaskStore({ directory: succeededDirectory }),
    analyzer: restartedSucceededAnalyzer,
    executionMode: "synthetic_mock",
  });
  const recoveredSucceeded = await restartedSucceededService.getTask({
    taskId: succeededSubmission.task.taskId,
    sessionScopeDigest: SESSION_A,
  });
  const cachedSucceeded = await submit(restartedSucceededService);
  await restartedSucceededService.drain();
  assert.equal(recoveredSucceeded.status, "succeeded");
  assert.equal(cachedSucceeded.statusCode, 200);
  assert.equal(cachedSucceeded.task.status, "succeeded");
  assert.equal(cachedSucceeded.task.taskId, succeededSubmission.task.taskId);
  assert.equal(restartedSucceededAnalyzer.callCount, 0);

  const failedDirectory = await privateTempDirectory(t);
  const failedStore = await createPhase2aoTaskStore({ directory: failedDirectory });
  let failedAnalyzerCalls = 0;
  const failedService = createPhase2aoTaskService({
    taskStore: failedStore,
    analyzer: {
      executionMode: "synthetic_mock",
      async analyze() {
        failedAnalyzerCalls += 1;
        return { executionMode: "synthetic_mock", candidate: {} };
      },
    },
    executionMode: "synthetic_mock",
  });
  const failedSubmission = await submit(failedService);
  await failedService.drain();
  assert.equal(failedAnalyzerCalls, 1);

  const restartedFailedAnalyzer = createPhase2aoOfflineAnalyzer({
    executionMode: "synthetic_mock",
  });
  const restartedFailedService = createPhase2aoTaskService({
    taskStore: await createPhase2aoTaskStore({ directory: failedDirectory }),
    analyzer: restartedFailedAnalyzer,
    executionMode: "synthetic_mock",
  });
  const recoveredFailed = await restartedFailedService.getTask({
    taskId: failedSubmission.task.taskId,
    sessionScopeDigest: SESSION_A,
  });
  const cachedFailed = await submit(restartedFailedService);
  await restartedFailedService.drain();
  assert.equal(recoveredFailed.status, "failed");
  assert.equal(recoveredFailed.resource, null);
  assert.equal(cachedFailed.statusCode, 200);
  assert.equal(cachedFailed.task.status, "failed");
  assert.equal(cachedFailed.task.taskId, failedSubmission.task.taskId);
  assert.equal(restartedFailedAnalyzer.callCount, 0);
});

test("Task Service turns a bounded execution timeout into a safe terminal failure", async (t) => {
  const analyzer = {
    executionMode: "synthetic_mock",
    async analyze() {
      return await new Promise(() => undefined);
    },
  };
  const { service } = await serviceFixture(t, {
    analyzer,
    executionTimeoutMs: 10,
  });
  const submitted = await submit(service);
  await service.drain();
  const task = await service.getTask({
    taskId: submitted.task.taskId,
    sessionScopeDigest: SESSION_A,
  });

  assert.equal(task.status, "failed");
  assert.equal(task.resource, null);
  assert.equal(task.error.code, "TASK_EXECUTION_TIMEOUT");
});

test("Task Service rejects bad requests before Analyzer and requires an explicit Live Analyzer", async (t) => {
  const analyzer = createPhase2aoOfflineAnalyzer({
    executionMode: "synthetic_mock",
  });
  const { service, taskStore } = await serviceFixture(t, { analyzer });
  await assert.rejects(
    service.submit({
      sessionScopeDigest: SESSION_A,
      idempotencyKey: KEY_A,
      request: {
        contractVersion: "synthetic-analysis-request/v1",
        caseId: "DEV002",
      },
    }),
    { code: "SYNTHETIC_ANALYSIS_REQUEST_INVALID", statusCode: 400 },
  );
  assert.equal(analyzer.callCount, 0);

  assert.throws(
    () =>
      createPhase2aoTaskService({
        taskStore,
        executionMode: "live_model",
      }),
    { code: "LIVE_ANALYZER_REQUIRED" },
  );
});
