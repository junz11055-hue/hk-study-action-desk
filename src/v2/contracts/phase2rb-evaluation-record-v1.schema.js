import {
  PHASE2_AUTOMATIC_DIMENSION_NAMES,
  PHASE2_CANDIDATE_SCHEMA_HASH,
  PHASE2_CANDIDATE_SCHEMA_VERSION,
  PHASE2_REVIEW_CODES,
} from "./phase2-evaluation-record-v1.schema.js";
import {
  NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V1,
} from "../prompts/notification-analysis-core-p2-v1.js";
import {
  canonicalJsonStringify,
  hashCanonicalJson,
  hashUtf8,
} from "../validation/canonical-json.js";
import {
  PHASE2RB_CASE_IDS,
  PHASE2RB_CASE_SET_HASH,
  PHASE2RB_CANDIDATE_SCHEMA_VERSION,
  PHASE2RB_DIAGNOSTIC_VERSION,
  PHASE2RB_MAX_OUTPUT_TOKENS,
  PHASE2RB_MAX_REQUEST_UTF8_BYTES,
  PHASE2RB_MAX_REQUESTS,
  PHASE2RB_MAX_TOTAL_OUTPUT_TOKENS,
  PHASE2RB_MODEL,
  PHASE2RB_MODEL_INPUT_SET_HASH,
  PHASE2RB_PROMPT_VERSION,
  PHASE2RB_PROVIDER,
  PHASE2RB_SOURCE_CONTEXT_FILE_HASH,
  PHASE2RB_SOURCE_CONTEXT_SNAPSHOT_HASH,
} from "../phase2rb/phase2rb-run-contract.js";

export const PHASE2RB_EVALUATION_RECORD_VERSION =
  "phase2rb-smoke-evaluation-record-v1";
export const PHASE2RB_FROZEN_PROMPT_HASH = hashUtf8(
  NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V1,
);
export const PHASE2RB_APPROVED_AUTOMATIC_DIMENSION_CHECKS =
  PHASE2RB_CASE_IDS.length * PHASE2_AUTOMATIC_DIMENSION_NAMES.length;
export const PHASE2RB_COST_REASON =
  "The approved spend boundary is four requests with at most 8,000 output tokens and 10,000 request bytes per case; no immutable DeepSeek price snapshot was approved, so no currency estimate is invented.";

export const PHASE2RB_HISTORICAL_BASELINE = Object.freeze({
  baseline_id: "phase2b-selected-case-baseline-v1",
  source_phase: "phase2b",
  selected_case_ids: Object.freeze([...PHASE2RB_CASE_IDS]),
  valid_candidate_count: 2,
  technical_invalid_case_count: 2,
  automatic_passed_case_count: 0,
});

