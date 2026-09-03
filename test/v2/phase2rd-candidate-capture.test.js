import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ModelRequestError } from "../../src/agent/deepseek-responses-client.js";
import {
  buildReferenceCoreCandidateForEvaluation,
  projectCoreOverlapOracle,
} from "../../src/v2/phase2/core-overlap-oracle-projector.js";
import {
  loadPhase2rDevelopmentInputs,
} from "../../src/v2/phase2r/phase2r-development-input-loader.js";
import {
  buildPhase2rcStructuredRequestBody,
} from "../../src/v2/phase2rc/phase2rc-request-contract.js";
import {
  capturePhase2rdCandidates,
} from "../../src/v2/phase2rd/phase2rd-candidate-capture.js";
import {
  createPhase2rdAuthorizationMarker,
  phase2rdRunDirectory,
} from "../../src/v2/phase2rd/phase2rd-capture-store.js";
import {
  PHASE2RD_AUTHORIZATION_VERSION,
  PHASE2RD_AUTHORIZATION_ID,
  PHASE2RD_BASE_URL,
  PHASE2RD_BASE_SNAPSHOT_FILE_HASH,
  PHASE2RD_BASE_SNAPSHOT_HASH,
  PHASE2RD_CANDIDATE_SCHEMA_VERSION,
  PHASE2RD_CAPTURE_FILE_VERSION,
  PHASE2RD_CASE_IDS,
  PHASE2RD_CASE_SET_HASH,
  PHASE2RD_DATA_SCOPE,
  PHASE2RD_DIAGNOSTIC_VERSION,
  PHASE2RD_MAX_OUTPUT_TOKENS,
  PHASE2RD_MAX_REQUESTS,
  PHASE2RD_MODEL,
  PHASE2RD_MODEL_INPUT_SET_HASH,
  PHASE2RD_PROMPT_HASH,
  PHASE2RD_PROMPT_VERSION,
  PHASE2RD_PROVIDER,
  PHASE2RD_REQUESTS_PER_CASE,
  PHASE2RD_RETRIES,
  PHASE2RD_SCHEMA_HASH,
  PHASE2RD_SERIAL,
  PHASE2RD_SOURCE_CONTEXT_FILE_HASH,
  PHASE2RD_SOURCE_CONTEXT_SNAPSHOT_HASH,
  PHASE2RD_TIMEOUT_MS,
} from "../../src/v2/phase2rd/phase2rd-run-contract.js";
import { hashCanonicalJson } from "../../src/v2/validation/canonical-json.js";
import { PHASE2RD_FROZEN_REQUESTS } from "../../src/v2/phase2rd/phase2rd-spec-contract.js";

const FIXTURE_URL = new URL(
  "../../docs/fixtures/prd-v0.2/base-development.json",
  import.meta.url,
);
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const COMMIT = "a".repeat(40);
const KEY_CANARY = "phase2rd-key-canary-never-persist";
const RAW_CANARY = "raw-candidate-canary-never-persist";
const CLEAN_PREFLIGHT = async () => ({ gitClean: true, commitSha: COMMIT });

const REQUEST_DESCRIPTORS = Object.freeze(PHASE2RD_FROZEN_REQUESTS.map((item, index) => ({
  case_id: item.case_id,
  case_index: index,
  model_input_hash: item.model_input_hash,
  prompt_hash: PHASE2RD_PROMPT_HASH,
  schema_hash: PHASE2RD_SCHEMA_HASH,
  request_payload_hash: item.request_payload_hash,
  request_utf8_bytes: item.request_utf8_bytes,
})));

