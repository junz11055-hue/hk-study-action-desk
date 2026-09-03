import {
  PHASE2_AUTOMATIC_DIMENSION_NAMES,
  PHASE2_CANDIDATE_SCHEMA_HASH,
  PHASE2_CANDIDATE_SCHEMA_VERSION,
  PHASE2_DEVELOPMENT_CASE_IDS,
  PHASE2_REVIEW_CODES,
} from "./phase2-evaluation-record-v1.schema.js";
import {
  CORE_PROMPT_VERSION,
  NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2,
} from "../prompts/notification-analysis-core-p1-v2.js";
import {
  canonicalJsonStringify,
  hashCanonicalJson,
  hashUtf8,
} from "../validation/canonical-json.js";

export const PHASE2B_EVALUATION_RECORD_VERSION =
  "phase2b-development-evaluation-record-v1";
export const PHASE2B_FROZEN_MODEL = "deepseek-v4-flash";
export const PHASE2B_FROZEN_MAX_OUTPUT_TOKENS = 8_000;
export const PHASE2B_FROZEN_MAX_REQUEST_UTF8_BYTES = 10_000;
export const PHASE2B_APPROVED_MAX_TOTAL_OUTPUT_TOKENS = 128_000;
export const PHASE2B_FROZEN_PROMPT_HASH = hashUtf8(
  NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2,
);
export const PHASE2B_COST_REASON =
  "The approved spend boundary is 16 requests with at most 8,000 output tokens and 10,000 request bytes per case; no immutable DeepSeek price snapshot was approved, so no currency estimate is invented.";

export const PHASE2B_EVALUATION_CLAIMS = Object.freeze({
  can_prove: Object.freeze([
    "The approved Phase 2B batch captured at most one DeepSeek attempt for each frozen synthetic development case.",
    "Automatic Core-overlap evaluation was performed only after all 16 capture terminals were hash-verified.",
  ]),
  cannot_prove: Object.freeze([
    "This visible synthetic development batch cannot prove locked-set performance, real-email quality, production readiness, or product Harness behavior.",
    "Phase 2B cannot pass until every manual semantic review is explicitly closed.",
  ]),
});

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SNAKE_CASE_PATTERN = /^[a-z][a-z0-9_]{0,95}$/u;
const ATTEMPT_OUTCOMES = new Set([
  "completed",
  "timeout",
  "rate_limited",
  "transient_error",
  "permanent_error",
  "truncated",
  "invalid_json",
  "candidate_invalid",
  "harness_error",
  "refused",
]);
const PROVIDER_STATUSES = new Set([
  "cancelled",
  "completed",
  "failed",
  "in_progress",
  "incomplete",
  "queued",
  "refused",
]);
const DIMENSION_COMPARISONS = Object.freeze({
  topics: "set",
  applicability_value: "scalar",
  profile_field_ids: "set",
  actions: "multiset",
  deadlines: "multiset",
  consequence_level: "scalar",
});

function sameJson(left, right) {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

function exactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    sameJson(Object.keys(value).sort(), [...keys].sort())
  );
}

