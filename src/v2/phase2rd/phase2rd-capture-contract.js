import {
  canonicalJsonStringify,
  hashCanonicalJson,
} from "../validation/canonical-json.js";
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
  PHASE2RD_MAX_REQUEST_UTF8_BYTES,
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
} from "./phase2rd-run-contract.js";

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SNAKE_CASE_PATTERN = /^[a-z][a-z0-9_]{0,95}$/u;
const OUTPUT_ITEM_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;
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
const ROOT_TYPES = new Set([
  "array",
  "bigint",
  "boolean",
  "function",
  "null",
  "number",
  "object",
  "string",
  "symbol",
  "undefined",
]);
const VALIDATION_KEYS = Object.freeze([
  "schema_valid",
  "references_closed",
  "quote_unique",
  "profile_refs_allowed",
  "forbidden_fields_absent",
  "candidate_unchanged",
]);
const ATTEMPT_KEYS = Object.freeze([
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
]);
const MARKER_KEYS = Object.freeze([
  "authorization_version",
  "authorization_id",
  "status",
  "run_id",
  "consumed_at",
  "implementation_commit_sha",
  "case_ids",
  "case_set_hash",
  "provider",
  "model",
  "prompt_version",
  "prompt_hash",
  "candidate_schema_version",
  "schema_hash",
  "diagnostic_version",
  "base_snapshot_hash",
  "base_snapshot_file_hash",
  "model_input_set_hash",
  "source_context_snapshot_hash",
  "source_context_file_hash",
  "request_descriptors",
  "request_descriptor_set_hash",
  "max_requests",
  "requests_per_case",
  "serial",
  "retries",
  "max_output_tokens",
  "timeout_ms",
  "data_scope",
]);
const DESCRIPTOR_KEYS = Object.freeze([
  "case_id",
  "case_index",
  "model_input_hash",
  "prompt_hash",
  "schema_hash",
  "request_payload_hash",
  "request_utf8_bytes",
]);
const INTENT_KEYS = Object.freeze([
  "capture_file_version",
  "kind",
  "run_id",
  "case_id",
  "case_index",
  "created_at",
  "implementation_commit_sha",
  "provider",
  "model",
  "prompt_version",
  "model_input_hash",
  "prompt_hash",
  "schema_hash",
  "request_payload_hash",
  "request_utf8_bytes",
  "max_output_tokens",
  "timeout_ms",
]);
const TERMINAL_KEYS = Object.freeze([
  "capture_file_version",
  "kind",
  "run_id",
  "case_id",
  "case_index",
  "status",
  "captured_at",
  "intent_hash",
  "model_input_hash",
  "request_payload_hash",
  "attempt",
  "candidate_hash",
  "candidate",
  "validation",
  "diagnostic",
  "error",
]);
const INDEX_KEYS = Object.freeze([
  "capture_file_version",
  "kind",
  "run_id",
  "status",
  "started_at",
  "finished_at",
  "implementation_commit_sha",
  "provider",
  "model",
  "prompt_version",
  "planned_case_count",
  "request_intent_count",
  "provider_request_count",
  "terminal_count",
  "terminals",
]);
const BATCH_TERMINAL_KEYS = Object.freeze([
  "capture_file_version",
  "kind",
  "run_id",
  "status",
  "finished_at",
  "implementation_commit_sha",
  "planned_case_count",
  "request_intent_count",
  "provider_request_count",
  "case_terminal_count",
  "attempted_case_count",
  "unattempted_case_count",
  "request_intent_case_ids",
  "attempted_case_ids",
  "unattempted_case_ids",
  "case_terminal_ids",
  "error",
]);

export class Phase2rdCaptureContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "Phase2rdCaptureContractError";
    this.code = "phase2rd_capture_contract_invalid";
  }
}
function fail(message) {
  throw new Phase2rdCaptureContractError(message);
}

function exactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJsonStringify(Object.keys(value).sort()) ===
      canonicalJsonStringify([...keys].sort())
  );
}