export const PHASE2RB_EVALUATION_CLAIMS = Object.freeze({
  can_prove: Object.freeze([
    "The four frozen synthetic Phase 2R-B captures were hash-verified before development expected data was loaded.",
    "A passed_for_full_batch_decision status means four of four Candidates were technically valid, all 24 automatic dimensions were exact, and no P0 or P1 automatic error remained.",
  ]),
  cannot_prove: Object.freeze([
    "This four-case visible synthetic smoke cannot prove full revised-development quality, locked-set performance, real-email quality, production readiness, or product Harness behavior.",
    "Twenty pending manual semantic reviews block direct execution of the full 16-case batch and cannot be treated as completed by this automatic evaluator.",
  ]),
});

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
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
const DIAGNOSTIC_STAGES = new Set([
  "candidate_validation",
  "provider_response",
]);
const DIAGNOSTIC_REASONS = new Set([
  "schema_invalid",
  "reference_invalid",
  "evidence_invalid",
  "language_invalid",
  "forbidden_field",
  "candidate_unserializable",
  "output_truncated",
  "invalid_json",
  "model_refused",
  "provider_failure",
  "provider_incomplete",
  "harness_failure",
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
    value !== null &&
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

function count(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function nullableCount(value) {
  return value === null || count(value);
}

function boundedString(value, max = 1_000) {
  return typeof value === "string" && value.length >= 1 && value.length <= max;
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

function fail(message) {
  const error = new Error(message);
  error.name = "Phase2rbEvaluationRecordValidationError";
  error.code = "phase2rb_evaluation_record_invalid";
  throw error;
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
    attempt.max_output_tokens !== PHASE2RB_MAX_OUTPUT_TOKENS ||
    attempt.prompt_hash !== PHASE2RB_FROZEN_PROMPT_HASH ||
    attempt.request_payload_hash !== requestPayloadHash ||
    !(attempt.provider_status === null ||
      PROVIDER_STATUSES.has(attempt.provider_status)) ||
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
    attempt.output_item_count > 1_024 ||
    typeof attempt.partial_output_present !== "boolean" ||
    !count(attempt.partial_output_bytes) ||
    !(attempt.partial_output_hash === null ||
      HASH_PATTERN.test(attempt.partial_output_hash ?? "")) ||
    !(attempt.error_code === null ||
      SNAKE_CASE_PATTERN.test(attempt.error_code ?? ""))
  ) {
    fail("A Phase 2R-B attempt record is invalid or contains unapproved fields");
  }
  if (
    attempt.partial_output_present !== (attempt.partial_output_bytes > 0) ||
    attempt.partial_output_present !== (attempt.partial_output_hash !== null) ||
    (attempt.provider_status !== "incomplete" &&
      attempt.incomplete_reason !== null) ||
    (attempt.output_tokens !== null &&
      attempt.output_tokens > PHASE2RB_MAX_OUTPUT_TOKENS)
  ) {
    fail("A Phase 2R-B attempt diagnostic is internally inconsistent");
  }
}

export function assertValidPhase2rbAttempt(attempt, requestPayloadHash) {
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
    fail("Phase 2R-B technical validation flags are invalid");
  }
}

function assertAutomatic(automatic) {
  if (
    !exactKeys(automatic, ["passed", "dimensions", "totals"]) ||
    typeof automatic.passed !== "boolean" ||
    !exactKeys(automatic.dimensions, PHASE2_AUTOMATIC_DIMENSION_NAMES) ||
    !exactKeys(automatic.totals, [
      "dimensions_total",
      "dimensions_exact",
      "tp",
      "fp",
      "fn",
    ])
  ) {
    fail("Phase 2R-B automatic evaluation shape is invalid");
  }
  let exact = 0;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const name of PHASE2_AUTOMATIC_DIMENSION_NAMES) {
    const dimension = automatic.dimensions[name];
    if (
      !exactKeys(dimension, [
        "comparison",
        "exact",
        "tp",
        "fp",
        "fn",
        "expected",
        "actual",
      ]) ||
      dimension.comparison !== DIMENSION_COMPARISONS[name] ||
      typeof dimension.exact !== "boolean" ||
      !count(dimension.tp) ||
      !count(dimension.fp) ||
      !count(dimension.fn) ||
      !safeJsonValue(dimension.expected) ||
      !safeJsonValue(dimension.actual) ||
      dimension.exact !== (dimension.fp === 0 && dimension.fn === 0)
    ) {
      fail("A Phase 2R-B automatic dimension is invalid");
    }
    exact += dimension.exact ? 1 : 0;
    tp += dimension.tp;
    fp += dimension.fp;
    fn += dimension.fn;
  }
  if (
    automatic.totals.dimensions_total !==
      PHASE2_AUTOMATIC_DIMENSION_NAMES.length ||
    automatic.totals.dimensions_exact !== exact ||
    automatic.totals.tp !== tp ||
    automatic.totals.fp !== fp ||
    automatic.totals.fn !== fn ||
    automatic.passed !==
      (exact === PHASE2_AUTOMATIC_DIMENSION_NAMES.length)
  ) {
    fail("Phase 2R-B automatic totals do not close over their dimensions");
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
    fail("Phase 2R-B evaluation errors are invalid");
  }
}

function assertReviewQueue(reviewQueue) {
  if (
    !Array.isArray(reviewQueue) ||
    reviewQueue.length !== PHASE2_REVIEW_CODES.length
  ) {
    fail("Phase 2R-B review queue must contain five pending items per case");
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
      fail("Phase 2R-B review queue must remain pending");
    }
    codes.push(review.code);
  }
  if (!sameJson([...codes].sort(), [...PHASE2_REVIEW_CODES].sort())) {
    fail("Phase 2R-B review queue is incomplete");
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
    fail("Phase 2R-B excluded fields are invalid");
  }
}

