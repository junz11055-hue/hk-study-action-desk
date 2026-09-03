import {
  CoreContentPayloadGuard,
  Phase1CoreModelAdapterError,
} from "../model/phase1-core-model-adapter.js";
import {
  analyzePhase2rdCoreCandidate,
  buildPhase2rdRequestDescriptor,
} from "../model/phase2rd-core-model-adapter.js";
import { PHASE2_DEVELOPMENT_CASE_IDS } from "../phase2/development-input-loader.js";
import { loadPhase2rDevelopmentInputs } from "../phase2r/phase2r-development-input-loader.js";
import {
  canonicalJsonStringify,
  hashCanonicalJson,
} from "../validation/canonical-json.js";
import { assertValidPhase2rdAuthorizationMarker } from "./phase2rd-capture-contract.js";
import {
  PHASE2RD_BASE_URL,
  PHASE2RD_CAPTURE_FILE_VERSION,
  PHASE2RD_CASE_IDS,
  PHASE2RD_CLIENT_MAX_RETRIES,
  PHASE2RD_DIAGNOSTIC_VERSION,
  PHASE2RD_MAX_OUTPUT_TOKENS,
  PHASE2RD_MAX_REQUESTS,
  PHASE2RD_MAX_REQUEST_UTF8_BYTES,
  PHASE2RD_MODEL,
  PHASE2RD_PROMPT_VERSION,
  PHASE2RD_PROVIDER,
  PHASE2RD_TIMEOUT_MS,
} from "./phase2rd-run-contract.js";
import {
  readPhase2rdAuthorizationMarker,
  writePhase2rdBatchTerminal,
  writePhase2rdCaptureIndex,
  writePhase2rdCaseTerminal,
  writePhase2rdRequestIntent,
} from "./phase2rd-capture-store.js";

const GIT_COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SAFE_ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,95}$/u;
const SAFE_OUTPUT_ITEM_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;

const SYSTEMIC_STOP_CODES = new Set([
  "duplicate_payload_blocked",
  "fixture_invalid",
  "model_auth_failed",
  "model_not_configured",
  "model_configuration_invalid",
  "model_timeout",
  "model_rate_limited",
  "model_transport_failed",
  "internal_error",
]);
const CANDIDATE_FAILURE_CODES = new Set([
  "candidate_schema_invalid",
  "candidate_reference_invalid",
  "candidate_evidence_invalid",
  "candidate_language_invalid",
  "candidate_forbidden_field",
  "model_response_invalid",
  "model_refused",
]);
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
export class Phase2rdCaptureError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "Phase2rdCaptureError";
    this.code = code;
    this.triggerCode = options.triggerCode ?? null;
    this.batchTerminalWritten = options.batchTerminalWritten ?? false;
    this.batchTerminalPath = options.batchTerminalPath ?? null;
    this.batchTerminalSnapshot = options.batchTerminalSnapshot ?? null;
  }
}

export class Phase2rdRequestBudget {
  #caseIds;
  #used = [];

  constructor(caseIds = PHASE2RD_CASE_IDS) {
    if (
      !Array.isArray(caseIds) ||
      canonicalJsonStringify(caseIds) !==
        canonicalJsonStringify(PHASE2RD_CASE_IDS)
    ) {
      throw new TypeError("Phase 2R-D budget requires the six frozen cases");
    }
    this.#caseIds = [...caseIds];
  }

  reserve(caseId) {
    const expected = this.#caseIds[this.#used.length];
    if (expected === undefined) {
      throw new Phase2rdCaptureError(
        "phase2rd_request_budget_exhausted",
        "The Phase 2R-D batch cannot exceed six request intents.",
      );
    }
    if (caseId !== expected || this.#used.includes(caseId)) {
      throw new Phase2rdCaptureError(
        "phase2rd_case_order_invalid",
        "Phase 2R-D cases must be requested once in frozen order.",
      );
    }
    this.#used.push(caseId);
    return this.#used.length;
  }

  get used() {
    return this.#used.length;
  }

  get complete() {
    return this.#used.length === this.#caseIds.length;
  }
}

