import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildPhase2rStructuredRequestBody } from "../../src/v2/phase2r/phase2r-request-contract.js";
import { DEV001_CAPTURED_REPLAY_CANDIDATE } from "../../src/v2/product/fixtures/offline-candidates.js";
import { loadPhase2aoProductInput } from "../../src/v2/product/product-input-loader.js";
import { hashCanonicalJson } from "../../src/v2/validation/canonical-json.js";
import {
  createPhase2alAuthorizationMarker,
  phase2alRunDirectory,
  writePhase2alCandidateCapture,
  writePhase2alProviderTerminal,
  writePhase2alRequestIntent,
  writePhase2alRunIndex,
  writePhase2alTaskTerminal,
} from "../../src/v2/phase2al/phase2al-capture-store.js";
import {
  createPhase2alLiveAnalyzer,
} from "../../src/v2/phase2al/phase2al-live-analyzer.js";

const RUN_ID = "33333333-3333-4333-8333-333333333333";
const TASK_ID = "44444444-4444-4444-8444-444444444444";
const COMMIT = "d".repeat(40);
const ACTION_CARD_HASH = `sha256:${"e".repeat(64)}`;

async function tempRuntime(t, prefix = "phase2al-analyzer-") {
  const created = await mkdtemp(path.join(tmpdir(), prefix));
  const directory = await realpath(created);
  t.after(async () => rm(directory, { recursive: true, force: true }));
  return directory;
}

function fixedClock() {
  return new Date("2026-09-01T02:00:00.000Z");
}

function successfulClient(modelInput, events) {
  const requestBody = buildPhase2rStructuredRequestBody(modelInput);
  return {
    provider: "deepseek",
    configured: true,
    model: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com",
    timeoutMs: 90_000,
    maxRetries: 1,
    logger: null,
    async createStructuredAttempt() {
      events.push("transport");
      return {
        value: structuredClone(DEV001_CAPTURED_REPLAY_CANDIDATE),
        metadata: {
          requestBody,
          providerStatus: "completed",
          incompleteReason: null,
          maxOutputTokens: 8_000,
          httpStatus: 200,
          durationMs: 321,
          inputTokens: 2_000,
          outputTokens: 3_000,
        },
      };
    },
  };
}

function storeWrappers(events) {
  return {
    createAuthorizationMarkerImpl: async (...args) => {
      events.push("marker");
      return await createPhase2alAuthorizationMarker(...args);
    },
    writeRequestIntentImpl: async (...args) => {
      events.push("intent");
      return await writePhase2alRequestIntent(...args);
    },
    writeProviderTerminalImpl: async (...args) => {
      events.push("provider-terminal");
      return await writePhase2alProviderTerminal(...args);
    },
    writeCandidateCaptureImpl: async (...args) => {
      events.push("candidate-capture");
      return await writePhase2alCandidateCapture(...args);
    },
    writeTaskTerminalImpl: async (...args) => {
      events.push("task-terminal");
      return await writePhase2alTaskTerminal(...args);
    },
    writeRunIndexImpl: async (...args) => {
      events.push("run-index");
      return await writePhase2alRunIndex(...args);
    },
  };
}

test("Live Analyzer consumes marker and intent before Key access and performs one fake attempt", async (t) => {
  const runtimeDirectory = await tempRuntime(t);
  const productInput = await loadPhase2aoProductInput({ caseId: "DEV001" });
  const events = [];
  let inspections = 0;
  const analyzer = createPhase2alLiveAnalyzer({
    runId: RUN_ID,
    runtimeDirectory,
    clock: fixedClock,
    implementationInspector: async () => {
      inspections += 1;
      events.push(`inspect-${inspections}`);
      return { commitSha: COMMIT, gitClean: true };
    },
    ...storeWrappers(events),
    configLoader: async () => {
      events.push("key-access");
      return {
        apiKey: "offline-fake-key",
        model: "deepseek-v4-flash",
        baseUrl: "https://api.deepseek.com",
        timeoutMs: 90_000,
      };
    },
    modelClientFactory: () => {
      events.push("client");
      return successfulClient(productInput.modelInput, events);
    },
  });

  const result = await analyzer.analyze({
    caseId: "DEV001",
    modelInput: productInput.modelInput,
    taskId: TASK_ID,
  });
  const candidateHash = hashCanonicalJson(result.candidate);
  await analyzer.recordTaskTerminal({
    taskId: TASK_ID,
    status: "succeeded",
    candidateHash,
    actionCardHash: ACTION_CARD_HASH,
    errorCode: null,
  });

  assert.equal(analyzer.callCount, 1);
  assert.equal(result.executionMode, "live_model");
  assert.deepEqual(events, [
    "inspect-1",
    "marker",
    "intent",
    "key-access",
    "inspect-2",
    "client",
    "transport",
    "provider-terminal",
    "candidate-capture",
    "task-terminal",
    "run-index",
  ]);

  const runDirectory = phase2alRunDirectory(RUN_ID, { runtimeDirectory });
  const provider = JSON.parse(await readFile(path.join(runDirectory, "provider-terminal.json"), "utf8"));
  const index = JSON.parse(await readFile(path.join(runDirectory, "run-index.json"), "utf8"));
  assert.equal(provider.status, "completed");
  assert.equal(provider.attempt_count, 1);
  assert.equal(provider.candidate_hash, candidateHash);
  assert.equal(index.provider_attempt_count, 1);
  assert.equal(index.final_status, "succeeded");

  await assert.rejects(
    analyzer.analyze({
      caseId: "DEV001",
      modelInput: productInput.modelInput,
      taskId: TASK_ID,
    }),
    { code: "phase2al_request_budget_exhausted" },
  );
});