function assertCandidateShape(shape) {
  if (!shape || typeof shape !== "object" || Array.isArray(shape)) {
    fail("Phase 2R-B failure diagnostic candidate shape is invalid");
  }
  if (shape.root_type === "object") {
    const countKeys = [
      "topics_count",
      "claims_count",
      "evidence_count",
      "actions_count",
      "deadlines_count",
    ];
    if (
      !exactKeys(shape, ["root_type", ...countKeys]) ||
      countKeys.some(
        (key) => shape[key] !== null && (!count(shape[key]) || shape[key] > 1_000),
      )
    ) {
      fail("Phase 2R-B object diagnostic shape is invalid");
    }
    return;
  }
  if (
    !["null", "array", "string", "number", "boolean", "undefined", "bigint", "symbol", "function"].includes(
      shape.root_type,
    ) ||
    !exactKeys(shape, ["root_type"])
  ) {
    fail("Phase 2R-B scalar diagnostic shape is invalid");
  }
}

export function assertValidPhase2rbDiagnostic(diagnostic) {
  if (
    !exactKeys(diagnostic, [
      "diagnostic_version",
      "stage",
      "reason",
      "field_paths",
      "candidate_shape",
    ]) ||
    diagnostic.diagnostic_version !== PHASE2RB_DIAGNOSTIC_VERSION ||
    !DIAGNOSTIC_STAGES.has(diagnostic.stage) ||
    !DIAGNOSTIC_REASONS.has(diagnostic.reason) ||
    !Array.isArray(diagnostic.field_paths) ||
    diagnostic.field_paths.length > 8 ||
    new Set(diagnostic.field_paths).size !== diagnostic.field_paths.length ||
    diagnostic.field_paths.some(
      (item) =>
        typeof item !== "string" ||
        item.length > 80 ||
        !/^(?:\$\.\*|\$\.(?:title_zh|title_claim_refs|summary_zh|summary_claim_refs|topics|claims|evidence|actions|deadlines|applicability|consequence)(?:\[\*\])?(?:\.(?:[a-z_]+|\*))?)$/u.test(item),
    )
  ) {
    fail("Phase 2R-B failure diagnostic is invalid");
  }
  if (diagnostic.stage === "provider_response") {
    if (diagnostic.candidate_shape !== null || diagnostic.field_paths.length !== 0) {
      fail("A provider diagnostic cannot retain Candidate details");
    }
  } else {
    assertCandidateShape(diagnostic.candidate_shape);
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
    "diagnostic",
    "capture_error",
  ];
  if (
    !exactKeys(item, keys) ||
    !PHASE2RB_CASE_IDS.includes(item.case_id) ||
    !["en", "zh-Hant", "mixed", "zh-Hans"].includes(item.language) ||
    !HASH_PATTERN.test(item.model_input_hash ?? "") ||
    !HASH_PATTERN.test(item.request_payload_hash ?? "") ||
    !["candidate_valid", "candidate_invalid", "request_failed"].includes(
      item.capture_status,
    )
  ) {
    fail("Phase 2R-B case envelope is invalid");
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
      item.diagnostic !== null ||
      item.automatic === null ||
      item.attempt.outcome !== "completed" ||
      item.attempt.provider_status !== "completed"
    ) {
      fail("A valid Phase 2R-B Candidate requires a closed successful attempt");
    }
    assertAutomatic(item.automatic);
  } else {
    if (
      !(item.candidate_hash === null || HASH_PATTERN.test(item.candidate_hash ?? "")) ||
      item.automatic !== null ||
      !exactKeys(item.capture_error, ["code"]) ||
      !SNAKE_CASE_PATTERN.test(item.capture_error.code ?? "") ||
      item.diagnostic === null
    ) {
      fail("An invalid Phase 2R-B capture is not closed safely");
    }
    assertValidPhase2rbDiagnostic(item.diagnostic);
  }
}