function isoNow(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("clock must return a date");
  return date.toISOString();
}

function exactKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function strictTimestamp(value) {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function nullableCount(value) {
  return value === null || safeCount(value);
}

function safeErrorCode(value, fallback = "phase2rd_capture_failed") {
  return typeof value === "string" && SAFE_ERROR_CODE_PATTERN.test(value)
    ? value
    : fallback;
}

function frozenCaseIds(values) {
  if (!Array.isArray(values)) return [];
  const allowed = new Set(PHASE2RD_CASE_IDS);
  return [...new Set(values.filter((value) => allowed.has(value)))];
}

function assertAuthorizationMarker(
  marker,
  { runId, implementationCommitSha, requestDescriptors },
) {
  try {
    assertValidPhase2rdAuthorizationMarker(marker);
  } catch {
    throw new Phase2rdCaptureError(
      "phase2rd_authorization_marker_invalid",
      "The durable Phase 2R-D marker does not match the frozen batch.",
    );
  }
  if (
    marker.run_id !== runId ||
    marker.implementation_commit_sha !== implementationCommitSha ||
    canonicalJsonStringify(marker.request_descriptors) !==
      canonicalJsonStringify(requestDescriptors)
  ) {
    throw new Phase2rdCaptureError(
      "phase2rd_authorization_marker_invalid",
      "The durable Phase 2R-D marker does not match this frozen run.",
    );
  }
}

function assertClient(modelClient) {
  if (
    modelClient?.provider !== PHASE2RD_PROVIDER ||
    modelClient?.configured !== true ||
    modelClient?.model !== PHASE2RD_MODEL ||
    modelClient?.baseUrl !== PHASE2RD_BASE_URL ||
    modelClient?.timeoutMs !== PHASE2RD_TIMEOUT_MS ||
    modelClient?.maxRetries !== PHASE2RD_CLIENT_MAX_RETRIES ||
    modelClient?.logger != null ||
    typeof modelClient?.createStructuredAttempt !== "function"
  ) {
    throw new Phase2rdCaptureError(
      "model_configuration_invalid",
      "Phase 2R-D DeepSeek configuration is not frozen.",
    );
  }
}

function selectInputs(inputs) {
  if (
    !Array.isArray(inputs) ||
    inputs.length !== PHASE2_DEVELOPMENT_CASE_IDS.length ||
    inputs.some(
      (input, index) => input?.caseId !== PHASE2_DEVELOPMENT_CASE_IDS[index],
    )
  ) {
    throw new Phase2rdCaptureError(
      "phase2rd_input_set_invalid",
      "The answer-free Phase 2R Input set is not frozen.",
    );
  }
  const byId = new Map(inputs.map((input) => [input.caseId, input]));
  const selected = PHASE2RD_CASE_IDS.map((caseId) => byId.get(caseId));
  if (selected.some((input, index) => input?.caseId !== PHASE2RD_CASE_IDS[index])) {
    throw new Phase2rdCaptureError(
      "phase2rd_input_set_invalid",
      "A frozen Phase 2R-D case is unavailable.",
    );
  }
  return selected;
}

function requestDescriptorsFromInputs(inputs) {
  return Object.freeze(
    inputs.map((input, caseIndex) => {
      const descriptor = buildPhase2rdRequestDescriptor(input.modelInput);
      if (
        descriptor.model_input_hash !== input.modelInputHash ||
        descriptor.prompt_version !== PHASE2RD_PROMPT_VERSION ||
        descriptor.request_utf8_bytes > PHASE2RD_MAX_REQUEST_UTF8_BYTES
      ) {
        throw new Phase2rdCaptureError(
          "phase2rd_input_set_invalid",
          "A frozen Phase 2R-D request descriptor drifted.",
        );
      }
      return Object.freeze({
        case_id: input.caseId,
        case_index: caseIndex,
        model_input_hash: descriptor.model_input_hash,
        prompt_hash: descriptor.prompt_hash,
        schema_hash: descriptor.schema_hash,
        request_payload_hash: descriptor.request_payload_hash,
        request_utf8_bytes: descriptor.request_utf8_bytes,
      });
    }),
  );
}

export async function loadPhase2rdRequestDescriptors({
  readFileImpl,
  loadInputsImpl = loadPhase2rDevelopmentInputs,
} = {}) {
  const inputs = selectInputs(
    await loadInputsImpl({
      ...(readFileImpl ? { readFileImpl } : {}),
    }),
  );
  return requestDescriptorsFromInputs(inputs);
}

function rebuildValidation(validation, requireAllTrue) {
  if (
    !exactKeys(validation, VALIDATION_KEYS) ||
    VALIDATION_KEYS.some((key) => typeof validation[key] !== "boolean") ||
    (requireAllTrue && VALIDATION_KEYS.some((key) => validation[key] !== true))
  ) {
    throw new Phase2rdCaptureError(
      "phase2rd_validation_invalid",
      "A Phase 2R-D validation result crossed its frozen contract.",
    );
  }
  return Object.fromEntries(VALIDATION_KEYS.map((key) => [key, validation[key]]));
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

function rebuildCandidateShape(shape) {
  if (!shape || typeof shape !== "object" || Array.isArray(shape)) {
    throw new Phase2rdCaptureError(
      "phase2rd_diagnostic_invalid",
      "A Phase 2R-D diagnostic shape is invalid.",
    );
  }
  if (shape.root_type !== "object") {
    if (!exactKeys(shape, ["root_type"]) || !ROOT_TYPES.has(shape.root_type)) {
      throw new Phase2rdCaptureError(
        "phase2rd_diagnostic_invalid",
        "A Phase 2R-D diagnostic root type is invalid.",
      );
    }
    return { root_type: shape.root_type };
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
        (!safeCount(shape[key]) || shape[key] > 1_000),
    )
  ) {
    throw new Phase2rdCaptureError(
      "phase2rd_diagnostic_invalid",
      "A Phase 2R-D diagnostic count is invalid.",
    );
  }
  return {
    root_type: "object",
    ...Object.fromEntries(countKeys.map((key) => [key, shape[key]])),
  };
}

function rebuildDiagnostic(diagnostic) {
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
    diagnostic.field_paths.some((value) => !safeDiagnosticPath(value)) ||
    (diagnostic.stage === "provider_response" &&
      (diagnostic.field_paths.length !== 0 ||
        diagnostic.candidate_shape !== null)) ||
    (diagnostic.stage === "candidate_validation" &&
      diagnostic.candidate_shape === null)
  ) {
    throw new Phase2rdCaptureError(
      "phase2rd_diagnostic_invalid",
      "A Phase 2R-D diagnostic crossed its whitelist.",
    );
  }
  return {
    diagnostic_version: PHASE2RD_DIAGNOSTIC_VERSION,
    stage: diagnostic.stage,
    reason: diagnostic.reason,
    field_paths: [...diagnostic.field_paths],
    candidate_shape:
      diagnostic.candidate_shape === null
        ? null
        : rebuildCandidateShape(diagnostic.candidate_shape),
  };
}

