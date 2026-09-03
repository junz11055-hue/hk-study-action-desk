import { hashCanonicalJson } from "../../src/v2/validation/canonical-json.js";
import { CORE_BODY, makeCoreCandidate } from "./core-test-fixtures.js";

const HASHES = Object.freeze({
  fixture: `sha256:${"1".repeat(64)}`,
  input: `sha256:${"2".repeat(64)}`,
  prompt: `sha256:${"3".repeat(64)}`,
  schema: `sha256:${"4".repeat(64)}`,
  request: `sha256:${"5".repeat(64)}`,
  partial: `sha256:${"6".repeat(64)}`,
});

export function makeCoreAttempt(overrides = {}) {
  return {
    attempt: 1,
    started_at: "2026-08-31T00:00:00.000Z",
    finished_at: "2026-08-31T00:00:00.010Z",
    outcome: "completed",
    http_status: null,
    input_tokens: null,
    output_tokens: null,
    reasoning_tokens: null,
    output_text_tokens: null,
    duration_ms: 10,
    max_output_tokens: 8000,
    prompt_hash: HASHES.prompt,
    request_payload_hash: HASHES.request,
    provider_status: "completed",
    incomplete_reason: null,
    output_item_types: ["message"],
    output_item_count: 1,
    partial_output_present: false,
    partial_output_bytes: 0,
    partial_output_hash: null,
    error_code: null,
    ...overrides,
  };
}

export function makeCoreSuccessRecord(overrides = {}) {
  const candidate = makeCoreCandidate();
  const candidateHash = hashCanonicalJson(candidate);
  const evidenceLocators = candidate.evidence.map((item) => {
    const start = CORE_BODY.indexOf(item.quote);
    return {
      evidence_id: item.evidence_id,
      kind: "utf16_range",
      start,
      end: start + item.quote.length,
    };
  });
  return {
    record_schema_version: "phase1-core-run-record-v2",
    run_id: "11111111-1111-4111-8111-111111111111",
    case_id: "DEV001",
    dataset_split: "development",
    execution_mode: "mock",
    status: "succeeded",
    started_at: "2026-08-31T00:00:00.000Z",
    finished_at: "2026-08-31T00:00:00.020Z",
    provider: "mock",
    model: null,
    provider_endpoint: null,
    implementation_commit_sha: null,
    implementation_git_clean: null,
    prompt_version: "notification-analysis-core-prompt-p1-v2",
    candidate_schema_version: "notification-analysis-core-candidate-p1-v2",
    schema_dialect: "https://json-schema.org/draft/2020-12/schema",
    attempt_budget_exhausted: false,
    decoding: {
      max_attempts: 1,
      max_output_tokens: 8000,
      timeout_ms: 90000,
    },
    attempts: [makeCoreAttempt()],
    hashes: {
      fixture_input_hash: HASHES.fixture,
      model_input_hash: HASHES.input,
      prompt_hash: HASHES.prompt,
      schema_hash: HASHES.schema,
      model_payload_hash: HASHES.request,
      candidate_hash: candidateHash,
      delivered_output_hash: candidateHash,
      blocked_payload_hash: null,
    },
    validation: {
      schema_valid: true,
      references_closed: true,
      quote_unique: true,
      profile_refs_allowed: true,
      forbidden_fields_absent: true,
      candidate_unchanged: true,
    },
    validation_evidence: {
      evidence_locators: evidenceLocators,
      profile_refs: [
        {
          profile_field_id: "pf-dev001-course-comp7101",
          source: "synthetic_user_confirmed",
          confirmation_status: "confirmed",
          valid_until: "2026-12-31",
          course_status: "confirmed",
        },
      ],
    },
    candidate,
    error: null,
    ...overrides,
  };
}

export function makeCoreFailureRecord(overrides = {}) {
  const record = makeCoreSuccessRecord({
    status: "failed",
    attempt_budget_exhausted: true,
    attempts: [
      makeCoreAttempt({
        outcome: "truncated",
        http_status: 200,
        input_tokens: 500,
        output_tokens: 8000,
        reasoning_tokens: 7900,
        output_text_tokens: 100,
        provider_status: "incomplete",
        incomplete_reason: "max_output_tokens",
        output_item_types: ["reasoning", "message"],
        output_item_count: 2,
        partial_output_present: true,
        partial_output_bytes: 24,
        partial_output_hash: HASHES.partial,
        error_code: "model_response_invalid",
      }),
    ],
    hashes: {
      fixture_input_hash: HASHES.fixture,
      model_input_hash: HASHES.input,
      prompt_hash: HASHES.prompt,
      schema_hash: HASHES.schema,
      model_payload_hash: HASHES.request,
      candidate_hash: null,
      delivered_output_hash: null,
      blocked_payload_hash: null,
    },
    validation: {
      schema_valid: false,
      references_closed: false,
      quote_unique: false,
      profile_refs_allowed: false,
      forbidden_fields_absent: false,
      candidate_unchanged: false,
    },
    validation_evidence: { evidence_locators: [], profile_refs: [] },
    candidate: null,
    error: {
      code: "model_response_invalid",
      message: "The model response was not valid JSON output.",
    },
  });
  return { ...record, ...overrides };
}

export const CORE_RECORD_HASHES = HASHES;