function sameJson(left, right) {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
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

function assertCase(caseId, caseIndex) {
  if (
    !Number.isInteger(caseIndex) ||
    caseIndex < 0 ||
    caseIndex >= PHASE2RD_CASE_IDS.length ||
    caseId !== PHASE2RD_CASE_IDS[caseIndex]
  ) {
    fail("Case identity does not match the frozen Phase 2R-D order");
  }
}

function orderedSubset(values) {
  if (!Array.isArray(values) || new Set(values).size !== values.length) return false;
  let previous = -1;
  for (const value of values) {
    const index = PHASE2RD_CASE_IDS.indexOf(value);
    if (index < 0 || index <= previous) return false;
    previous = index;
  }
  return true;
}

function assertValidation(validation, requireAllTrue = false) {
  if (
    !exactKeys(validation, VALIDATION_KEYS) ||
    VALIDATION_KEYS.some((key) => typeof validation[key] !== "boolean") ||
    (requireAllTrue && VALIDATION_KEYS.some((key) => validation[key] !== true))
  ) {
    fail("Technical validation flags are invalid");
  }
}

function safeDiagnosticPath(value) {
  return (
    typeof value === "string" &&
    value.length <= 80 &&
    /^(?:\$\.\*|\$\.(?:title_zh|title_claim_refs|summary_zh|summary_claim_refs|topics|claims|evidence|actions|deadlines|applicability|consequence)(?:\[\*\])?(?:\.(?:[a-z_]+|\*))?)$/u.test(
      value,
    )
  );
}

function assertCandidateShape(shape) {
  if (!shape || typeof shape !== "object" || Array.isArray(shape)) {
    fail("Diagnostic candidate_shape is invalid");
  }
  if (shape.root_type !== "object") {
    if (!exactKeys(shape, ["root_type"]) || !ROOT_TYPES.has(shape.root_type)) {
      fail("Diagnostic root_type is invalid");
    }
    return;
  }
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
      (key) =>
        shape[key] !== null &&
        (!count(shape[key]) || shape[key] > 1_000),
    )
  ) {
    fail("Diagnostic candidate_shape counts are invalid");
  }
}

export function assertValidPhase2rdDiagnostic(diagnostic) {
  if (
    !exactKeys(diagnostic, [
      "diagnostic_version",
      "stage",
      "reason",
      "field_paths",
      "candidate_shape",
    ]) ||
    diagnostic.diagnostic_version !== PHASE2RD_DIAGNOSTIC_VERSION ||
    !["candidate_validation", "provider_response"].includes(diagnostic.stage) ||
    !DIAGNOSTIC_REASONS.has(diagnostic.reason) ||
    !Array.isArray(diagnostic.field_paths) ||
    diagnostic.field_paths.length > 8 ||
    new Set(diagnostic.field_paths).size !== diagnostic.field_paths.length ||
    diagnostic.field_paths.some((value) => !safeDiagnosticPath(value))
  ) {
    fail("Diagnostic contains unknown or unsafe fields");
  }
  if (diagnostic.stage === "provider_response") {
    if (diagnostic.field_paths.length !== 0 || diagnostic.candidate_shape !== null) {
      fail("Provider diagnostic retained Candidate detail");
    }
  } else {
    assertCandidateShape(diagnostic.candidate_shape);
  }
  return diagnostic;
}

export function assertValidPhase2rdAttempt(attempt, requestPayloadHash) {
  if (
    !exactKeys(attempt, ATTEMPT_KEYS) ||
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
    attempt.max_output_tokens !== PHASE2RD_MAX_OUTPUT_TOKENS ||
    attempt.prompt_hash !== PHASE2RD_PROMPT_HASH ||
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
      (item) => typeof item !== "string" || !OUTPUT_ITEM_PATTERN.test(item),
    ) ||
    !count(attempt.output_item_count) ||
    attempt.output_item_count < attempt.output_item_types.length ||
    attempt.output_item_count > 1_024 ||
    typeof attempt.partial_output_present !== "boolean" ||
    !count(attempt.partial_output_bytes) ||
    !(attempt.partial_output_hash === null ||
      HASH_PATTERN.test(attempt.partial_output_hash ?? "")) ||
    !(attempt.error_code === null ||
      SNAKE_CASE_PATTERN.test(attempt.error_code ?? "")) ||
    attempt.partial_output_present !== (attempt.partial_output_bytes > 0) ||
    attempt.partial_output_present !== (attempt.partial_output_hash !== null) ||
    (attempt.provider_status !== "incomplete" &&
      attempt.incomplete_reason !== null) ||
    (attempt.output_tokens !== null &&
      attempt.output_tokens > PHASE2RD_MAX_OUTPUT_TOKENS)
  ) {
    fail("Attempt contains unknown fields or violates the one-attempt contract");
  }
  return attempt;
}

