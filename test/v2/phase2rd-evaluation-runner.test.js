import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  assertValidPhase2rdEvaluationRecord,
} from "../../src/v2/contracts/phase2rd-evaluation-record-v1.schema.js";
import {
  buildReferenceCoreCandidateForEvaluation,
  projectCoreOverlapOracle,
} from "../../src/v2/phase2/core-overlap-oracle-projector.js";
import {
  loadPhase2EvaluationDevelopmentCases,
} from "../../src/v2/phase2/phase2-evaluation-truth-loader.js";
import {
  loadPhase2rDevelopmentInputs,
} from "../../src/v2/phase2r/phase2r-development-input-loader.js";
import {
  buildPhase2rcRequestDescriptor,
} from "../../src/v2/phase2rc/phase2rc-request-contract.js";
import {
  runPhase2rdEvaluation,
} from "../../src/v2/phase2rd/phase2rd-evaluation-runner.js";
import {
  PHASE2RD_AUTHORIZATION_ID,
  PHASE2RD_AUTHORIZATION_VERSION,
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

const RUN_ID = "22222222-2222-4222-8222-222222222222";
const COMMIT = "c".repeat(40);

function clock(...values) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}

function attempt(descriptor, index) {
  return {
    attempt: 1,
    started_at: `2026-09-01T00:00:0${index + 2}.000Z`,
    finished_at: `2026-09-01T00:00:0${index + 2}.010Z`,
    outcome: "completed",
    http_status: 200,
    input_tokens: 100 + index,
    output_tokens: 200 + index,
    reasoning_tokens: 120 + index,
    output_text_tokens: 80,
    duration_ms: 10,
    max_output_tokens: PHASE2RD_MAX_OUTPUT_TOKENS,
    prompt_hash: descriptor.prompt_hash,
    request_payload_hash: descriptor.request_payload_hash,
    provider_status: "completed",
    incomplete_reason: null,
    output_item_types: ["message"],
    output_item_count: 1,
    partial_output_present: false,
    partial_output_bytes: 0,
    partial_output_hash: null,
    error_code: null,
  };
}

