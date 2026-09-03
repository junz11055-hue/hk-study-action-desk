import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildStructuredRequestBody,
  ModelRequestError,
} from "../../src/agent/deepseek-responses-client.js";
import { validatePhase1CoreRunRecord } from "../../src/v2/contracts/phase1-core-run-record-v2.schema.js";
import {
  analyzePhase1CoreCandidate,
  CoreContentPayloadGuard,
  createDev001CoreMockCandidate,
  createPhase1CoreMockModelClient,
} from "../../src/v2/model/phase1-core-model-adapter.js";
import { main as runCoreMock } from "../../src/v2/phase1/run-phase1-core-mock.js";
import { runPhase1Core } from "../../src/v2/phase1/phase1-core-runner.js";
import { Phase1CoreRunRecordWriteError } from "../../src/v2/phase1/core-run-record-writer.js";

const FIXED_TIME = "2026-08-31T00:00:00.000Z";

function captureStream() {
  let value = "";
  return {
    stream: { write(chunk) { value += String(chunk); } },
    value: () => value,
  };
}

async function tempRunsDirectory(t) {
  const root = await mkdtemp(path.join(tmpdir(), "phase1-core-run-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return path.join(root, "runs");
}

test("fixed Core mock entry completes offline and persists one valid unchanged Candidate", async (t) => {
  const runsDirectory = await tempRunsDirectory(t);
  const stdout = captureStream();
  const stderr = captureStream();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("external network is forbidden in Phase 1R-A");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await runCoreMock(["--case", "DEV001"], {
    runsDirectory,
    clock: () => new Date(FIXED_TIME),
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.record.status, "succeeded");
  assert.equal(result.record.attempts.length, 1);
  assert.equal(result.record.attempts[0].max_output_tokens, 8000);
  assert.equal(result.record.decoding.max_attempts, 1);
  assert.equal(result.record.decoding.timeout_ms, 90000);
  assert.equal(result.record.implementation_commit_sha, null);
  assert.equal(result.record.implementation_git_clean, null);
  assert.equal(result.record.provider_endpoint, null);
  assert.equal(result.record.hashes.candidate_hash, result.record.hashes.delivered_output_hash);
  assert.equal(validatePhase1CoreRunRecord(result.record).valid, true);
  assert.equal(Object.hasOwn(result.record.candidate.evidence[0], "locator"), false);
  assert.deepEqual(result.record.validation_evidence.profile_refs, [
    {
      profile_field_id: "pf-dev001-course-comp7101",
      source: "synthetic_user_confirmed",
      confirmation_status: "confirmed",
      valid_until: "2026-12-31",
      course_status: "confirmed",
    },
  ]);
  assert.equal(fetchCalls, 0);
  assert.match(stdout.value(), /"status":"succeeded"/u);
  assert.equal(stderr.value(), "");

  const parsed = JSON.parse(await readFile(result.recordPath, "utf8"));
  assert.deepEqual(parsed, result.record);
  const serialized = JSON.stringify(parsed);
  assert.doesNotMatch(serialized, /authorization|bearer|api[_ -]?key|cookie|invite[_ -]?code/iu);
  assert.doesNotMatch(serialized, /raw_response|partial_output_text|provider_payload/iu);
});

test("Core mock rejects invalid CLI before fixture access or provider attempt", async () => {
  let reads = 0;
  let writes = 0;
  const result = await runCoreMock(["--case", "DEV002"], {
    readFileImpl: async () => {
      reads += 1;
      throw new Error("must not read");
    },
    writeRecordImpl: async (record) => {
      writes += 1;
      assert.equal(validatePhase1CoreRunRecord(record).valid, true);
      return { recordPath: "/synthetic/core-record.json", staleTempFiles: [] };
    },
    clock: () => new Date(FIXED_TIME),
    stdout: captureStream().stream,
    stderr: captureStream().stream,
  });

  assert.equal(result.exitCode, 2);
  assert.equal(result.record.error.code, "invalid_cli_input");
  assert.equal(result.record.attempts.length, 0);
  assert.equal(reads, 0);
  assert.equal(writes, 1);
});

test("Core Runner clamps a no-attempt terminal time when the clock moves backward", async () => {
  const times = [
    "2026-08-31T00:00:01.000Z",
    "2026-08-31T00:00:00.000Z",
  ];
  const result = await runPhase1Core({
    executionMode: "mock",
    argv: ["--case", "DEV002"],
    clock: () => new Date(times.shift()),
    writeRecordImpl: async (record) => {
      assert.equal(validatePhase1CoreRunRecord(record).valid, true);
      return { recordPath: "/synthetic/rollback-no-attempt.json", staleTempFiles: [] };
    },
    stdout: captureStream().stream,
    stderr: captureStream().stream,
  });

  assert.equal(result.record.started_at, "2026-08-31T00:00:01.000Z");
  assert.equal(result.record.finished_at, result.record.started_at);
  assert.equal(result.record.attempts.length, 0);
});

test("Core Runner clamps root completion after an attempt when the clock moves backward", async () => {
  const times = [
    "2026-08-31T00:00:00.000Z",
    "2026-08-31T00:00:01.000Z",
    "2026-08-31T00:00:02.000Z",
    "2026-08-31T00:00:00.000Z",
  ];
  const client = {
    configured: true,
    provider: "mock",
    model: "phase1-core-offline-mock",
    async createStructuredAttempt() {
      return {
        value: createDev001CoreMockCandidate(),
        metadata: {
          startedAt: "2026-08-31T00:00:01.000Z",
          finishedAt: "2026-08-31T00:00:02.000Z",
          durationMs: 1_000,
          httpStatus: null,
          providerStatus: "completed",
          incompleteReason: null,
          outputItemTypes: ["message"],
          outputItemCount: 1,
          partialVisibleOutputPresent: false,
          partialVisibleOutputUtf8Bytes: 0,
          partialVisibleOutputSha256: null,
          inputTokens: null,
          outputTokens: null,
          reasoningTokens: null,
          outputTextTokens: null,
          maxOutputTokens: 8_000,
        },
      };
    },
  };
  const result = await runPhase1Core({
    executionMode: "mock",
    argv: ["--case", "DEV001"],
    modelClient: client,
    clock: () => new Date(times.shift()),
    writeRecordImpl: async (record) => {
      assert.equal(validatePhase1CoreRunRecord(record).valid, true);
      return { recordPath: "/synthetic/rollback-after-attempt.json", staleTempFiles: [] };
    },
    stdout: captureStream().stream,
    stderr: captureStream().stream,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.record.attempts[0].finished_at, "2026-08-31T00:00:02.000Z");
  assert.equal(result.record.finished_at, "2026-08-31T00:00:02.000Z");
});

test("Core Runner gives the Adapter a monotonic clock when time moves backward before an attempt", async () => {
  const times = [
    "2026-08-31T00:00:01.000Z",
    "2026-08-31T00:00:00.000Z",
    "2026-08-31T00:00:00.000Z",
    "2026-08-31T00:00:00.000Z",
  ];
  const client = {
    configured: true,
    provider: "mock",
    model: "phase1-core-offline-mock",
    async createStructuredAttempt() {
      return {
        value: createDev001CoreMockCandidate(),
        metadata: {
          startedAt: "2026-08-31T00:00:00.000Z",
          finishedAt: "2026-08-31T00:00:00.000Z",
          durationMs: 0,
          httpStatus: null,
          providerStatus: "completed",
          incompleteReason: null,
          outputItemTypes: ["message"],
          outputItemCount: 1,
          partialVisibleOutputPresent: false,
          partialVisibleOutputUtf8Bytes: 0,
          partialVisibleOutputSha256: null,
          inputTokens: null,
          outputTokens: null,
          reasoningTokens: null,
          outputTextTokens: null,
          maxOutputTokens: 8_000,
        },
      };
    },
  };
  const result = await runPhase1Core({
    executionMode: "mock",
    argv: ["--case", "DEV001"],
    modelClient: client,
    clock: () => new Date(times.shift()),
    writeRecordImpl: async (record) => {
      assert.equal(validatePhase1CoreRunRecord(record).valid, true);
      return { recordPath: "/synthetic/rollback-before-attempt.json", staleTempFiles: [] };
    },
    stdout: captureStream().stream,
    stderr: captureStream().stream,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.record.started_at, "2026-08-31T00:00:01.000Z");
  assert.equal(result.record.attempts[0].started_at, result.record.started_at);
  assert.equal(result.record.attempts[0].finished_at, result.record.started_at);
  assert.equal(result.record.finished_at, result.record.started_at);
});

test("Core Runner accepts only dedicated smoke preflight error codes", async (t) => {
  for (const executionMode of ["mock", "deepseek"]) {
    await t.test(executionMode, async () => {
      const result = await runPhase1Core({
        executionMode,
        argv: ["--case", "DEV001"],
        preflightError: { code: "duplicate_payload_blocked" },
        writeRecordImpl: async (record) => {
          assert.equal(validatePhase1CoreRunRecord(record).valid, true);
          return {
            recordPath: `/synthetic/preflight-${executionMode}.json`,
            staleTempFiles: [],
          };
        },
        clock: () => new Date(FIXED_TIME),
        stdout: captureStream().stream,
        stderr: captureStream().stream,
      });

      assert.equal(result.exitCode, 7);
      assert.equal(result.record.error.code, "internal_error");
      assert.equal(result.record.hashes.blocked_payload_hash, null);
      assert.equal(result.record.attempts.length, 0);
    });
  }
});

test("Core Runner carries redacted provider diagnostics into a failed record", async (t) => {
  const runsDirectory = await tempRunsDirectory(t);
  let calls = 0;
  const client = {
    configured: true,
    provider: "mock",
    model: "phase1-core-offline-mock",
    async createStructuredAttempt() {
      calls += 1;
      const error = new ModelRequestError("safe incomplete", {
        code: "model_response_invalid",
        outcome: "truncated",
      });
      error.attemptMetadata = {
        startedAt: FIXED_TIME,
        finishedAt: FIXED_TIME,
        durationMs: 0,
        httpStatus: 200,
        providerStatus: "incomplete",
        incompleteReason: "max_output_tokens",
        outputItemTypes: ["reasoning", "message"],
        outputItemCount: 2,
        partialVisibleOutputPresent: true,
        partialVisibleOutputUtf8Bytes: 12,
        partialVisibleOutputSha256: `sha256:${"9".repeat(64)}`,
        inputTokens: 500,
        outputTokens: 8000,
        reasoningTokens: 7900,
        outputTextTokens: 100,
      };
      throw error;
    },
  };
  const result = await runPhase1Core({
    executionMode: "mock",
    argv: ["--case", "DEV001"],
    modelClient: client,
    runsDirectory,
    writeRecordImpl: async (record) => {
      assert.equal(validatePhase1CoreRunRecord(record).valid, true);
      return { recordPath: "/synthetic/core-failure.json", staleTempFiles: [] };
    },
    clock: () => new Date(FIXED_TIME),
    stdout: captureStream().stream,
    stderr: captureStream().stream,
  });

  assert.equal(calls, 1);
  assert.equal(result.exitCode, 5);
  assert.equal(result.record.status, "failed");
  assert.equal(result.record.attempt_budget_exhausted, true);
  assert.equal(result.record.candidate, null);
  assert.equal(result.record.attempts[0].partial_output_bytes, 12);
  assert.equal(result.record.attempts[0].reasoning_tokens, 7900);
  assert.equal(Object.hasOwn(result.record.attempts[0], "partial_output_text"), false);
});

test("Core Runner blocks a prior content-failure hash after process-local state is gone", async (t) => {
  const runsDirectory = await tempRunsDirectory(t);
  let calls = 0;
  const client = {
    configured: true,
    provider: "mock",
    model: "phase1-core-offline-mock",
    async createStructuredAttempt() {
      calls += 1;
      throw new ModelRequestError("safe invalid JSON", {
        code: "model_response_invalid",
        outcome: "invalid_json",
      });
    },
  };
  const common = {
    executionMode: "mock",
    argv: ["--case", "DEV001"],
    modelClient: client,
    runsDirectory,
    clock: () => new Date(FIXED_TIME),
    stdout: captureStream().stream,
    stderr: captureStream().stream,
  };

  const first = await runPhase1Core({
    ...common,
    runId: "44444444-4444-4444-8444-444444444444",
  });
  const second = await runPhase1Core({
    ...common,
    runId: "55555555-5555-4555-8555-555555555555",
  });

  assert.equal(first.record.error.code, "model_response_invalid");
  assert.equal(second.record.error.code, "duplicate_payload_blocked");
  assert.equal(second.record.attempts.length, 0);
  assert.equal(
    second.record.hashes.blocked_payload_hash,
    first.record.hashes.model_payload_hash,
  );
  assert.equal(calls, 1);
});

test("shared Core payload guard blocks a repeated failed payload before a second client call", async () => {
  let calls = 0;
  const client = {
    configured: true,
    provider: "mock",
    model: "phase1-core-offline-mock",
    async createStructuredAttempt() {
      calls += 1;
      throw new ModelRequestError("safe invalid JSON", {
        code: "model_response_invalid",
        outcome: "invalid_json",
      });
    },
  };
  const guard = new CoreContentPayloadGuard();
  const records = [];
  const common = {
    executionMode: "mock",
    argv: ["--case", "DEV001"],
    modelClient: client,
    payloadGuard: guard,
    writeRecordImpl: async (record) => {
      records.push(record);
      assert.equal(validatePhase1CoreRunRecord(record).valid, true);
      return { recordPath: `/synthetic/${record.run_id}.json`, staleTempFiles: [] };
    },
    clock: () => new Date(FIXED_TIME),
    stdout: captureStream().stream,
    stderr: captureStream().stream,
  };

  const first = await runPhase1Core({
    ...common,
    runId: "22222222-2222-4222-8222-222222222222",
  });
  const second = await runPhase1Core({
    ...common,
    runId: "33333333-3333-4333-8333-333333333333",
  });

  assert.equal(first.record.error.code, "model_response_invalid");
  assert.equal(second.record.error.code, "duplicate_payload_blocked");
  assert.equal(second.record.attempts.length, 0);
  assert.equal(
    second.record.hashes.blocked_payload_hash,
    first.record.hashes.model_payload_hash,
  );
  assert.equal(calls, 1);
  assert.equal(records.length, 2);
});

test("shared Core payload guard follows the normalized content-failure outcome", async () => {
  let calls = 0;
  const client = {
    configured: true,
    provider: "mock",
    model: "phase1-core-offline-mock",
    async createStructuredAttempt() {
      calls += 1;
      const error = new ModelRequestError("contradictory synthetic failure", {
        code: "model_transport_failed",
        outcome: "permanent_error",
      });
      error.attemptMetadata = {
        startedAt: FIXED_TIME,
        finishedAt: FIXED_TIME,
        durationMs: 0,
        httpStatus: null,
        providerStatus: "incomplete",
        incompleteReason: "max_output_tokens",
        outputItemTypes: [],
        outputItemCount: 0,
        partialVisibleOutputPresent: false,
        partialVisibleOutputUtf8Bytes: 0,
        partialVisibleOutputSha256: null,
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        outputTextTokens: null,
        maxOutputTokens: 8_000,
      };
      throw error;
    },
  };
  const guard = new CoreContentPayloadGuard();
  const common = {
    executionMode: "mock",
    argv: ["--case", "DEV001"],
    modelClient: client,
    payloadGuard: guard,
    writeRecordImpl: async (record) => {
      assert.equal(validatePhase1CoreRunRecord(record).valid, true);
      return { recordPath: `/synthetic/${record.run_id}.json`, staleTempFiles: [] };
    },
    clock: () => new Date(FIXED_TIME),
    stdout: captureStream().stream,
    stderr: captureStream().stream,
  };

  const first = await runPhase1Core({
    ...common,
    runId: "12121212-1212-4212-8212-121212121212",
  });
  const second = await runPhase1Core({
    ...common,
    runId: "34343434-3434-4434-8434-343434343434",
  });

  assert.equal(first.record.attempts[0].outcome, "truncated");
  assert.equal(first.record.error.code, "model_response_invalid");
  assert.equal(second.record.error.code, "duplicate_payload_blocked");
  assert.equal(second.record.attempts.length, 0);
  assert.equal(calls, 1);
});

test("shared Core payload guard does not mark a raw content outcome normalized to permanent", async () => {
  let calls = 0;
  const client = {
    configured: true,
    provider: "mock",
    model: "phase1-core-offline-mock",
    async createStructuredAttempt() {
      calls += 1;
      const error = new ModelRequestError("contradictory synthetic failure", {
        code: "model_response_invalid",
        outcome: "truncated",
      });
      error.attemptMetadata = {
        startedAt: FIXED_TIME,
        finishedAt: FIXED_TIME,
        durationMs: 0,
        httpStatus: null,
        providerStatus: "failed",
        incompleteReason: null,
        outputItemTypes: [],
        outputItemCount: 0,
        partialVisibleOutputPresent: false,
        partialVisibleOutputUtf8Bytes: 0,
        partialVisibleOutputSha256: null,
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        outputTextTokens: null,
        maxOutputTokens: 8_000,
      };
      throw error;
    },
  };
  const guard = new CoreContentPayloadGuard();
  const common = {
    executionMode: "mock",
    argv: ["--case", "DEV001"],
    modelClient: client,
    payloadGuard: guard,
    writeRecordImpl: async (record) => {
      assert.equal(validatePhase1CoreRunRecord(record).valid, true);
      return { recordPath: `/synthetic/${record.run_id}.json`, staleTempFiles: [] };
    },
    clock: () => new Date(FIXED_TIME),
    stdout: captureStream().stream,
    stderr: captureStream().stream,
  };

  const first = await runPhase1Core({
    ...common,
    runId: "56565656-5656-4656-8656-565656565656",
  });
  const second = await runPhase1Core({
    ...common,
    runId: "78787878-7878-4878-8878-787878787878",
  });

  assert.equal(first.record.attempts[0].outcome, "permanent_error");
  assert.equal(second.record.attempts[0].outcome, "permanent_error");
  assert.equal(calls, 2);
});

test("Core Runner preserves the real provider attempt when trusted Harness projection fails", async () => {
  const baseClient = createPhase1CoreMockModelClient({
    clock: () => new Date(FIXED_TIME),
  });
  let calls = 0;
  const client = {
    ...baseClient,
    async createStructuredAttempt(request) {
      calls += 1;
      return await baseClient.createStructuredAttempt(request);
    },
  };
  const result = await runPhase1Core({
    executionMode: "mock",
    argv: ["--case", "DEV001"],
    modelClient: client,
    analyzeImpl: async (options) => {
      const analysis = await analyzePhase1CoreCandidate(options);
      return {
        ...analysis,
        validationEvidence: {
          ...analysis.validationEvidence,
          profile_ref_matches: [
            {
              profile_field_id: "pf-missing-after-provider",
              field_type: "course",
              value: "合成课程",
            },
          ],
        },
      };
    },
    writeRecordImpl: async (record) => {
      assert.equal(validatePhase1CoreRunRecord(record).valid, true);
      return { recordPath: "/synthetic/harness-failure.json", staleTempFiles: [] };
    },
    clock: () => new Date(FIXED_TIME),
    stdout: captureStream().stream,
    stderr: captureStream().stream,
  });

  assert.equal(calls, 1);
  assert.equal(result.exitCode, 7);
  assert.equal(result.record.error.code, "internal_error");
  assert.equal(result.record.attempts.length, 1);
  assert.equal(result.record.attempts[0].outcome, "harness_error");
  assert.equal(result.record.attempts[0].provider_status, "completed");
  assert.equal(result.record.attempts[0].error_code, "internal_error");
  assert.match(result.record.hashes.model_payload_hash, /^sha256:[0-9a-f]{64}$/u);
  assert.match(result.record.hashes.candidate_hash, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(result.record.attempt_budget_exhausted, true);
  assert.deepEqual(result.record.validation, {
    schema_valid: false,
    references_closed: false,
    quote_unique: false,
    profile_refs_allowed: false,
    forbidden_fields_absent: false,
    candidate_unchanged: false,
  });
});

test("Core Runner persists completed-but-malformed metadata as Harness failure", async () => {
  let calls = 0;
  const client = {
    configured: true,
    provider: "mock",
    model: "phase1-core-offline-mock",
    async createStructuredAttempt() {
      calls += 1;
      return {
        value: createDev001CoreMockCandidate(),
        metadata: {
          startedAt: FIXED_TIME,
          finishedAt: FIXED_TIME,
          durationMs: 0,
          httpStatus: null,
          providerStatus: "completed",
          incompleteReason: null,
          outputItemTypes: ["message"],
          outputItemCount: 2_000,
          partialVisibleOutputPresent: false,
          partialVisibleOutputUtf8Bytes: 0,
          partialVisibleOutputSha256: null,
          inputTokens: null,
          outputTokens: null,
          reasoningTokens: null,
          outputTextTokens: null,
          maxOutputTokens: 8_000,
        },
      };
    },
  };
  const result = await runPhase1Core({
    executionMode: "mock",
    argv: ["--case", "DEV001"],
    modelClient: client,
    writeRecordImpl: async (record) => {
      assert.equal(validatePhase1CoreRunRecord(record).valid, true);
      return { recordPath: "/synthetic/metadata-failure.json", staleTempFiles: [] };
    },
    clock: () => new Date(FIXED_TIME),
    stdout: captureStream().stream,
    stderr: captureStream().stream,
  });

  assert.equal(calls, 1);
  assert.equal(result.exitCode, 7);
  assert.equal(result.record.error.code, "internal_error");
  assert.equal(result.record.attempts[0].outcome, "harness_error");
  assert.equal(result.record.attempts[0].output_item_count, 1);
});

test("Core Runner normalizes non-Candidate validator errors as Harness failures", async (t) => {
  for (const injectedCode of ["candidate_context_invalid", "model_timeout"]) {
    await t.test(injectedCode, async () => {
      const client = createPhase1CoreMockModelClient({
        clock: () => new Date(FIXED_TIME),
      });
      const result = await runPhase1Core({
        executionMode: "mock",
        argv: ["--case", "DEV001"],
        modelClient: client,
        analyzeImpl: async (options) =>
          await analyzePhase1CoreCandidate({
            ...options,
            validateCandidate: () => {
              const error = new Error("injected validator failure");
              error.code = injectedCode;
              throw error;
            },
          }),
        writeRecordImpl: async (record) => {
          assert.equal(validatePhase1CoreRunRecord(record).valid, true);
          return {
            recordPath: `/synthetic/validator-${injectedCode}.json`,
            staleTempFiles: [],
          };
        },
        clock: () => new Date(FIXED_TIME),
        stdout: captureStream().stream,
        stderr: captureStream().stream,
      });

      assert.equal(result.exitCode, 7);
      assert.equal(result.record.attempts[0].outcome, "harness_error");
      assert.equal(result.record.attempts[0].error_code, "internal_error");
      assert.equal(result.record.error.code, "internal_error");
    });
  }
});

test("Core Runner normalizes contradictory provider diagnostics into writable terminal truth", async (t) => {
  const scenarios = [
    ["incomplete max token", "incomplete", "max_output_tokens", "permanent_error", "model_transport_failed", "truncated", "model_response_invalid"],
    ["incomplete content filter", "incomplete", "content_filter", "timeout", "model_timeout", "permanent_error", "model_response_invalid"],
    ["failed timeout", "failed", null, "timeout", "model_timeout", "permanent_error", "internal_error"],
    ["cancelled rate limit", "cancelled", null, "rate_limited", "model_rate_limited", "permanent_error", "internal_error"],
    ["queued transport", "queued", null, "transient_error", "model_transport_failed", "harness_error", "internal_error"],
    ["in progress response", "in_progress", null, "permanent_error", "model_response_invalid", "harness_error", "internal_error"],
    ["completed timeout", "completed", null, "timeout", "model_timeout", "harness_error", "internal_error"],
    ["completed thrown completion", "completed", null, "completed", "model_response_invalid", "harness_error", "internal_error"],
    ["unproven refusal", null, null, "refused", "model_refused", "permanent_error", "internal_error"],
    ["local timeout", null, null, "timeout", "model_timeout", "timeout", "model_timeout"],
  ];

  for (const [
    name,
    providerStatus,
    incompleteReason,
    sourceOutcome,
    sourceCode,
    expectedOutcome,
    expectedCode,
  ] of scenarios) {
    await t.test(name, async () => {
      const client = {
        configured: true,
        provider: "mock",
        model: "phase1-core-offline-mock",
        async createStructuredAttempt() {
          const error = new ModelRequestError("untrusted provider detail", {
            code: sourceCode,
            outcome: sourceOutcome,
          });
          error.attemptMetadata = {
            startedAt: FIXED_TIME,
            finishedAt: FIXED_TIME,
            durationMs: 0,
            httpStatus: null,
            providerStatus,
            incompleteReason,
            outputItemTypes: [],
            outputItemCount: 0,
            partialVisibleOutputPresent: false,
            partialVisibleOutputUtf8Bytes: 0,
            partialVisibleOutputSha256: null,
            inputTokens: null,
            outputTokens: null,
            reasoningTokens: null,
            outputTextTokens: null,
            maxOutputTokens: 8_000,
          };
          throw error;
        },
      };
      const result = await runPhase1Core({
        executionMode: "mock",
        argv: ["--case", "DEV001"],
        modelClient: client,
        payloadGuard: new CoreContentPayloadGuard(),
        writeRecordImpl: async (record) => {
          assert.equal(validatePhase1CoreRunRecord(record).valid, true);
          return { recordPath: `/synthetic/${name}.json`, staleTempFiles: [] };
        },
        clock: () => new Date(FIXED_TIME),
        stdout: captureStream().stream,
        stderr: captureStream().stream,
      });

      assert.equal(result.record.attempts[0].outcome, expectedOutcome);
      assert.equal(result.record.attempts[0].error_code, expectedCode);
      assert.equal(result.record.error.code, expectedCode);
    });
  }
});

test("DeepSeek Core Runner fails closed when content-failure metadata lacks provider status", async (t) => {
  const scenarios = [
    ["invalid_json", "model_response_invalid"],
    ["candidate_invalid", "candidate_schema_invalid"],
  ];

  for (const [sourceOutcome, sourceCode] of scenarios) {
    await t.test(sourceOutcome, async () => {
      const client = {
        configured: true,
        provider: "deepseek",
        model: "deepseek-v4-flash",
        baseUrl: "https://api.deepseek.com",
        timeoutMs: 90_000,
        maxRetries: 1,
        async createStructuredAttempt(request) {
          const error = new ModelRequestError("missing provider status", {
            code: sourceCode,
            outcome: sourceOutcome,
          });
          error.attemptMetadata = {
            startedAt: FIXED_TIME,
            finishedAt: FIXED_TIME,
            durationMs: 0,
            httpStatus: 200,
            providerStatus: null,
            incompleteReason: null,
            outputItemTypes: [],
            outputItemCount: 0,
            partialVisibleOutputPresent: false,
            partialVisibleOutputUtf8Bytes: 0,
            partialVisibleOutputSha256: null,
            inputTokens: null,
            outputTokens: null,
            reasoningTokens: null,
            outputTextTokens: null,
            maxOutputTokens: 8_000,
            requestBody: buildStructuredRequestBody({
              model: "deepseek-v4-flash",
              instructions: request.instructions,
              input: request.input,
              schema: request.schema,
              schemaName: request.schemaName,
              maxOutputTokens: request.maxOutputTokens,
            }),
          };
          throw error;
        },
      };
      const result = await runPhase1Core({
        executionMode: "deepseek",
        argv: ["--case", "DEV001"],
        modelClient: client,
        implementationCommitSha: "a".repeat(40),
        implementationGitClean: true,
        writeRecordImpl: async (record) => {
          assert.equal(validatePhase1CoreRunRecord(record).valid, true);
          return {
            recordPath: `/synthetic/deepseek-${sourceOutcome}.json`,
            staleTempFiles: [],
          };
        },
        clock: () => new Date(FIXED_TIME),
        stdout: captureStream().stream,
        stderr: captureStream().stream,
      });

      assert.equal(result.exitCode, 5);
      assert.equal(result.record.attempts[0].provider_status, null);
      assert.equal(result.record.attempts[0].outcome, "permanent_error");
      assert.equal(result.record.attempts[0].error_code, "model_response_invalid");
      assert.equal(result.record.error.code, "model_response_invalid");
    });
  }
});

test("Core writer failure is an outer persistence error, never a fabricated Run Record", async () => {
  const stderr = captureStream();
  const result = await runCoreMock(["--case", "DEV001"], {
    writeRecordImpl: async () => {
      throw new Phase1CoreRunRecordWriteError("synthetic write failure");
    },
    clock: () => new Date(FIXED_TIME),
    stdout: captureStream().stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 6);
  assert.equal(result.record, null);
  assert.equal(result.recordPath, null);
  assert.equal(result.persistenceError.code, "record_write_failed");
  assert.equal(result.attemptedRecord.status, "succeeded");
  assert.equal(result.attemptedRecord.attempts[0].outcome, "completed");
  assert.equal(validatePhase1CoreRunRecord(result.attemptedRecord).valid, true);
  assert.match(stderr.value(), /"code":"record_write_failed"/u);
  assert.doesNotMatch(stderr.value(), /synthetic write failure/iu);
});

test("Core writer failure preserves an already-failed provider truth separately", async () => {
  const client = {
    configured: true,
    provider: "mock",
    model: "phase1-core-offline-mock",
    async createStructuredAttempt() {
      throw new ModelRequestError("secret-like provider detail", {
        code: "model_response_invalid",
        outcome: "invalid_json",
      });
    },
  };
  const result = await runPhase1Core({
    executionMode: "mock",
    argv: ["--case", "DEV001"],
    modelClient: client,
    writeRecordImpl: async () => {
      throw new Phase1CoreRunRecordWriteError("synthetic write failure");
    },
    clock: () => new Date(FIXED_TIME),
    stdout: captureStream().stream,
    stderr: captureStream().stream,
  });

  assert.equal(result.exitCode, 6);
  assert.equal(result.record, null);
  assert.equal(result.persistenceError.code, "record_write_failed");
  assert.equal(result.attemptedRecord.error.code, "model_response_invalid");
  assert.equal(result.attemptedRecord.attempts[0].outcome, "invalid_json");
  assert.equal(validatePhase1CoreRunRecord(result.attemptedRecord).valid, true);
});

test("Core mock import graph and npm entry contain no env, Key, server, or listener path", async () => {
  const files = [
    "src/v2/phase1/run-phase1-core-mock.js",
    "src/v2/phase1/phase1-core-runner.js",
    "src/v2/phase1/core-run-record-writer.js",
    "src/v2/phase1/core-content-payload-history.js",
    "src/v2/model/phase1-core-model-adapter.js",
    "src/v2/fixtures/development-core-fixture-loader.js",
    "src/v2/prompts/notification-analysis-core-p1-v2.js",
    "src/v2/contracts/notification-analysis-core-candidate-p1-v2.schema.js",
    "src/v2/contracts/phase1-core-run-record-v2.schema.js",
    "src/v2/validation/core-candidate-validator.js",
  ];
  const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(
    source,
    /process\.env|--env-file|from\s+["'][^"']*config|loadConfig\s*\(/iu,
  );
  assert.doesNotMatch(source, /src\/server|\.listen\s*\(/u);

  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(
    packageJson.scripts["phase1:core:mock"],
    "node src/v2/phase1/run-phase1-core-mock.js",
  );
  assert.doesNotMatch(packageJson.scripts["phase1:core:mock"], /env-file|\.env/iu);
});

test("Core mock Candidate factory remains deterministic and synthetic", () => {
  const first = createDev001CoreMockCandidate();
  const second = createDev001CoreMockCandidate();
  assert.deepEqual(first, second);
  assert.match(JSON.stringify(first), /COMP7101/u);
  assert.equal(Object.hasOwn(first, "notification_id"), false);
  assert.equal(Object.hasOwn(first.evidence[0], "locator"), false);
});