function harnessFailureDiagnostic() {
  return {
    diagnostic_version: PHASE2RD_DIAGNOSTIC_VERSION,
    stage: "provider_response",
    reason: "harness_failure",
    field_paths: [],
    candidate_shape: null,
  };
}

function rebuildAttempt(attempt, descriptor) {
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
    !safeCount(attempt.duration_ms) ||
    attempt.max_output_tokens !== PHASE2RD_MAX_OUTPUT_TOKENS ||
    attempt.prompt_hash !== descriptor.prompt_hash ||
    attempt.request_payload_hash !== descriptor.request_payload_hash ||
    !(attempt.provider_status === null ||
      PROVIDER_STATUSES.has(attempt.provider_status)) ||
    !(attempt.incomplete_reason === null ||
      ["max_output_tokens", "content_filter", "unknown"].includes(
        attempt.incomplete_reason,
      )) ||
    !Array.isArray(attempt.output_item_types) ||
    attempt.output_item_types.length > 16 ||
    attempt.output_item_types.some(
      (value) =>
        typeof value !== "string" ||
        !SAFE_OUTPUT_ITEM_TYPE_PATTERN.test(value),
    ) ||
    !safeCount(attempt.output_item_count) ||
    attempt.output_item_count < attempt.output_item_types.length ||
    attempt.output_item_count > 1_024 ||
    typeof attempt.partial_output_present !== "boolean" ||
    !safeCount(attempt.partial_output_bytes) ||
    !(attempt.partial_output_hash === null ||
      HASH_PATTERN.test(attempt.partial_output_hash ?? "")) ||
    !(attempt.error_code === null ||
      SAFE_ERROR_CODE_PATTERN.test(attempt.error_code ?? "")) ||
    attempt.partial_output_present !== (attempt.partial_output_bytes > 0) ||
    attempt.partial_output_present !== (attempt.partial_output_hash !== null) ||
    (attempt.provider_status !== "incomplete" &&
      attempt.incomplete_reason !== null) ||
    (attempt.output_tokens !== null &&
      attempt.output_tokens > PHASE2RD_MAX_OUTPUT_TOKENS)
  ) {
    throw new Phase2rdCaptureError(
      "phase2rd_attempt_integrity_failed",
      "A Phase 2R-D attempt crossed its frozen contract.",
    );
  }
  return {
    attempt: 1,
    started_at: attempt.started_at,
    finished_at: attempt.finished_at,
    outcome: attempt.outcome,
    http_status: attempt.http_status,
    input_tokens: attempt.input_tokens,
    output_tokens: attempt.output_tokens,
    reasoning_tokens: attempt.reasoning_tokens,
    output_text_tokens: attempt.output_text_tokens,
    duration_ms: attempt.duration_ms,
    max_output_tokens: PHASE2RD_MAX_OUTPUT_TOKENS,
    prompt_hash: descriptor.prompt_hash,
    request_payload_hash: descriptor.request_payload_hash,
    provider_status: attempt.provider_status,
    incomplete_reason: attempt.incomplete_reason,
    output_item_types: [...attempt.output_item_types],
    output_item_count: attempt.output_item_count,
    partial_output_present: attempt.partial_output_present,
    partial_output_bytes: attempt.partial_output_bytes,
    partial_output_hash: attempt.partial_output_hash,
    error_code: attempt.error_code,
  };
}