function marker(overrides = {}) {
  return {
    authorization_version: PHASE2RD_AUTHORIZATION_VERSION,
    authorization_id: PHASE2RD_AUTHORIZATION_ID,
    status: "consumed",
    run_id: RUN_ID,
    consumed_at: "2026-09-01T00:00:00.000Z",
    implementation_commit_sha: COMMIT,
    case_ids: [...PHASE2RD_CASE_IDS],
    case_set_hash: PHASE2RD_CASE_SET_HASH,
    provider: PHASE2RD_PROVIDER,
    model: PHASE2RD_MODEL,
    prompt_version: PHASE2RD_PROMPT_VERSION,
    prompt_hash: PHASE2RD_PROMPT_HASH,
    candidate_schema_version: PHASE2RD_CANDIDATE_SCHEMA_VERSION,
    schema_hash: PHASE2RD_SCHEMA_HASH,
    diagnostic_version: PHASE2RD_DIAGNOSTIC_VERSION,
    base_snapshot_hash: PHASE2RD_BASE_SNAPSHOT_HASH,
    base_snapshot_file_hash: PHASE2RD_BASE_SNAPSHOT_FILE_HASH,
    model_input_set_hash: PHASE2RD_MODEL_INPUT_SET_HASH,
    source_context_snapshot_hash: PHASE2RD_SOURCE_CONTEXT_SNAPSHOT_HASH,
    source_context_file_hash: PHASE2RD_SOURCE_CONTEXT_FILE_HASH,
    request_descriptors: structuredClone(REQUEST_DESCRIPTORS),
    request_descriptor_set_hash: hashCanonicalJson(REQUEST_DESCRIPTORS),
    max_requests: PHASE2RD_MAX_REQUESTS,
    requests_per_case: PHASE2RD_REQUESTS_PER_CASE,
    serial: PHASE2RD_SERIAL,
    retries: PHASE2RD_RETRIES,
    max_output_tokens: PHASE2RD_MAX_OUTPUT_TOKENS,
    timeout_ms: PHASE2RD_TIMEOUT_MS,
    data_scope: PHASE2RD_DATA_SCOPE,
    ...overrides,
  };
}

async function tempRuntime(t, prefix = "phase2rd-capture-") {
  const created = await mkdtemp(path.join(os.tmpdir(), prefix));
  const canonical = await realpath(created);
  t.after(async () => await rm(canonical, { recursive: true, force: true }));
  return canonical;
}

async function referenceCandidatesByInputHash() {
  const [developmentCases, inputs] = await Promise.all([
    readFile(FIXTURE_URL, "utf8").then(JSON.parse),
    loadPhase2rDevelopmentInputs(),
  ]);
  const allowed = new Set(PHASE2RD_CASE_IDS);
  const records = inputs
    .filter(({ caseId }) => allowed.has(caseId))
    .map((input) => {
      const developmentCase = developmentCases.find(
        ({ case_id: caseId }) => caseId === input.caseId,
      );
      const oracle = projectCoreOverlapOracle(developmentCase);
      return [
        input.modelInputHash,
        {
          caseId: input.caseId,
          candidate: buildReferenceCoreCandidateForEvaluation(
            developmentCase,
            oracle,
          ),
        },
      ];
    });
  return new Map(records);
}

function fakeClient({
  candidates,
  mutateCandidate,
  failure = null,
  failureAt = 0,
  delay = async () => {},
} = {}) {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const client = {
    provider: PHASE2RD_PROVIDER,
    apiKey: KEY_CANARY,
    model: PHASE2RD_MODEL,
    baseUrl: PHASE2RD_BASE_URL,
    timeoutMs: PHASE2RD_TIMEOUT_MS,
    maxRetries: 1,
    logger: null,
    get configured() {
      return Boolean(this.apiKey);
    },
    async createStructuredAttempt(request) {
      const modelInput = JSON.parse(request.input);
      const inputHash = hashCanonicalJson(modelInput);
      const entry = candidates.get(inputHash);
      const callIndex = calls.length;
      calls.push({ caseId: entry?.caseId ?? null, inputHash, request });
      active += 1;
      maxActive = Math.max(maxActive, active);
      const requestBody = buildPhase2rcStructuredRequestBody(modelInput);
      const metadata = {
        requestId: `offline-${callIndex + 1}`,
        startedAt: "2026-09-01T00:00:00.000Z",
        finishedAt: "2026-09-01T00:00:00.010Z",
        durationMs: 10,
        httpStatus: 200,
        providerStatus: "completed",
        incompleteReason: null,
        outputItemTypes: ["message"],
        outputItemCount: 1,
        partialVisibleOutputPresent: false,
        partialVisibleOutputUtf8Bytes: 0,
        partialVisibleOutputSha256: null,
        inputTokens: 100 + callIndex,
        outputTokens: 200 + callIndex,
        reasoningTokens: 120 + callIndex,
        outputTextTokens: 80,
        maxOutputTokens: request.maxOutputTokens,
      };
      Object.defineProperty(metadata, "requestBody", {
        enumerable: false,
        value: requestBody,
      });
      try {
        await delay(callIndex);
        if (failure !== null && callIndex === failureAt) {
          const error = new ModelRequestError("provider canary must not persist", {
            code: failure.code,
            outcome: failure.outcome,
            status: failure.status ?? null,
            retryable: false,
          });
          if (failure.providerStatus !== undefined) {
            metadata.providerStatus = failure.providerStatus;
          }
          if (failure.incompleteReason !== undefined) {
            metadata.incompleteReason = failure.incompleteReason;
          }
          if (failure.httpStatus !== undefined) {
            metadata.httpStatus = failure.httpStatus;
          }
          error.attemptMetadata = metadata;
          throw error;
        }
        assert.ok(entry, `missing offline Candidate for ${inputHash}`);
        const candidate = structuredClone(entry.candidate);
        mutateCandidate?.(candidate, callIndex, modelInput);
        return { value: candidate, metadata };
      } finally {
        active -= 1;
      }
    },
  };
  return { client, calls, get maxActive() { return maxActive; } };
}