function assertDescriptor(descriptor, caseIndex) {
  assertCase(descriptor?.case_id, descriptor?.case_index);
  if (
    !exactKeys(descriptor, DESCRIPTOR_KEYS) ||
    descriptor.case_index !== caseIndex ||
    !HASH_PATTERN.test(descriptor.model_input_hash ?? "") ||
    descriptor.prompt_hash !== PHASE2RD_PROMPT_HASH ||
    descriptor.schema_hash !== PHASE2RD_SCHEMA_HASH ||
    !HASH_PATTERN.test(descriptor.request_payload_hash ?? "") ||
    !Number.isSafeInteger(descriptor.request_utf8_bytes) ||
    descriptor.request_utf8_bytes < 1 ||
    descriptor.request_utf8_bytes > PHASE2RD_MAX_REQUEST_UTF8_BYTES
  ) {
    fail("Request descriptor is invalid");
  }
}

export function assertValidPhase2rdAuthorizationMarker(marker) {
  if (
    !exactKeys(marker, MARKER_KEYS) ||
    marker.authorization_version !== PHASE2RD_AUTHORIZATION_VERSION ||
    marker.authorization_id !== PHASE2RD_AUTHORIZATION_ID ||
    marker.status !== "consumed" ||
    !UUID_PATTERN.test(marker.run_id ?? "") ||
    !strictTimestamp(marker.consumed_at) ||
    !COMMIT_PATTERN.test(marker.implementation_commit_sha ?? "") ||
    !sameJson(marker.case_ids, PHASE2RD_CASE_IDS) ||
    marker.case_set_hash !== PHASE2RD_CASE_SET_HASH ||
    marker.provider !== PHASE2RD_PROVIDER ||
    marker.model !== PHASE2RD_MODEL ||
    marker.prompt_version !== PHASE2RD_PROMPT_VERSION ||
    marker.prompt_hash !== PHASE2RD_PROMPT_HASH ||
    marker.candidate_schema_version !== PHASE2RD_CANDIDATE_SCHEMA_VERSION ||
    marker.schema_hash !== PHASE2RD_SCHEMA_HASH ||
    marker.diagnostic_version !== PHASE2RD_DIAGNOSTIC_VERSION ||
    marker.base_snapshot_hash !== PHASE2RD_BASE_SNAPSHOT_HASH ||
    marker.base_snapshot_file_hash !== PHASE2RD_BASE_SNAPSHOT_FILE_HASH ||
    marker.model_input_set_hash !== PHASE2RD_MODEL_INPUT_SET_HASH ||
    marker.source_context_snapshot_hash !==
      PHASE2RD_SOURCE_CONTEXT_SNAPSHOT_HASH ||
    marker.source_context_file_hash !== PHASE2RD_SOURCE_CONTEXT_FILE_HASH ||
    !Array.isArray(marker.request_descriptors) ||
    marker.request_descriptors.length !== PHASE2RD_MAX_REQUESTS ||
    marker.request_descriptor_set_hash !==
      hashCanonicalJson(marker.request_descriptors) ||
    marker.max_requests !== PHASE2RD_MAX_REQUESTS ||
    marker.requests_per_case !== PHASE2RD_REQUESTS_PER_CASE ||
    marker.serial !== PHASE2RD_SERIAL ||
    marker.retries !== PHASE2RD_RETRIES ||
    marker.max_output_tokens !== PHASE2RD_MAX_OUTPUT_TOKENS ||
    marker.timeout_ms !== PHASE2RD_TIMEOUT_MS ||
    marker.data_scope !== PHASE2RD_DATA_SCOPE
  ) {
    fail("Authorization marker contains unknown fields or drifted constants");
  }
  marker.request_descriptors.forEach(assertDescriptor);
  return marker;
}