test("Missing configuration happens after authorization consumption and cannot retry", async (t) => {
  const runtimeDirectory = await tempRuntime(t, "phase2al-missing-config-");
  const productInput = await loadPhase2aoProductInput({ caseId: "DEV001" });
  let configReads = 0;
  let clientCreations = 0;
  const analyzer = createPhase2alLiveAnalyzer({
    runId: RUN_ID,
    runtimeDirectory,
    clock: fixedClock,
    implementationInspector: async () => ({ commitSha: COMMIT, gitClean: true }),
    configLoader: async () => {
      configReads += 1;
      const error = new Error("redacted");
      error.code = "model_configuration_invalid";
      throw error;
    },
    modelClientFactory: () => {
      clientCreations += 1;
      throw new Error("must not create client");
    },
  });

  await assert.rejects(
    analyzer.analyze({
      caseId: "DEV001",
      modelInput: productInput.modelInput,
      taskId: TASK_ID,
    }),
    { code: "model_configuration_invalid" },
  );
  assert.equal(configReads, 1);
  assert.equal(clientCreations, 0);
  const terminal = JSON.parse(
    await readFile(
      path.join(phase2alRunDirectory(RUN_ID, { runtimeDirectory }), "provider-terminal.json"),
      "utf8",
    ),
  );
  assert.equal(terminal.status, "failed_without_transport");
  assert.equal(terminal.attempt_count, 0);

  await assert.rejects(
    analyzer.analyze({
      caseId: "DEV001",
      modelInput: productInput.modelInput,
      taskId: TASK_ID,
    }),
    { code: "phase2al_request_budget_exhausted" },
  );
  assert.equal(configReads, 1);
});

for (const [code, httpStatus] of [
  ["model_auth_failed", 401],
  ["model_rate_limited", 429],
  ["model_transport_failed", 503],
  ["model_timeout", null],
]) {
  test(`Provider ${code} records one fake terminal and never retries`, async (t) => {
    const runtimeDirectory = await tempRuntime(t, `phase2al-${code}-`);
    const productInput = await loadPhase2aoProductInput({ caseId: "DEV001" });
    let attempts = 0;
    const analyzer = createPhase2alLiveAnalyzer({
      runId: RUN_ID,
      runtimeDirectory,
      clock: fixedClock,
      implementationInspector: async () => ({ commitSha: COMMIT, gitClean: true }),
      configLoader: async () => ({
        apiKey: "offline-fake-key",
        model: "deepseek-v4-flash",
        baseUrl: "https://api.deepseek.com",
        timeoutMs: 90_000,
      }),
      modelClientFactory: () => ({
        provider: "deepseek",
        configured: true,
        model: "deepseek-v4-flash",
        baseUrl: "https://api.deepseek.com",
        timeoutMs: 90_000,
        maxRetries: 1,
        logger: null,
        async createStructuredAttempt() {
          attempts += 1;
          const error = new Error("provider details must not escape");
          error.code = code;
          error.attemptMetadata = {
            httpStatus,
            providerStatus: null,
            durationMs: 100,
            inputTokens: null,
            outputTokens: null,
          };
          throw error;
        },
      }),
    });
    await assert.rejects(
      analyzer.analyze({
        caseId: "DEV001",
        modelInput: productInput.modelInput,
        taskId: TASK_ID,
      }),
      { code },
    );
    assert.equal(attempts, 1);
    const terminal = JSON.parse(
      await readFile(
        path.join(phase2alRunDirectory(RUN_ID, { runtimeDirectory }), "provider-terminal.json"),
        "utf8",
      ),
    );
    assert.equal(terminal.status, "request_failed");
    assert.equal(terminal.attempt_count, 1);
    assert.equal(terminal.error_code, code);
    assert.doesNotMatch(JSON.stringify(terminal), /provider details|fake-key/iu);
  });
}