async function createAuthorizedRuntime(t) {
  const runtimeDirectory = await tempRuntime(t);
  await createPhase2rdAuthorizationMarker(marker(), { runtimeDirectory });
  return runtimeDirectory;
}

test("Phase 2R-D captures six fixed cases serially with one intent and terminal", async (t) => {
  const runtimeDirectory = await createAuthorizedRuntime(t);
  const candidates = await referenceCandidatesByInputHash();
  const fake = fakeClient({
    candidates,
    delay: async () => await new Promise((resolve) => setTimeout(resolve, 1)),
  });
  const result = await capturePhase2rdCandidates({
    runId: RUN_ID,
    implementationCommitSha: COMMIT,
    modelClient: fake.client,
    runtimeDirectory,
    beforeCasePreflight: CLEAN_PREFLIGHT,
  });

  assert.deepEqual(fake.calls.map(({ caseId }) => caseId), PHASE2RD_CASE_IDS);
  assert.equal(fake.calls.length, 6);
  assert.equal(fake.maxActive, 1);
  assert.equal(result.captureIndex.provider_request_count, 6);
  assert.equal(result.captureIndex.terminal_count, 6);

  const directory = phase2rdRunDirectory(RUN_ID, { runtimeDirectory });
  const files = await readdir(directory);
  assert.equal(files.filter((name) => name.endsWith(".intent.json")).length, 6);
  assert.equal(files.filter((name) => name.endsWith(".terminal.json")).length, 6);
  assert.equal(files.filter((name) => name === "capture-index.json").length, 1);
  for (const fileName of files.filter((name) => name.endsWith(".json"))) {
    assert.equal((await stat(path.join(directory, fileName))).mode & 0o777, 0o600);
  }
  const persisted = await Promise.all(
    files
      .filter((name) => name.endsWith(".json"))
      .map((name) => readFile(path.join(directory, name), "utf8")),
  );
  assert.doesNotMatch(persisted.join("\n"), new RegExp(KEY_CANARY, "u"));
});

test("A clean per-case Git preflight runs exactly six times before each intent", async (t) => {
  const runtimeDirectory = await createAuthorizedRuntime(t);
  const candidates = await referenceCandidatesByInputHash();
  const fake = fakeClient({ candidates });
  const preflights = [];
  await capturePhase2rdCandidates({
    runId: RUN_ID,
    implementationCommitSha: COMMIT,
    modelClient: fake.client,
    runtimeDirectory,
    beforeCasePreflight: async (values) => {
      preflights.push(values);
      return { gitClean: true, commitSha: COMMIT };
    },
  });

  assert.deepEqual(
    preflights.map(({ caseId, caseIndex }) => ({ caseId, caseIndex })),
    PHASE2RD_CASE_IDS.map((caseId, caseIndex) => ({ caseId, caseIndex })),
  );
  assert.equal(preflights.length, 6);
  assert.equal(fake.calls.length, 6);
});