async function evaluationFixture({ mutateCandidate } = {}) {
  const [inputs, developmentCases] = await Promise.all([
    loadPhase2rDevelopmentInputs(),
    loadPhase2EvaluationDevelopmentCases(),
  ]);
  const selectedInputs = PHASE2RD_CASE_IDS.map((caseId) =>
    inputs.find((item) => item.caseId === caseId));
  const requestDescriptors = selectedInputs.map((input, index) => {
    const descriptor = buildPhase2rcRequestDescriptor(input.modelInput);
    return {
      case_id: input.caseId,
      case_index: index,
      model_input_hash: descriptor.model_input_hash,
      prompt_hash: descriptor.prompt_hash,
      schema_hash: descriptor.schema_hash,
      request_payload_hash: descriptor.request_payload_hash,
      request_utf8_bytes: descriptor.request_utf8_bytes,
    };
  });
  const marker = {
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
    request_descriptors: requestDescriptors,
    request_descriptor_set_hash: hashCanonicalJson(requestDescriptors),
    max_requests: PHASE2RD_MAX_REQUESTS,
    requests_per_case: PHASE2RD_REQUESTS_PER_CASE,
    serial: PHASE2RD_SERIAL,
    retries: PHASE2RD_RETRIES,
    max_output_tokens: PHASE2RD_MAX_OUTPUT_TOKENS,
    timeout_ms: PHASE2RD_TIMEOUT_MS,
    data_scope: PHASE2RD_DATA_SCOPE,
  };
  const captures = new Map();
  const terminalReferences = [];
  for (let index = 0; index < PHASE2RD_CASE_IDS.length; index += 1) {
    const caseId = PHASE2RD_CASE_IDS[index];
    const input = selectedInputs[index];
    const descriptor = requestDescriptors[index];
    const developmentCase = developmentCases.find(
      ({ case_id: current }) => current === caseId,
    );
    const candidate = buildReferenceCoreCandidateForEvaluation(
      developmentCase,
      projectCoreOverlapOracle(developmentCase),
    );
    mutateCandidate?.(candidate, index, caseId);
    const intent = {
      capture_file_version: PHASE2RD_CAPTURE_FILE_VERSION,
      kind: "request_intent",
      run_id: RUN_ID,
      case_id: caseId,
      case_index: index,
      created_at: `2026-09-01T00:00:0${index + 2}.000Z`,
      implementation_commit_sha: COMMIT,
      provider: PHASE2RD_PROVIDER,
      model: PHASE2RD_MODEL,
      prompt_version: PHASE2RD_PROMPT_VERSION,
      model_input_hash: input.modelInputHash,
      prompt_hash: descriptor.prompt_hash,
      schema_hash: descriptor.schema_hash,
      request_payload_hash: descriptor.request_payload_hash,
      request_utf8_bytes: descriptor.request_utf8_bytes,
      max_output_tokens: PHASE2RD_MAX_OUTPUT_TOKENS,
      timeout_ms: PHASE2RD_TIMEOUT_MS,
    };
    const terminal = {
      capture_file_version: PHASE2RD_CAPTURE_FILE_VERSION,
      kind: "case_terminal",
      run_id: RUN_ID,
      case_id: caseId,
      case_index: index,
      status: "candidate_valid",
      captured_at: `2026-09-01T00:00:0${index + 2}.500Z`,
      intent_hash: hashCanonicalJson(intent),
      model_input_hash: input.modelInputHash,
      request_payload_hash: descriptor.request_payload_hash,
      attempt: attempt(descriptor, index),
      candidate_hash: hashCanonicalJson(candidate),
      candidate,
      validation: {
        schema_valid: true,
        references_closed: true,
        quote_unique: true,
        profile_refs_allowed: true,
        forbidden_fields_absent: true,
        candidate_unchanged: true,
      },
      diagnostic: null,
      error: null,
    };
    captures.set(`${String(index + 1).padStart(2, "0")}-${caseId}.intent.json`, intent);
    captures.set(
      `${String(index + 1).padStart(2, "0")}-${caseId}.terminal.json`,
      terminal,
    );
    terminalReferences.push({
      case_id: caseId,
      case_index: index,
      terminal_hash: hashCanonicalJson(terminal),
    });
  }
  const captureIndex = {
    capture_file_version: PHASE2RD_CAPTURE_FILE_VERSION,
    kind: "capture_index",
    run_id: RUN_ID,
    status: "captured",
    started_at: "2026-09-01T00:00:01.000Z",
    finished_at: "2026-09-01T00:00:10.000Z",
    implementation_commit_sha: COMMIT,
    provider: PHASE2RD_PROVIDER,
    model: PHASE2RD_MODEL,
    prompt_version: PHASE2RD_PROMPT_VERSION,
    planned_case_count: PHASE2RD_CASE_IDS.length,
    request_intent_count: PHASE2RD_CASE_IDS.length,
    provider_request_count: PHASE2RD_CASE_IDS.length,
    terminal_count: PHASE2RD_CASE_IDS.length,
    terminals: terminalReferences,
  };
  captures.set("capture-index.json", captureIndex);
  return { marker, captures, inputs, developmentCases };
}

function optionsFor(fixture, overrides = {}) {
  return {
    runtimeDirectory: "/synthetic/phase2rd-runtime",
    readMarkerImpl: async () => structuredClone(fixture.marker),
    readCaptureImpl: async (filePath) => {
      const value = fixture.captures.get(path.basename(filePath));
      if (value === undefined) throw new Error("missing synthetic capture");
      return structuredClone(value);
    },
    loadInputsImpl: async () => structuredClone(fixture.inputs),
    loadTruthImpl: async () => structuredClone(fixture.developmentCases),
    writeRecordImpl: async (record) => ({
      path: "/synthetic/phase2rd-runtime/evaluation.json",
      hash: hashCanonicalJson(record),
      snapshot: structuredClone(record),
    }),
    clock: clock(
      "2026-09-01T00:00:11.000Z",
      "2026-09-01T00:00:12.000Z",
    ),
    ...overrides,
  };
}