export function phase2rbEvaluationPayload(record) {
  const { canonical_evaluation_hash: ignored, ...payload } = record;
  void ignored;
  return payload;
}

export function computePhase2rbEvaluationHash(record) {
  return hashCanonicalJson(phase2rbEvaluationPayload(record));
}

function sumOptional(cases, key) {
  const values = cases.map((item) => item.attempt[key]);
  return values.some((value) => value === null)
    ? null
    : values.reduce((total, value) => total + value, 0);
}

export function buildPhase2rbEvaluationSummary(cases) {
  const valid = cases.filter((item) => item.capture_status === "candidate_valid");
  const automaticDimensionCheckCount = valid.reduce(
    (total, item) => total + item.automatic.totals.dimensions_total,
    0,
  );
  const automaticDimensionExactCount = valid.reduce(
    (total, item) => total + item.automatic.totals.dimensions_exact,
    0,
  );
  const errors = cases.flatMap((item) => item.errors);
  return {
    planned_case_count: PHASE2RB_CASE_IDS.length,
    provider_request_count: cases.length,
    valid_candidate_count: valid.length,
    technical_invalid_case_count: PHASE2RB_CASE_IDS.length - valid.length,
    automatic_passed_case_count: valid.filter((item) => item.automatic.passed)
      .length,
    automatic_failed_case_count: valid.filter((item) => !item.automatic.passed)
      .length,
    automatic_dimension_check_count: automaticDimensionCheckCount,
    automatic_dimension_exact_count: automaticDimensionExactCount,
    approved_automatic_dimension_check_count:
      PHASE2RB_APPROVED_AUTOMATIC_DIMENSION_CHECKS,
    p0_error_count: errors.filter((item) => item.severity === "P0").length,
    p1_error_count: errors.filter((item) => item.severity === "P1").length,
    observation_error_count: errors.filter(
      (item) => item.severity === "observation",
    ).length,
    pending_manual_review_count: cases.reduce(
      (total, item) => total + item.review_queue.length,
      0,
    ),
    full_batch_execution_blocked_by_pending_manual_review: true,
    total_input_tokens: sumOptional(cases, "input_tokens"),
    total_output_tokens: sumOptional(cases, "output_tokens"),
    total_duration_ms: cases.reduce(
      (total, item) => total + item.attempt.duration_ms,
      0,
    ),
    approved_max_provider_requests: PHASE2RB_MAX_REQUESTS,
    approved_max_output_tokens_per_request: PHASE2RB_MAX_OUTPUT_TOKENS,
    approved_max_total_output_tokens: PHASE2RB_MAX_TOTAL_OUTPUT_TOKENS,
    approved_max_request_utf8_bytes_per_case:
      PHASE2RB_MAX_REQUEST_UTF8_BYTES,
    estimated_cost: null,
    estimated_cost_reason: PHASE2RB_COST_REASON,
  };
}

export function phase2rbPassedForFullBatchDecision(summary) {
  return (
    summary.valid_candidate_count === PHASE2RB_CASE_IDS.length &&
    summary.technical_invalid_case_count === 0 &&
    summary.automatic_passed_case_count === PHASE2RB_CASE_IDS.length &&
    summary.automatic_failed_case_count === 0 &&
    summary.automatic_dimension_check_count ===
      PHASE2RB_APPROVED_AUTOMATIC_DIMENSION_CHECKS &&
    summary.automatic_dimension_exact_count ===
      PHASE2RB_APPROVED_AUTOMATIC_DIMENSION_CHECKS &&
    summary.p0_error_count === 0 &&
    summary.p1_error_count === 0
  );
}