test("Git drift before case two stops before its intent and performs only case one's request", async (t) => {
  const runtimeDirectory = await createAuthorizedRuntime(t);
  const candidates = await referenceCandidatesByInputHash();
  const fake = fakeClient({ candidates });
  let preflightCalls = 0;
  await assert.rejects(
    capturePhase2rdCandidates({
      runId: RUN_ID,
      implementationCommitSha: COMMIT,
      modelClient: fake.client,
      runtimeDirectory,
      beforeCasePreflight: async () => ({
        gitClean: true,
        commitSha: preflightCalls++ === 0 ? COMMIT : "d".repeat(40),
      }),
    }),
    (error) => error.code === "implementation_not_frozen",
  );

  assert.equal(preflightCalls, 2);
  assert.deepEqual(fake.calls.map(({ caseId }) => caseId), ["DEV001"]);
  const directory = phase2rdRunDirectory(RUN_ID, { runtimeDirectory });
  const files = await readdir(directory);
  assert.ok(files.includes("01-DEV001.intent.json"));
  assert.ok(files.includes("01-DEV001.terminal.json"));
  assert.equal(files.includes("02-DEV005.intent.json"), false);
  assert.equal(files.includes("02-DEV005.terminal.json"), false);
  const batch = JSON.parse(
    await readFile(path.join(directory, "batch-terminal.json"), "utf8"),
  );
  assert.equal(batch.error.code, "implementation_not_frozen");
  assert.deepEqual(batch.request_intent_case_ids, ["DEV001"]);
  assert.deepEqual(batch.attempted_case_ids, ["DEV001"]);
  assert.deepEqual(batch.unattempted_case_ids, [
    "DEV005", "DEV006", "DEV007", "DEV008", "DEV010",
  ]);
});

test("Persisted request intents are bound to the actual structured request", async (t) => {
  const runtimeDirectory = await createAuthorizedRuntime(t);
  const candidates = await referenceCandidatesByInputHash();
  const fake = fakeClient({ candidates });
  await capturePhase2rdCandidates({
    runId: RUN_ID,
    implementationCommitSha: COMMIT,
    modelClient: fake.client,
    runtimeDirectory,
    beforeCasePreflight: CLEAN_PREFLIGHT,
  });

  const directory = phase2rdRunDirectory(RUN_ID, { runtimeDirectory });
  for (let index = 0; index < PHASE2RD_CASE_IDS.length; index += 1) {
    const caseId = PHASE2RD_CASE_IDS[index];
    const intent = JSON.parse(
      await readFile(
        path.join(
          directory,
          `${String(index + 1).padStart(2, "0")}-${caseId}.intent.json`,
        ),
        "utf8",
      ),
    );
    const requestBody = buildPhase2rcStructuredRequestBody(
      JSON.parse(fake.calls[index].request.input),
    );
    assert.equal(intent.request_payload_hash, hashCanonicalJson(requestBody));
    assert.equal(intent.model_input_hash, fake.calls[index].inputHash);
    assert.equal(intent.max_output_tokens, 8_000);
    assert.equal(intent.timeout_ms, 90_000);
  }
});