test("Phase 2R-D automatic pass requires 6/6 valid, semantic, and 36/36 exact", async () => {
  const fixture = await evaluationFixture();
  const result = await runPhase2rdEvaluation(optionsFor(fixture));

  assert.equal(result.exitCode, 0);
  assert.equal(result.record.status, "pending_manual_review");
  assert.equal(result.record.summary.valid_candidate_count, 6);
  assert.equal(result.record.summary.technical_invalid_case_count, 0);
  assert.equal(result.record.summary.semantic_gate_passed_case_count, 6);
  assert.equal(result.record.summary.semantic_gate_failed_case_count, 0);
  assert.equal(result.record.summary.automatic_passed_case_count, 6);
  assert.equal(result.record.summary.automatic_dimension_check_count, 36);
  assert.equal(result.record.summary.automatic_dimension_exact_count, 36);
  assert.equal(result.record.summary.p0_error_count, 0);
  assert.equal(result.record.summary.p1_error_count, 0);
  assert.equal(result.record.summary.pending_manual_review_count, 30);
  assert.equal(
    result.record.summary.full_batch_execution_blocked_by_pending_manual_review,
    true,
  );
  assertValidPhase2rdEvaluationRecord(result.record);
  assert.equal(Object.hasOwn(result.record.cases[0], "candidate"), false);
});

test("Expected is loaded only after the complete capture chain is verified", async () => {
  const fixture = await evaluationFixture();
  let captureReads = 0;
  let truthLoads = 0;
  const result = await runPhase2rdEvaluation(
    optionsFor(fixture, {
      readCaptureImpl: async (filePath) => {
        captureReads += 1;
        const value = fixture.captures.get(path.basename(filePath));
        return structuredClone(value);
      },
      loadTruthImpl: async () => {
        truthLoads += 1;
        assert.equal(captureReads, 13);
        return structuredClone(fixture.developmentCases);
      },
    }),
  );

  assert.equal(result.exitCode, 0);
  assert.equal(captureReads, 13);
  assert.equal(truthLoads, 1);
  assert.equal(result.record.safety.expected_loaded_after_capture_verification, true);
});

test("An incomplete or hash-drifted capture blocks truth loading and evaluation", async () => {
  const fixture = await evaluationFixture();
  fixture.captures.get("capture-index.json").terminals[3].terminal_hash =
    `sha256:${"0".repeat(64)}`;
  let truthLoads = 0;

  await assert.rejects(
    runPhase2rdEvaluation(
      optionsFor(fixture, {
        loadTruthImpl: async () => {
          truthLoads += 1;
          return structuredClone(fixture.developmentCases);
        },
      }),
    ),
    (error) => error.code === "phase2rd_capture_invalid",
  );
  assert.equal(truthLoads, 0);
});

test("Any automatic semantic miss fails the six-case smoke gate", async () => {
  const fixture = await evaluationFixture({
    mutateCandidate(candidate, index) {
      if (index === 0) candidate.consequence.level = "low";
    },
  });
  const result = await runPhase2rdEvaluation(optionsFor(fixture));

  assert.equal(result.exitCode, 5);
  assert.equal(result.record.status, "failed");
  assert.equal(result.record.summary.valid_candidate_count, 6);
  assert.ok(result.record.summary.automatic_dimension_exact_count < 36);
  assert.ok(
    result.record.summary.p0_error_count + result.record.summary.p1_error_count > 0,
  );
  assertValidPhase2rdEvaluationRecord(result.record);
});

test("Any Phase 2R-C semantic gate miss fails before manual review", async () => {
  const fixture = await evaluationFixture({
    mutateCandidate(candidate, index) {
      if (index === 0) {
        candidate.claims.forEach((claim) => {
          claim.high_impact = false;
        });
      }
    },
  });
  const result = await runPhase2rdEvaluation(optionsFor(fixture));

  assert.equal(result.exitCode, 5);
  assert.equal(result.record.status, "failed");
  assert.equal(result.record.summary.semantic_gate_failed_case_count, 1);
  assert.equal(result.record.cases[0].semantic_gate.status, "fail");
  assert.ok(result.record.cases[0].semantic_gate.issues.length >= 1);
  assertValidPhase2rdEvaluationRecord(result.record);
});
