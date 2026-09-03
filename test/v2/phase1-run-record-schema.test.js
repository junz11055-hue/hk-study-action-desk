import assert from "node:assert/strict";
import test from "node:test";

import {
  PHASE1_RUN_RECORD_SCHEMA,
  validatePhase1RunRecord,
} from "../../src/v2/contracts/phase1-run-record-v1.schema.js";
import {
  hashCanonicalJson,
  hashUtf8,
} from "../../src/v2/validation/canonical-json.js";

const promptHash = hashUtf8("phase1 prompt");
const requestPayloadHash = hashCanonicalJson({ input: "synthetic" });
const candidate = { notification_id: "DEV-NOTIF-PAIR-01", claims: [] };
const candidateHash = hashCanonicalJson(candidate);

function successRecord() {
  return {
    record_schema_version: "phase1-run-record-v1",
    run_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    case_id: "DEV001",
    dataset_split: "development",
    execution_mode: "mock",
    status: "succeeded",
    started_at: "2026-08-30T10:00:00.000Z",
    finished_at: "2026-08-30T10:00:01.000Z",
    provider: "mock",
    model: null,
    prompt_version: "notification-candidate-prompt-p1-v1",
    candidate_schema_version: "notification-analysis-candidate-p1-v1",
    schema_dialect: "https://json-schema.org/draft/2020-12/schema",
    attempt_budget_exhausted: false,
    decoding: {
      max_attempts: 3,
      initial_max_output_tokens: 6000,
      truncation_max_output_tokens: 8000,
      timeout_ms: 90000,
    },
    attempts: [
      {
        attempt: 1,
        started_at: "2026-08-30T10:00:00.000Z",
        finished_at: "2026-08-30T10:00:01.000Z",
        outcome: "completed",
        http_status: null,
        input_tokens: 100,
        output_tokens: 200,
        duration_ms: 1000,
        retry_kind: "initial",
        max_output_tokens: 6000,
        prompt_hash: promptHash,
        request_payload_hash: requestPayloadHash,
        error_code: null,
      },
    ],
    hashes: {
      fixture_input_hash: hashCanonicalJson({ case_id: "DEV001" }),
      prompt_hash: promptHash,
      schema_hash: hashCanonicalJson({ type: "object" }),
      model_payload_hash: hashCanonicalJson([requestPayloadHash]),
      candidate_hash: candidateHash,
      delivered_output_hash: candidateHash,
    },
    validation: {
      schema_valid: true,
      references_closed: true,
      locator_quotes_exact: true,
      forbidden_fields_absent: true,
      candidate_unchanged: true,
    },
    candidate: structuredClone(candidate),
    error: null,
  };
}

function failureRecord() {
  const record = successRecord();
  record.execution_mode = "deepseek";
  record.status = "failed";
  record.provider = "deepseek";
  record.model = null;
  record.attempts = [];
  record.hashes.model_payload_hash = null;
  record.hashes.candidate_hash = null;
  record.hashes.delivered_output_hash = null;
  record.validation = {
    schema_valid: false,
    references_closed: false,
    locator_quotes_exact: false,
    forbidden_fields_absent: false,
    candidate_unchanged: false,
  };
  record.candidate = null;
  record.error = {
    code: "model_not_configured",
    message: "DeepSeek is not configured.",
  };
  return record;
}

test("run record schema freezes Draft 2020-12 and rejects extra properties", () => {
  assert.equal(
    PHASE1_RUN_RECORD_SCHEMA.$schema,
    "https://json-schema.org/draft/2020-12/schema",
  );
  assert.equal(validatePhase1RunRecord(successRecord()).valid, true);
  assert.equal(validatePhase1RunRecord(failureRecord()).valid, true);

  const extra = successRecord();
  extra.unapproved = true;
  assert.equal(validatePhase1RunRecord(extra).valid, false);

  const nestedExtra = successRecord();
  nestedExtra.attempts[0].raw_response = "must not be recorded";
  assert.equal(validatePhase1RunRecord(nestedExtra).valid, false);
});