function strictTimestamp(value) {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function boundedString(value, max = 1_000) {
  return typeof value === "string" && value.length >= 1 && value.length <= max;
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function nullableCount(value) {
  return value === null || count(value);
}

function safeJsonValue(value, depth = 0) {
  if (depth > 8) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= 1_000;
  if (Array.isArray(value)) {
    return value.length <= 64 && value.every((item) => safeJsonValue(item, depth + 1));
  }
  if (!value || typeof value !== "object") return false;
  const keys = Object.keys(value);
  return (
    keys.length <= 64 &&
    keys.every((key) => key.length >= 1 && key.length <= 96) &&
    keys.every((key) => safeJsonValue(value[key], depth + 1))
  );
}

function assertAttempt(attempt, requestPayloadHash) {
  const keys = [
    "attempt",
    "started_at",
    "finished_at",
    "outcome",
    "http_status",
    "input_tokens",
    "output_tokens",
    "reasoning_tokens",
    "output_text_tokens",
    "duration_ms",
    "max_output_tokens",
    "prompt_hash",
    "request_payload_hash",
    "provider_status",
    "incomplete_reason",
    "output_item_types",
    "output_item_count",
    "partial_output_present",
    "partial_output_bytes",
    "partial_output_hash",
    "error_code",
  ];
  if (
    !exactKeys(attempt, keys) ||
    attempt.attempt !== 1 ||
    !strictTimestamp(attempt.started_at) ||
    !strictTimestamp(attempt.finished_at) ||
    Date.parse(attempt.finished_at) < Date.parse(attempt.started_at) ||
    !ATTEMPT_OUTCOMES.has(attempt.outcome) ||
    !(attempt.http_status === null ||
      (Number.isInteger(attempt.http_status) &&
        attempt.http_status >= 100 &&
        attempt.http_status <= 599)) ||
    !nullableCount(attempt.input_tokens) ||
    !nullableCount(attempt.output_tokens) ||
    !nullableCount(attempt.reasoning_tokens) ||
    !nullableCount(attempt.output_text_tokens) ||
    !count(attempt.duration_ms) ||
    attempt.max_output_tokens !== PHASE2B_FROZEN_MAX_OUTPUT_TOKENS ||
    attempt.prompt_hash !== PHASE2B_FROZEN_PROMPT_HASH ||
    attempt.request_payload_hash !== requestPayloadHash ||
    !(attempt.provider_status === null || PROVIDER_STATUSES.has(attempt.provider_status)) ||
    !(attempt.incomplete_reason === null ||
      ["max_output_tokens", "content_filter", "unknown"].includes(
        attempt.incomplete_reason,
      )) ||
    !Array.isArray(attempt.output_item_types) ||
    attempt.output_item_types.length > 16 ||
    attempt.output_item_types.some(
      (item) => typeof item !== "string" || !/^[a-z][a-z0-9_]{0,63}$/u.test(item),
    ) ||
    !count(attempt.output_item_count) ||
    attempt.output_item_count < attempt.output_item_types.length ||
    typeof attempt.partial_output_present !== "boolean" ||
    !count(attempt.partial_output_bytes) ||
    !(attempt.partial_output_hash === null ||
      HASH_PATTERN.test(attempt.partial_output_hash ?? "")) ||
    !(attempt.error_code === null || SNAKE_CASE_PATTERN.test(attempt.error_code ?? ""))
  ) {
    fail("A Phase 2B attempt record is invalid or contains unapproved fields");
  }
  if (
    attempt.partial_output_present !== (attempt.partial_output_bytes > 0) ||
    attempt.partial_output_present !== (attempt.partial_output_hash !== null) ||
    (attempt.provider_status !== "incomplete" && attempt.incomplete_reason !== null)
  ) {
    fail("A Phase 2B attempt diagnostic is internally inconsistent");
  }
  if (
    attempt.output_tokens !== null &&
    attempt.output_tokens > PHASE2B_FROZEN_MAX_OUTPUT_TOKENS
  ) {
    fail("A Phase 2B attempt exceeded its approved output-token budget");
  }
}

export function assertValidPhase2bAttempt(attempt, requestPayloadHash) {
  assertAttempt(attempt, requestPayloadHash);
  return attempt;
}

function assertTechnicalValidation(validation, valid) {
  const keys = [
    "schema_valid",
    "references_closed",
    "quote_unique",
    "profile_refs_allowed",
    "forbidden_fields_absent",
    "candidate_unchanged",
  ];
  if (
    !exactKeys(validation, keys) ||
    keys.some((key) => typeof validation[key] !== "boolean") ||
    (valid && keys.some((key) => validation[key] !== true))
  ) {
    fail("Phase 2B technical validation flags are invalid");
  }
}

function assertAutomatic(automatic) {
  if (
    !exactKeys(automatic, ["passed", "dimensions", "totals"]) ||
    typeof automatic.passed !== "boolean" ||
    !exactKeys(automatic.dimensions, PHASE2_AUTOMATIC_DIMENSION_NAMES) ||
    !exactKeys(automatic.totals, ["dimensions_total", "dimensions_exact", "tp", "fp", "fn"])
  ) {
    fail("Phase 2B automatic evaluation shape is invalid");
  }
  let exact = 0;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const name of PHASE2_AUTOMATIC_DIMENSION_NAMES) {
    const dimension = automatic.dimensions[name];
    if (
      !exactKeys(dimension, ["comparison", "exact", "tp", "fp", "fn", "expected", "actual"]) ||
      dimension.comparison !== DIMENSION_COMPARISONS[name] ||
      typeof dimension.exact !== "boolean" ||
      !count(dimension.tp) ||
      !count(dimension.fp) ||
      !count(dimension.fn) ||
      !safeJsonValue(dimension.expected) ||
      !safeJsonValue(dimension.actual) ||
      dimension.exact !== (dimension.fp === 0 && dimension.fn === 0)
    ) {
      fail("A Phase 2B automatic dimension is invalid");
    }
    exact += dimension.exact ? 1 : 0;
    tp += dimension.tp;
    fp += dimension.fp;
    fn += dimension.fn;
  }
  if (
    automatic.totals.dimensions_total !== PHASE2_AUTOMATIC_DIMENSION_NAMES.length ||
    automatic.totals.dimensions_exact !== exact ||
    automatic.totals.tp !== tp ||
    automatic.totals.fp !== fp ||
    automatic.totals.fn !== fn ||
    automatic.passed !== (exact === PHASE2_AUTOMATIC_DIMENSION_NAMES.length)
  ) {
    fail("Phase 2B automatic totals do not close over their dimensions");
  }
}

function assertEvaluationErrors(errors) {
  if (
    !Array.isArray(errors) ||
    errors.length > 128 ||
    errors.some(
      (error) =>
        !exactKeys(error, ["code", "severity", "path", "expected", "actual"]) ||
        !SNAKE_CASE_PATTERN.test(error.code ?? "") ||
        !["P0", "P1", "observation"].includes(error.severity) ||
        !boundedString(error.path, 300) ||
        !safeJsonValue(error.expected) ||
        !safeJsonValue(error.actual),
    )
  ) {
    fail("Phase 2B evaluation errors are invalid");
  }
}

function assertReviewQueue(reviewQueue) {
  if (!Array.isArray(reviewQueue) || reviewQueue.length !== PHASE2_REVIEW_CODES.length) {
    fail("Phase 2B initial review queue must contain five pending items");
  }
  const codes = [];
  for (const review of reviewQueue) {
    if (
      !exactKeys(review, ["code", "path", "status", "instruction"]) ||
      !PHASE2_REVIEW_CODES.includes(review.code) ||
      review.status !== "pending" ||
      !boundedString(review.path, 300) ||
      !boundedString(review.instruction, 500)
    ) {
      fail("Phase 2B initial review queue must contain five pending items");
    }
    codes.push(review.code);
  }
  if (!sameJson([...codes].sort(), [...PHASE2_REVIEW_CODES].sort())) {
    fail("Phase 2B initial review queue must contain five pending items");
  }
}

function assertExcludedFields(excludedFields) {
  if (
    !Array.isArray(excludedFields) ||
    excludedFields.length > 128 ||
    excludedFields.some(
      (item) =>
        !exactKeys(item, ["path", "reason_code", "reason"]) ||
        !boundedString(item.path, 300) ||
        !SNAKE_CASE_PATTERN.test(item.reason_code ?? "") ||
        !boundedString(item.reason, 500),
    )
  ) {
    fail("Phase 2B excluded fields are invalid");
  }
}

function assertCase(item) {
  const keys = [
    "case_id",
    "language",
    "model_input_hash",
    "request_payload_hash",
    "capture_status",
    "attempt",
    "candidate_hash",
    "technical_validation",
    "automatic",
    "errors",
    "review_queue",
    "excluded_fields",
    "capture_error",
  ];
  if (
    !exactKeys(item, keys) ||
    !["en", "zh-Hant", "mixed", "zh-Hans"].includes(item.language) ||
    !HASH_PATTERN.test(item.model_input_hash ?? "") ||
    !HASH_PATTERN.test(item.request_payload_hash ?? "") ||
    !["candidate_valid", "candidate_invalid", "request_failed"].includes(
      item.capture_status,
    )
  ) {
    fail("Phase 2B case envelope is invalid");
  }
  assertAttempt(item.attempt, item.request_payload_hash);
  const valid = item.capture_status === "candidate_valid";
  assertTechnicalValidation(item.technical_validation, valid);
  assertEvaluationErrors(item.errors);
  assertReviewQueue(item.review_queue);
  assertExcludedFields(item.excluded_fields);
  if (valid) {
    if (
      !HASH_PATTERN.test(item.candidate_hash ?? "") ||
      item.capture_error !== null ||
      item.automatic === null ||
      item.attempt.outcome !== "completed" ||
      item.attempt.provider_status !== "completed"
    ) {
      fail("A valid Phase 2B Candidate requires a closed successful attempt");
    }
    assertAutomatic(item.automatic);
  } else if (
    !(item.candidate_hash === null || HASH_PATTERN.test(item.candidate_hash ?? "")) ||
    item.automatic !== null ||
    !exactKeys(item.capture_error, ["code"]) ||
    !SNAKE_CASE_PATTERN.test(item.capture_error.code ?? "")
  ) {
    fail("An invalid Phase 2B capture is not closed safely");
  }
}

function fail(message) {
  const error = new Error(message);
  error.name = "Phase2bEvaluationRecordValidationError";
  error.code = "phase2b_evaluation_record_invalid";
  throw error;
}

export function phase2bEvaluationPayload(record) {
  return {
    capture_index_hash: record.capture_index_hash,
    cases: record.cases,
    summary: record.summary,
    claims: record.claims,
  };
}

export function computePhase2bEvaluationHash(record) {
  return hashCanonicalJson(phase2bEvaluationPayload(record));
}

function sumOptional(cases, key) {
  const values = cases.map((item) => item.attempt?.[key] ?? null);
  return values.some((value) => value === null)
    ? null
    : values.reduce((total, value) => total + value, 0);
}

export function assertValidPhase2bEvaluationRecord(record) {
  if (
    !exactKeys(record, [
      "record_version",
      "run_id",
      "phase",
      "status",
      "started_at",
      "finished_at",
      "provider",
      "model",
      "implementation_commit_sha",
      "prompt_version",
      "candidate_schema_version",
      "candidate_schema_hash",
      "capture_index_hash",
      "safety",
      "cases",
      "summary",
      "claims",
      "canonical_evaluation_hash",
    ]) ||
    record.record_version !== PHASE2B_EVALUATION_RECORD_VERSION ||
    record.phase !== "phase2b" ||
    !["awaiting_manual_review", "technical_failed"].includes(record.status) ||
    !UUID_PATTERN.test(record.run_id ?? "") ||
    !strictTimestamp(record.started_at) ||
    !strictTimestamp(record.finished_at) ||
    Date.parse(record.finished_at) < Date.parse(record.started_at) ||
    record.provider !== "deepseek" ||
    record.model !== PHASE2B_FROZEN_MODEL ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(
      record.implementation_commit_sha ?? "",
    ) ||
    record.candidate_schema_version !== PHASE2_CANDIDATE_SCHEMA_VERSION ||
    record.candidate_schema_hash !== PHASE2_CANDIDATE_SCHEMA_HASH ||
    record.prompt_version !== CORE_PROMPT_VERSION ||
    !HASH_PATTERN.test(record.capture_index_hash ?? "") ||
    !Array.isArray(record.cases) ||
    record.cases.length !== 16 ||
    record.cases.some(
      (item, index) => item?.case_id !== PHASE2_DEVELOPMENT_CASE_IDS[index],
    ) ||
    !sameJson(record.claims, PHASE2B_EVALUATION_CLAIMS)
  ) {
    fail("Phase 2B evaluation record envelope is invalid");
  }

  if (
    !exactKeys(record.safety, [
      "evaluation_process_key_reads",
      "evaluation_process_network_connections",
      "locked_file_accesses",
      "real_data_records",
      "listening_ports",
      "expected_loaded_after_capture_verification",
    ]) ||
    record.safety.evaluation_process_key_reads !== 0 ||
    record.safety.evaluation_process_network_connections !== 0 ||
    record.safety.locked_file_accesses !== 0 ||
    record.safety.real_data_records !== 0 ||
    record.safety.listening_ports !== 0 ||
    record.safety.expected_loaded_after_capture_verification !== true
  ) {
    fail("Phase 2B evaluation safety assertion is invalid");
  }

  let validCandidates = 0;
  let automaticPassed = 0;
  let pendingReviews = 0;
  for (const item of record.cases) {
    assertCase(item);
    pendingReviews += item.review_queue.length;
    if (item.capture_status === "candidate_valid") {
      validCandidates += 1;
      if (!HASH_PATTERN.test(item.candidate_hash ?? "") || !item.automatic) {
        fail("A valid Phase 2B Candidate requires hash and automatic evaluation");
      }
      if (item.automatic.passed === true) automaticPassed += 1;
    } else if (item.automatic !== null) {
      fail("An invalid Phase 2B capture cannot claim an automatic evaluation");
    }
  }

  const attempts = record.cases.filter((item) => item.attempt !== null).length;
  const inputTokens = sumOptional(record.cases, "input_tokens");
  const outputTokens = sumOptional(record.cases, "output_tokens");
  const durationMs = record.cases.reduce(
    (total, item) => total + (item.attempt?.duration_ms ?? 0),
    0,
  );
  const expectedSummary = {
    planned_case_count: 16,
    provider_request_count: attempts,
    valid_candidate_count: validCandidates,
    technical_invalid_case_count: 16 - validCandidates,
    automatic_passed_case_count: automaticPassed,
    automatic_failed_case_count: validCandidates - automaticPassed,
    pending_manual_review_count: pendingReviews,
    total_input_tokens: inputTokens,
    total_output_tokens: outputTokens,
    total_duration_ms: durationMs,
    approved_max_provider_requests: 16,
    approved_max_output_tokens_per_request: PHASE2B_FROZEN_MAX_OUTPUT_TOKENS,
    approved_max_total_output_tokens: PHASE2B_APPROVED_MAX_TOTAL_OUTPUT_TOKENS,
    approved_max_request_utf8_bytes_per_case:
      PHASE2B_FROZEN_MAX_REQUEST_UTF8_BYTES,
    estimated_cost: null,
    estimated_cost_reason: PHASE2B_COST_REASON,
  };
  if (!sameJson(record.summary, expectedSummary)) {
    fail("Phase 2B summary does not close over the 16 case records");
  }
  const expectedStatus = validCandidates === 16
    ? "awaiting_manual_review"
    : "technical_failed";
  if (record.status !== expectedStatus) {
    fail("Phase 2B status does not match technical Candidate closure");
  }
  if (record.canonical_evaluation_hash !== computePhase2bEvaluationHash(record)) {
    fail("Phase 2B canonical evaluation hash is invalid");
  }
  if (Buffer.byteLength(canonicalJsonStringify(record), "utf8") > 2_000_000) {
    fail("Phase 2B evaluation record is too large");
  }
  return record;
}