test("Candidate failure diagnostic has exact keys and never persists raw canaries", async (t) => {
  const runtimeDirectory = await createAuthorizedRuntime(t);
  const candidates = await referenceCandidatesByInputHash();
  const fake = fakeClient({
    candidates,
    mutateCandidate(candidate, index) {
      if (index === 4) candidate.raw_candidate_canary = RAW_CANARY;
    },
  });
  const result = await capturePhase2rdCandidates({
    runId: RUN_ID,
    implementationCommitSha: COMMIT,
    modelClient: fake.client,
    runtimeDirectory,
    beforeCasePreflight: CLEAN_PREFLIGHT,
  });

  assert.equal(fake.calls.length, 6);
  assert.equal(result.captureIndex.provider_request_count, 6);
  const directory = phase2rdRunDirectory(RUN_ID, { runtimeDirectory });
  const terminal = JSON.parse(
    await readFile(path.join(directory, "05-DEV008.terminal.json"), "utf8"),
  );
  assert.equal(terminal.status, "candidate_invalid");
  assert.equal(terminal.candidate, null);
  assert.match(terminal.candidate_hash, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(Object.keys(terminal.diagnostic).sort(), [
    "candidate_shape",
    "diagnostic_version",
    "field_paths",
    "reason",
    "stage",
  ]);
  assert.equal(terminal.diagnostic.stage, "candidate_validation");
  assert.equal(terminal.diagnostic.candidate_shape.root_type, "object");
  assert.deepEqual(terminal.diagnostic.field_paths, ["$.*"]);

  const allFiles = await readdir(directory);
  const allText = await Promise.all(
    allFiles
      .filter((name) => name.endsWith(".json"))
      .map((name) => readFile(path.join(directory, name), "utf8")),
  );
  const combined = allText.join("\n");
  assert.doesNotMatch(combined, new RegExp(RAW_CANARY, "u"));
  assert.doesNotMatch(combined, /raw_candidate_canary/u);
  assert.doesNotMatch(combined, /provider canary must not persist/u);
});

test("Systemic provider failures stop the batch after one attempt", async (t) => {
  const scenarios = [
    {
      code: "model_auth_failed",
      outcome: "permanent_error",
      httpStatus: 401,
      providerStatus: null,
    },
    {
      code: "model_timeout",
      outcome: "timeout",
      httpStatus: null,
      providerStatus: null,
    },
    {
      code: "model_rate_limited",
      outcome: "rate_limited",
      httpStatus: 429,
      providerStatus: null,
    },
    {
      code: "model_transport_failed",
      outcome: "transient_error",
      httpStatus: 503,
      providerStatus: null,
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.code, async (t) => {
      const runtimeDirectory = await createAuthorizedRuntime(t);
      const candidates = await referenceCandidatesByInputHash();
      const fake = fakeClient({ candidates, failure: scenario });
      await assert.rejects(
        capturePhase2rdCandidates({
          runId: RUN_ID,
          implementationCommitSha: COMMIT,
          modelClient: fake.client,
          runtimeDirectory,
          beforeCasePreflight: CLEAN_PREFLIGHT,
        }),
        (error) =>
          error.code === "phase2rd_systemic_request_failure" &&
          error.triggerCode === scenario.code,
      );
      assert.equal(fake.calls.length, 1);
      const batch = JSON.parse(
        await readFile(
          path.join(
            phase2rdRunDirectory(RUN_ID, { runtimeDirectory }),
            "batch-terminal.json",
          ),
          "utf8",
        ),
      );
      assert.equal(batch.provider_request_count, 1);
      assert.deepEqual(batch.attempted_case_ids, ["DEV001"]);
      assert.deepEqual(batch.unattempted_case_ids, [
        "DEV005", "DEV006", "DEV007", "DEV008", "DEV010",
      ]);
      assert.equal(batch.error.cause_code, scenario.code);
    });
  }
});

test("A failed intent prevents transport and a failed terminal stops before case two", async (t) => {
  const candidates = await referenceCandidatesByInputHash();

  await t.test("intent", async (t) => {
    const runtimeDirectory = await createAuthorizedRuntime(t);
    const fake = fakeClient({ candidates });
    await assert.rejects(
      capturePhase2rdCandidates({
        runId: RUN_ID,
        implementationCommitSha: COMMIT,
        modelClient: fake.client,
        runtimeDirectory,
        beforeCasePreflight: CLEAN_PREFLIGHT,
        writeIntentImpl: async () => {
          throw new Error("intent unavailable");
        },
      }),
    );
    assert.equal(fake.calls.length, 0);
  });

  await t.test("terminal", async (t) => {
    const runtimeDirectory = await createAuthorizedRuntime(t);
    const fake = fakeClient({ candidates });
    await assert.rejects(
      capturePhase2rdCandidates({
        runId: RUN_ID,
        implementationCommitSha: COMMIT,
        modelClient: fake.client,
        runtimeDirectory,
        beforeCasePreflight: CLEAN_PREFLIGHT,
        writeIntentImpl: async (value) => ({
          hash: `sha256:${"1".repeat(64)}`,
          snapshot: value,
        }),
        writeTerminalImpl: async () => {
          throw new Error("terminal unavailable");
        },
      }),
    );
    assert.equal(fake.calls.length, 1);
  });
});

test("Missing or drifted durable authorization performs zero provider attempts", async (t) => {
  const candidates = await referenceCandidatesByInputHash();

  const missingRuntime = await tempRuntime(t, "phase2rd-missing-marker-");
  const missingFake = fakeClient({ candidates });
  await assert.rejects(
    capturePhase2rdCandidates({
      runId: RUN_ID,
      implementationCommitSha: COMMIT,
      modelClient: missingFake.client,
      runtimeDirectory: missingRuntime,
      beforeCasePreflight: CLEAN_PREFLIGHT,
    }),
    (error) => error.code === "phase2rd_authorization_marker_invalid",
  );
  assert.equal(missingFake.calls.length, 0);

  const driftedRuntime = await tempRuntime(t, "phase2rd-drifted-marker-");
  const driftedFake = fakeClient({ candidates });
  await assert.rejects(
    capturePhase2rdCandidates({
      runId: RUN_ID,
      implementationCommitSha: COMMIT,
      modelClient: driftedFake.client,
      runtimeDirectory: driftedRuntime,
      beforeCasePreflight: CLEAN_PREFLIGHT,
      readMarkerImpl: async () => marker({ max_requests: 5 }),
    }),
    (error) => error.code === "phase2rd_authorization_marker_invalid",
  );
  assert.equal(driftedFake.calls.length, 0);
});