export function assertValidPhase2rdRequestIntent(intent) {
  assertCase(intent?.case_id, intent?.case_index);
  if (
    !exactKeys(intent, INTENT_KEYS) ||
    intent.capture_file_version !== PHASE2RD_CAPTURE_FILE_VERSION ||
    intent.kind !== "request_intent" ||
    !UUID_PATTERN.test(intent.run_id ?? "") ||
    !strictTimestamp(intent.created_at) ||
    !COMMIT_PATTERN.test(intent.implementation_commit_sha ?? "") ||
    intent.provider !== PHASE2RD_PROVIDER ||
    intent.model !== PHASE2RD_MODEL ||
    intent.prompt_version !== PHASE2RD_PROMPT_VERSION ||
    !HASH_PATTERN.test(intent.model_input_hash ?? "") ||
    intent.prompt_hash !== PHASE2RD_PROMPT_HASH ||
    intent.schema_hash !== PHASE2RD_SCHEMA_HASH ||
    !HASH_PATTERN.test(intent.request_payload_hash ?? "") ||
    !Number.isSafeInteger(intent.request_utf8_bytes) ||
    intent.request_utf8_bytes < 1 ||
    intent.request_utf8_bytes > PHASE2RD_MAX_REQUEST_UTF8_BYTES ||
    intent.max_output_tokens !== PHASE2RD_MAX_OUTPUT_TOKENS ||
    intent.timeout_ms !== PHASE2RD_TIMEOUT_MS
  ) {
    fail("Request intent contains unknown fields or drifted constants");
  }
  return intent;
}

export function assertValidPhase2rdCaseTerminal(terminal) {
  assertCase(terminal?.case_id, terminal?.case_index);
  if (
    !exactKeys(terminal, TERMINAL_KEYS) ||
    terminal.capture_file_version !== PHASE2RD_CAPTURE_FILE_VERSION ||
    terminal.kind !== "case_terminal" ||
    !UUID_PATTERN.test(terminal.run_id ?? "") ||
    !["candidate_valid", "candidate_invalid", "request_failed"].includes(
      terminal.status,
    ) ||
    !strictTimestamp(terminal.captured_at) ||
    !HASH_PATTERN.test(terminal.intent_hash ?? "") ||
    !HASH_PATTERN.test(terminal.model_input_hash ?? "") ||
    !HASH_PATTERN.test(terminal.request_payload_hash ?? "")
  ) {
    fail("Case terminal contains unknown fields or an invalid envelope");
  }
  assertValidation(
    terminal.validation,
    terminal.status === "candidate_valid",
  );
  if (terminal.attempt !== null) {
    assertValidPhase2rdAttempt(
      terminal.attempt,
      terminal.request_payload_hash,
    );
  }
  if (terminal.status === "candidate_valid") {
    let candidateHash;
    try {
      candidateHash = hashCanonicalJson(terminal.candidate);
    } catch {
      fail("Valid Candidate is not canonical JSON");
    }
    if (
      !terminal.candidate ||
      typeof terminal.candidate !== "object" ||
      Array.isArray(terminal.candidate) ||
      terminal.attempt === null ||
      terminal.attempt.outcome !== "completed" ||
      terminal.attempt.provider_status !== "completed" ||
      terminal.candidate_hash !== candidateHash ||
      terminal.diagnostic !== null ||
      terminal.error !== null ||
      Buffer.byteLength(canonicalJsonStringify(terminal.candidate), "utf8") >
        1_000_000
    ) {
      fail("Valid Candidate terminal is not closed safely");
    }
  } else {
    if (
      terminal.candidate !== null ||
      !(terminal.candidate_hash === null ||
        HASH_PATTERN.test(terminal.candidate_hash ?? "")) ||
      !exactKeys(terminal.error, ["code"]) ||
      !SNAKE_CASE_PATTERN.test(terminal.error.code ?? "") ||
      terminal.diagnostic === null
    ) {
      fail("Failure terminal retained a Candidate or omitted safe diagnostics");
    }
    assertValidPhase2rdDiagnostic(terminal.diagnostic);
  }
  return terminal;
}