export function assertValidPhase2rbEvaluationRecord(record) {
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
      "prompt_hash",
      "candidate_schema_version",
      "candidate_schema_hash",
      "diagnostic_version",
      "case_set_hash",
      "model_input_set_hash",
      "source_context_snapshot_hash",
      "source_context_file_hash",
      "authorization_marker_hash",
      "capture_index_hash",
      "safety",
      "historical_baseline",
      "cases",
      "summary",
      "claims",
      "canonical_evaluation_hash",
    ]) ||
    record.record_version !== PHASE2RB_EVALUATION_RECORD_VERSION ||
    record.phase !== "phase2r-b" ||
    !["passed_for_full_batch_decision", "failed"].includes(record.status) ||
    !UUID_PATTERN.test(record.run_id ?? "") ||
    !strictTimestamp(record.started_at) ||
    !strictTimestamp(record.finished_at) ||
    Date.parse(record.finished_at) < Date.parse(record.started_at) ||
    record.provider !== PHASE2RB_PROVIDER ||
    record.model !== PHASE2RB_MODEL ||
    !COMMIT_PATTERN.test(record.implementation_commit_sha ?? "") ||
    record.prompt_version !== PHASE2RB_PROMPT_VERSION ||
    record.prompt_hash !== PHASE2RB_FROZEN_PROMPT_HASH ||
    record.candidate_schema_version !== PHASE2RB_CANDIDATE_SCHEMA_VERSION ||
    record.candidate_schema_version !== PHASE2_CANDIDATE_SCHEMA_VERSION ||
    record.candidate_schema_hash !== PHASE2_CANDIDATE_SCHEMA_HASH ||
    record.diagnostic_version !== PHASE2RB_DIAGNOSTIC_VERSION ||
    record.case_set_hash !== PHASE2RB_CASE_SET_HASH ||
    record.model_input_set_hash !== PHASE2RB_MODEL_INPUT_SET_HASH ||
    record.source_context_snapshot_hash !==
      PHASE2RB_SOURCE_CONTEXT_SNAPSHOT_HASH ||
    record.source_context_file_hash !== PHASE2RB_SOURCE_CONTEXT_FILE_HASH ||
    !HASH_PATTERN.test(record.authorization_marker_hash ?? "") ||
    !HASH_PATTERN.test(record.capture_index_hash ?? "") ||
    !sameJson(record.historical_baseline, PHASE2RB_HISTORICAL_BASELINE) ||
    !Array.isArray(record.cases) ||
    record.cases.length !== PHASE2RB_CASE_IDS.length ||
    record.cases.some(
      (item, index) => item?.case_id !== PHASE2RB_CASE_IDS[index],
    ) ||
    !sameJson(record.claims, PHASE2RB_EVALUATION_CLAIMS)
  ) {
    fail("Phase 2R-B evaluation record envelope is invalid");
  }

  if (
    !exactKeys(record.safety, [
      "evaluation_process_key_reads",
      "evaluation_process_network_connections",
      "locked_file_accesses",
      "real_data_records",
      "listening_ports",
      "expected_loaded_after_capture_verification",
      "full_batch_provider_requests",
    ]) ||
    record.safety.evaluation_process_key_reads !== 0 ||
    record.safety.evaluation_process_network_connections !== 0 ||
    record.safety.locked_file_accesses !== 0 ||
    record.safety.real_data_records !== 0 ||
    record.safety.listening_ports !== 0 ||
    record.safety.expected_loaded_after_capture_verification !== true ||
    record.safety.full_batch_provider_requests !== 0
  ) {
    fail("Phase 2R-B evaluation safety assertion is invalid");
  }

  for (const item of record.cases) assertCase(item);
  const summary = buildPhase2rbEvaluationSummary(record.cases);
  if (!sameJson(record.summary, summary)) {
    fail("Phase 2R-B summary does not close over the four case records");
  }
  if (
    record.summary.pending_manual_review_count !== 20 ||
    record.summary.full_batch_execution_blocked_by_pending_manual_review !== true
  ) {
    fail("Phase 2R-B must retain all 20 pending manual reviews");
  }
  const expectedStatus = phase2rbPassedForFullBatchDecision(summary)
    ? "passed_for_full_batch_decision"
    : "failed";
  if (record.status !== expectedStatus) {
    fail("Phase 2R-B status does not match its strict smoke gate");
  }
  if (
    record.canonical_evaluation_hash !==
      computePhase2rbEvaluationHash(record)
  ) {
    fail("Phase 2R-B canonical evaluation hash is invalid");
  }
  if (Buffer.byteLength(canonicalJsonStringify(record), "utf8") > 750_000) {
    fail("Phase 2R-B evaluation record is too large");
  }
  return record;
}