test("success and failure terminal states cannot be mixed", () => {
  const successWithError = successRecord();
  successWithError.error = { code: "internal_error", message: "wrong" };
  assert.equal(validatePhase1RunRecord(successWithError).valid, false);

  const failureWithCandidate = failureRecord();
  failureWithCandidate.candidate = candidate;
  assert.equal(validatePhase1RunRecord(failureWithCandidate).valid, false);

  const queued = successRecord();
  queued.status = "queued";
  assert.equal(validatePhase1RunRecord(queued).valid, false);

  const impossibleDate = successRecord();
  impossibleDate.finished_at = "2026-02-31T10:00:01.000Z";
  assert.equal(validatePhase1RunRecord(impossibleDate).valid, false);
});

test("hash links prove ordered payloads and unchanged delivered candidate", () => {
  const wrongPayload = successRecord();
  wrongPayload.hashes.model_payload_hash = hashCanonicalJson([]);
  assert.equal(validatePhase1RunRecord(wrongPayload).valid, false);

  const changedCandidate = successRecord();
  changedCandidate.candidate.claims.push({ claim_id: "changed" });
  const result = validatePhase1RunRecord(changedCandidate);
  assert.equal(result.valid, false);
  assert.equal(
    result.errors.some((error) => error.instancePath === "/hashes/candidate_hash"),
    true,
  );

  const wrongPrompt = successRecord();
  wrongPrompt.attempts[0].prompt_hash = hashUtf8("different prompt");
  assert.equal(validatePhase1RunRecord(wrongPrompt).valid, false);
});

test("attempts are continuous and share one capped decoding budget", () => {
  const record = failureRecord();
  const first = successRecord().attempts[0];
  first.outcome = "transient_error";
  first.error_code = "model_transport_failed";
  const second = {
    ...structuredClone(first),
    attempt: 2,
    retry_kind: "transport",
    started_at: "2026-08-30T10:00:01.000Z",
    finished_at: "2026-08-30T10:00:02.000Z",
    request_payload_hash: hashCanonicalJson({ attempt: 2 }),
  };
  const third = {
    ...structuredClone(second),
    attempt: 3,
    started_at: "2026-08-30T10:00:02.000Z",
    finished_at: "2026-08-30T10:00:03.000Z",
    request_payload_hash: hashCanonicalJson({ attempt: 3 }),
  };
  record.attempts = [first, second, third];
  record.attempt_budget_exhausted = true;
  record.hashes.model_payload_hash = hashCanonicalJson(
    record.attempts.map((attempt) => attempt.request_payload_hash),
  );
  record.finished_at = third.finished_at;
  record.error = {
    code: "model_transport_failed",
    message: "Provider remained unavailable.",
  };
  assert.equal(validatePhase1RunRecord(record).valid, true);

  const gap = structuredClone(record);
  gap.attempts[1].attempt = 3;
  assert.equal(validatePhase1RunRecord(gap).valid, false);

  const unreportedExhaustion = structuredClone(record);
  unreportedExhaustion.attempt_budget_exhausted = false;
  assert.equal(validatePhase1RunRecord(unreportedExhaustion).valid, false);
});

test("8000 tokens are permitted only as a non-decreasing rise after truncation", () => {
  const bad = failureRecord();
  const first = successRecord().attempts[0];
  first.outcome = "invalid_json";
  first.error_code = "model_response_invalid";
  const second = {
    ...structuredClone(first),
    attempt: 2,
    retry_kind: "invalid_json_repair",
    max_output_tokens: 8000,
    request_payload_hash: hashCanonicalJson({ attempt: 2 }),
  };
  bad.attempts = [first, second];
  bad.hashes.model_payload_hash = hashCanonicalJson(
    bad.attempts.map((attempt) => attempt.request_payload_hash),
  );
  bad.error = {
    code: "model_response_invalid",
    message: "Response remained invalid.",
  };
  assert.equal(validatePhase1RunRecord(bad).valid, false);

  first.outcome = "truncated";
  first.error_code = "model_response_invalid";
  second.retry_kind = "truncation";
  bad.hashes.model_payload_hash = hashCanonicalJson(
    bad.attempts.map((attempt) => attempt.request_payload_hash),
  );
  assert.equal(validatePhase1RunRecord(bad).valid, true);
});