export function assertValidPhase2rdCaptureIndex(index) {
  if (
    !exactKeys(index, INDEX_KEYS) ||
    index.capture_file_version !== PHASE2RD_CAPTURE_FILE_VERSION ||
    index.kind !== "capture_index" ||
    index.status !== "captured" ||
    !UUID_PATTERN.test(index.run_id ?? "") ||
    !strictTimestamp(index.started_at) ||
    !strictTimestamp(index.finished_at) ||
    Date.parse(index.finished_at) < Date.parse(index.started_at) ||
    !COMMIT_PATTERN.test(index.implementation_commit_sha ?? "") ||
    index.provider !== PHASE2RD_PROVIDER ||
    index.model !== PHASE2RD_MODEL ||
    index.prompt_version !== PHASE2RD_PROMPT_VERSION ||
    index.planned_case_count !== PHASE2RD_MAX_REQUESTS ||
    index.request_intent_count !== PHASE2RD_MAX_REQUESTS ||
    index.provider_request_count !== PHASE2RD_MAX_REQUESTS ||
    index.terminal_count !== PHASE2RD_MAX_REQUESTS ||
    !Array.isArray(index.terminals) ||
    index.terminals.length !== PHASE2RD_MAX_REQUESTS ||
    index.terminals.some(
      (reference, caseIndex) =>
        !exactKeys(reference, ["case_id", "case_index", "terminal_hash"]) ||
        reference.case_id !== PHASE2RD_CASE_IDS[caseIndex] ||
        reference.case_index !== caseIndex ||
        !HASH_PATTERN.test(reference.terminal_hash ?? ""),
    )
  ) {
    fail("Capture index is incomplete or contains unknown fields");
  }
  return index;
}

export function assertValidPhase2rdBatchTerminal(terminal) {
  if (
    !exactKeys(terminal, BATCH_TERMINAL_KEYS) ||
    terminal.capture_file_version !== PHASE2RD_CAPTURE_FILE_VERSION ||
    terminal.kind !== "batch_terminal" ||
    terminal.status !== "failed" ||
    !UUID_PATTERN.test(terminal.run_id ?? "") ||
    !strictTimestamp(terminal.finished_at) ||
    !COMMIT_PATTERN.test(terminal.implementation_commit_sha ?? "") ||
    terminal.planned_case_count !== PHASE2RD_MAX_REQUESTS ||
    !count(terminal.request_intent_count) ||
    !count(terminal.provider_request_count) ||
    !count(terminal.case_terminal_count) ||
    !count(terminal.attempted_case_count) ||
    !count(terminal.unattempted_case_count) ||
    terminal.request_intent_count > PHASE2RD_MAX_REQUESTS ||
    terminal.provider_request_count > 16 ||
    terminal.case_terminal_count > PHASE2RD_MAX_REQUESTS ||
    !orderedSubset(terminal.request_intent_case_ids) ||
    !orderedSubset(terminal.attempted_case_ids) ||
    !orderedSubset(terminal.case_terminal_ids) ||
    !orderedSubset(terminal.unattempted_case_ids) ||
    terminal.request_intent_count !== terminal.request_intent_case_ids.length ||
    terminal.provider_request_count < terminal.attempted_case_ids.length ||
    terminal.case_terminal_count !== terminal.case_terminal_ids.length ||
    terminal.attempted_case_count !== terminal.attempted_case_ids.length ||
    terminal.unattempted_case_count !== terminal.unattempted_case_ids.length ||
    terminal.attempted_case_count + terminal.unattempted_case_count !==
      PHASE2RD_MAX_REQUESTS ||
    !sameJson(
      terminal.unattempted_case_ids,
      PHASE2RD_CASE_IDS.filter(
        (caseId) => !terminal.attempted_case_ids.includes(caseId),
      ),
    ) ||
    !exactKeys(terminal.error, ["code", "cause_code"]) ||
    !SNAKE_CASE_PATTERN.test(terminal.error.code ?? "") ||
    !(terminal.error.cause_code === null ||
      SNAKE_CASE_PATTERN.test(terminal.error.cause_code ?? ""))
  ) {
    fail("Failed batch terminal is internally inconsistent");
  }
  return terminal;
}

export function assertValidPhase2rdCaptureFile(value) {
  if (value?.kind === "request_intent") {
    return assertValidPhase2rdRequestIntent(value);
  }
  if (value?.kind === "case_terminal") {
    return assertValidPhase2rdCaseTerminal(value);
  }
  if (value?.kind === "capture_index") {
    return assertValidPhase2rdCaptureIndex(value);
  }
  if (value?.kind === "batch_terminal") {
    return assertValidPhase2rdBatchTerminal(value);
  }
  fail("Unknown Phase 2R-D capture file kind");
}