function adapterFailure(error) {
  if (!(error instanceof Phase1CoreModelAdapterError)) {
    return {
      code: "internal_error",
      attempts: [],
      candidateHash: null,
      diagnostic: null,
      validation: null,
    };
  }
  return {
    code: safeErrorCode(error.code, "internal_error"),
    attempts: Array.isArray(error.attempts) ? error.attempts : [],
    candidateHash: error.candidateHash ?? null,
    diagnostic: error.diagnostic ?? null,
    validation: error.validation ?? null,
  };
}

function terminalStatus(error) {
  if (error === null) return "candidate_valid";
  return CANDIDATE_FAILURE_CODES.has(error.code)
    ? "candidate_invalid"
    : "request_failed";
}

function detachedCandidate(candidate) {
  return JSON.parse(canonicalJsonStringify(candidate));
}

function outputProgress(onProgress, value) {
  if (typeof onProgress === "function") onProgress(Object.freeze(value));
}

export function createPhase2rdFailedBatchTerminal({
  runId,
  implementationCommitSha,
  errorCode,
  causeCode = null,
  requestIntentCaseIds = [],
  providerAttemptedCaseIds = [],
  providerRequestCount = 0,
  caseTerminalIds = [],
  clock = () => new Date(),
}) {
  const intents = frozenCaseIds(requestIntentCaseIds);
  const attempted = frozenCaseIds(providerAttemptedCaseIds);
  const terminals = frozenCaseIds(caseTerminalIds);
  const attemptedSet = new Set(attempted);
  const unattempted = PHASE2RD_CASE_IDS.filter(
    (caseId) => !attemptedSet.has(caseId),
  );
  return {
    capture_file_version: PHASE2RD_CAPTURE_FILE_VERSION,
    kind: "batch_terminal",
    run_id: runId,
    status: "failed",
    finished_at: isoNow(clock),
    implementation_commit_sha: implementationCommitSha,
    planned_case_count: PHASE2RD_MAX_REQUESTS,
    request_intent_count: intents.length,
    provider_request_count: safeCount(providerRequestCount)
      ? providerRequestCount
      : 0,
    case_terminal_count: terminals.length,
    attempted_case_count: attempted.length,
    unattempted_case_count: unattempted.length,
    request_intent_case_ids: intents,
    attempted_case_ids: attempted,
    unattempted_case_ids: unattempted,
    case_terminal_ids: terminals,
    error: {
      code: safeErrorCode(errorCode),
      cause_code:
        causeCode === null ? null : safeErrorCode(causeCode, "internal_error"),
    },
  };
}

/**
 * Capture six fixed synthetic cases serially. This module intentionally has
 * no expected fixture, Oracle, evaluator, product service, or listener import.
 */
export async function capturePhase2rdCandidates({
  runId,
  implementationCommitSha,
  modelClient,
  runtimeDirectory,
  readFileImpl,
  readMarkerImpl = readPhase2rdAuthorizationMarker,
  loadInputsImpl = loadPhase2rDevelopmentInputs,
  analyzeImpl = analyzePhase2rdCoreCandidate,
  writeIntentImpl = writePhase2rdRequestIntent,
  writeTerminalImpl = writePhase2rdCaseTerminal,
  writeIndexImpl = writePhase2rdCaptureIndex,
  writeBatchTerminalImpl = writePhase2rdBatchTerminal,
  beforeCasePreflight,
  budget = new Phase2rdRequestBudget(),
  clock = () => new Date(),
  onProgress,
} = {}) {
  const requestIntentCaseIds = [];
  const providerAttemptedCaseIds = [];
  const caseTerminalIds = [];
  const terminalRefs = [];
  let providerRequestCount = 0;
  let startedAt;

  try {
    if (!GIT_COMMIT_PATTERN.test(implementationCommitSha ?? "")) {
      throw new Phase2rdCaptureError(
        "implementation_not_frozen",
        "Phase 2R-D requires a frozen clean implementation commit.",
      );
    }
    const marker = await readMarkerImpl({ runtimeDirectory });
    assertClient(modelClient);
    if (typeof beforeCasePreflight !== "function") {
      throw new Phase2rdCaptureError(
        "implementation_not_frozen",
        "Phase 2R-D requires a per-case clean Git preflight.",
      );
    }
    startedAt = isoNow(clock);
    const inputs = selectInputs(
      await loadInputsImpl({
        ...(readFileImpl ? { readFileImpl } : {}),
      }),
    );
    const requestDescriptors = requestDescriptorsFromInputs(inputs);
    assertAuthorizationMarker(marker, {
      runId,
      implementationCommitSha,
      requestDescriptors,
    });
    const payloadGuard = new CoreContentPayloadGuard();

    for (let caseIndex = 0; caseIndex < inputs.length; caseIndex += 1) {
      const input = inputs[caseIndex];
      const ordinal = budget.reserve(input.caseId);
      if (ordinal !== caseIndex + 1) {
        throw new Phase2rdCaptureError(
          "phase2rd_case_order_invalid",
          "Phase 2R-D request reservation order drifted.",
        );
      }
      const descriptor = buildPhase2rdRequestDescriptor(input.modelInput);
      if (
        descriptor.model_input_hash !== input.modelInputHash ||
        descriptor.prompt_version !== PHASE2RD_PROMPT_VERSION ||
        descriptor.request_utf8_bytes > PHASE2RD_MAX_REQUEST_UTF8_BYTES ||
        canonicalJsonStringify({
          case_id: input.caseId,
          case_index: caseIndex,
          model_input_hash: descriptor.model_input_hash,
          prompt_hash: descriptor.prompt_hash,
          schema_hash: descriptor.schema_hash,
          request_payload_hash: descriptor.request_payload_hash,
          request_utf8_bytes: descriptor.request_utf8_bytes,
        }) !== canonicalJsonStringify(requestDescriptors[caseIndex])
      ) {
        throw new Phase2rdCaptureError(
          "phase2rd_input_set_invalid",
          "A frozen Phase 2R-D request descriptor drifted.",
        );
      }
      let casePreflight;
      try {
        casePreflight = await beforeCasePreflight({
          caseId: input.caseId,
          caseIndex,
          implementationCommitSha,
        });
      } catch {
        throw new Phase2rdCaptureError(
          "implementation_not_frozen",
          "The Phase 2R-D implementation drifted before a request intent.",
        );
      }
      if (
        casePreflight?.gitClean !== true ||
        casePreflight?.commitSha !== implementationCommitSha
      ) {
        throw new Phase2rdCaptureError(
          "implementation_not_frozen",
          "The Phase 2R-D implementation drifted before a request intent.",
        );
      }
      const intent = {
        capture_file_version: PHASE2RD_CAPTURE_FILE_VERSION,
        kind: "request_intent",
        run_id: runId,
        case_id: input.caseId,
        case_index: caseIndex,
        created_at: isoNow(clock),
        implementation_commit_sha: implementationCommitSha,
        provider: PHASE2RD_PROVIDER,
        model: PHASE2RD_MODEL,
        prompt_version: PHASE2RD_PROMPT_VERSION,
        model_input_hash: descriptor.model_input_hash,
        prompt_hash: descriptor.prompt_hash,
        schema_hash: descriptor.schema_hash,
        request_payload_hash: descriptor.request_payload_hash,
        request_utf8_bytes: descriptor.request_utf8_bytes,
        max_output_tokens: PHASE2RD_MAX_OUTPUT_TOKENS,
        timeout_ms: PHASE2RD_TIMEOUT_MS,
      };
      const intentWrite = await writeIntentImpl(intent, { runtimeDirectory });
      requestIntentCaseIds.push(input.caseId);

      let analysis = null;
      let controlledError = null;
      try {
        analysis = await analyzeImpl({
          executionMode: "deepseek",
          modelClient,
          caseId: input.caseId,
          ...(readFileImpl ? { readFileImpl } : {}),
          payloadGuard,
          clock,
        });
      } catch (error) {
        controlledError = adapterFailure(error);
      }

      const rawAttempts = analysis?.attempts ?? controlledError.attempts;
      if (!Array.isArray(rawAttempts)) {
        throw new Phase2rdCaptureError(
          "phase2rd_attempt_integrity_failed",
          "A Phase 2R-D attempt list is invalid.",
        );
      }
      providerRequestCount += rawAttempts.length;
      if (rawAttempts.length > 0) providerAttemptedCaseIds.push(input.caseId);
      if (rawAttempts.length > 1) {
        throw new Phase2rdCaptureError(
          "phase2rd_request_budget_exhausted",
          "A Phase 2R-D case attempted more than one provider request.",
        );
      }
      const attempt =
        rawAttempts.length === 0
          ? null
          : rebuildAttempt(rawAttempts[0], descriptor);

      let candidate = null;
      let candidateHash = controlledError?.candidateHash ?? null;
      let validation = rebuildValidation(
        analysis?.validation ?? controlledError?.validation ?? {
          schema_valid: false,
          references_closed: false,
          quote_unique: false,
          profile_refs_allowed: false,
          forbidden_fields_absent: false,
          candidate_unchanged: false,
        },
        analysis !== null,
      );
      let diagnostic = null;
      if (analysis !== null) {
        candidate = detachedCandidate(analysis.candidate);
        candidateHash = hashCanonicalJson(candidate);
        if (candidateHash !== analysis.candidateHash) {
          throw new Phase2rdCaptureError(
            "phase2rd_candidate_integrity_failed",
            "A Phase 2R-D Candidate changed before terminal capture.",
          );
        }
      } else {
        if (
          !(candidateHash === null || HASH_PATTERN.test(candidateHash ?? ""))
        ) {
          throw new Phase2rdCaptureError(
            "phase2rd_candidate_integrity_failed",
            "A Phase 2R-D Candidate hash is invalid.",
          );
        }
        diagnostic =
          controlledError.diagnostic === null
            ? harnessFailureDiagnostic()
            : rebuildDiagnostic(controlledError.diagnostic);
      }

      const error = controlledError
        ? { code: safeErrorCode(controlledError.code, "internal_error") }
        : null;
      const terminal = {
        capture_file_version: PHASE2RD_CAPTURE_FILE_VERSION,
        kind: "case_terminal",
        run_id: runId,
        case_id: input.caseId,
        case_index: caseIndex,
        status: terminalStatus(error),
        captured_at: isoNow(clock),
        intent_hash: intentWrite.hash,
        model_input_hash: descriptor.model_input_hash,
        request_payload_hash: descriptor.request_payload_hash,
        attempt,
        candidate_hash: candidateHash,
        candidate,
        validation,
        diagnostic,
        error,
      };
      const terminalWrite = await writeTerminalImpl(terminal, {
        runtimeDirectory,
      });
      caseTerminalIds.push(input.caseId);
      terminalRefs.push({
        case_id: input.caseId,
        case_index: caseIndex,
        terminal_hash: terminalWrite.hash,
      });
      outputProgress(onProgress, {
        completed: caseIndex + 1,
        planned: inputs.length,
        case_id: input.caseId,
        status: terminal.status,
      });

      if (error && SYSTEMIC_STOP_CODES.has(error.code)) {
        throw new Phase2rdCaptureError(
          "phase2rd_systemic_request_failure",
          "Phase 2R-D stopped after a systemic request failure.",
          { triggerCode: error.code },
        );
      }
    }

    if (!budget.complete || terminalRefs.length !== PHASE2RD_MAX_REQUESTS) {
      throw new Phase2rdCaptureError(
        "phase2rd_capture_incomplete",
        "Phase 2R-D did not persist all six case terminals.",
      );
    }
    const captureIndex = {
      capture_file_version: PHASE2RD_CAPTURE_FILE_VERSION,
      kind: "capture_index",
      run_id: runId,
      status: "captured",
      started_at: startedAt,
      finished_at: isoNow(clock),
      implementation_commit_sha: implementationCommitSha,
      provider: PHASE2RD_PROVIDER,
      model: PHASE2RD_MODEL,
      prompt_version: PHASE2RD_PROMPT_VERSION,
      planned_case_count: PHASE2RD_MAX_REQUESTS,
      request_intent_count: requestIntentCaseIds.length,
      provider_request_count: providerRequestCount,
      terminal_count: terminalRefs.length,
      terminals: terminalRefs,
    };
    const indexWrite = await writeIndexImpl(captureIndex, { runtimeDirectory });
    return Object.freeze({
      runId,
      captureIndex: indexWrite.snapshot,
      captureIndexPath: indexWrite.path,
      captureIndexHash: indexWrite.hash,
    });
  } catch (error) {
    const controlled =
      error instanceof Phase2rdCaptureError
        ? error
        : new Phase2rdCaptureError(
            safeErrorCode(error?.code),
            "The Phase 2R-D capture stopped safely.",
            { cause: error },
          );
    const failedTerminal = createPhase2rdFailedBatchTerminal({
      runId,
      implementationCommitSha,
      errorCode: controlled.code,
      causeCode: controlled.triggerCode,
      requestIntentCaseIds,
      providerAttemptedCaseIds,
      providerRequestCount,
      caseTerminalIds,
      clock,
    });
    try {
      const written = await writeBatchTerminalImpl(failedTerminal, {
        runtimeDirectory,
      });
      controlled.batchTerminalWritten = true;
      controlled.batchTerminalPath = written.path;
    } catch (writeError) {
      throw new Phase2rdCaptureError(
        "phase2rd_batch_terminal_write_failed",
        "The failed Phase 2R-D batch could not persist its terminal record.",
        {
          cause: writeError,
          triggerCode: controlled.code,
          batchTerminalSnapshot: failedTerminal,
        },
      );
    }
    throw controlled;
  }
}
