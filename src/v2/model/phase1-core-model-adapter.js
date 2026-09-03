import { randomUUID } from "node:crypto";

import {
  buildStructuredRequestBody,
  ModelRequestError,
  TRUNCATION_RETRY_MAX_OUTPUT_TOKENS,
} from "../../agent/deepseek-responses-client.js";
import {
  CORE_CANDIDATE_SCHEMA_NAME,
  NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
} from "../contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import {
  CORE_PROMPT_VERSION,
} from "../prompts/notification-analysis-core-p1-v2.js";
import { resolveCorePromptContract } from "../prompts/core-prompt-registry.js";
import {
  canonicalJsonStringify,
  hashCanonicalJson,
  hashUtf8,
} from "../validation/canonical-json.js";
import {
  createCandidateFailureDiagnostic,
  createProviderFailureDiagnostic,
} from "../validation/core-candidate-failure-diagnostic.js";
import {
  deriveCoreValidationEvidence,
  CORE_MAX_MODEL_INPUT_UTF8_BYTES,
  validateCoreModelInput,
  validateCoreCandidate,
} from "../validation/core-candidate-validator.js";

export const PHASE1_CORE_MAX_PROVIDER_ATTEMPTS = 1;
export const PHASE1_CORE_MAX_OUTPUT_TOKENS = TRUNCATION_RETRY_MAX_OUTPUT_TOKENS;
export const PHASE1_CORE_MAX_PROMPT_UTF8_BYTES = 2_000;
export const PHASE1_CORE_MAX_SCHEMA_UTF8_BYTES = 6_000;
export const PHASE1_CORE_MAX_REQUEST_UTF8_BYTES = 10_000;

const CONTENT_FAILURE_OUTCOMES = new Set([
  "truncated",
  "invalid_json",
  "candidate_invalid",
]);
const CANDIDATE_VALIDATION_ERROR_CODES = new Set([
  "candidate_schema_invalid",
  "candidate_reference_invalid",
  "candidate_evidence_invalid",
  "candidate_language_invalid",
  "candidate_forbidden_field",
]);

const SAFE_ERROR_MESSAGES = Object.freeze({
  fixture_invalid: "The approved development fixture is invalid.",
  model_not_configured: "DeepSeek is not configured.",
  model_auth_failed: "DeepSeek authentication failed.",
  model_timeout: "The model request timed out.",
  model_rate_limited: "The model request was rate limited.",
  model_transport_failed: "The model transport failed.",
  model_refused: "The model refused the structured request.",
  model_response_invalid: "The model response was not valid JSON output.",
  candidate_schema_invalid: "The candidate did not match the Core v2 schema.",
  candidate_reference_invalid: "The candidate contained an invalid reference.",
  candidate_evidence_invalid: "The candidate evidence did not uniquely match the body.",
  candidate_language_invalid: "The candidate Chinese fields did not meet the minimum language contract.",
  candidate_forbidden_field: "The candidate crossed a Harness ownership boundary.",
  duplicate_payload_blocked: "A repeated content-failure payload was blocked before transport.",
  internal_error: "The Core v2 analysis failed internally.",
});

function safeCode(value) {
  if (value === "candidate_locator_invalid") return "candidate_evidence_invalid";
  if (value === "candidate_context_invalid") return "fixture_invalid";
  if (
    value === "candidate_secret_detected" ||
    value === "candidate_external_action_claim" ||
    value === "candidate_forbidden_action"
  ) {
    return "candidate_forbidden_field";
  }
  return Object.hasOwn(SAFE_ERROR_MESSAGES, value) ? value : "internal_error";
}

function isoNow(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("clock must return a valid date");
  return date.toISOString();
}

function elapsedMs(startedAt, finishedAt) {
  return Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
}

function validationFlags(overrides = {}) {
  return {
    schema_valid: false,
    references_closed: false,
    quote_unique: false,
    profile_refs_allowed: false,
    forbidden_fields_absent: false,
    candidate_unchanged: false,
    ...overrides,
  };
}

function validationForFailure(code) {
  if (code === "candidate_reference_invalid") {
    return validationFlags({ schema_valid: true, forbidden_fields_absent: true });
  }
  if (code === "candidate_evidence_invalid") {
    return validationFlags({
      schema_valid: true,
      forbidden_fields_absent: true,
    });
  }
  if (code === "candidate_language_invalid") {
    return validationFlags({ schema_valid: true, forbidden_fields_absent: true });
  }
  return validationFlags();
}

function safeOutputItemTypes(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(item))
    .slice(0, 16);
}

const PROVIDER_STATUSES = new Set([
  "cancelled",
  "completed",
  "failed",
  "in_progress",
  "incomplete",
  "queued",
  "refused",
]);
const INCOMPLETE_REASONS = new Set([
  "max_output_tokens",
  "content_filter",
  "unknown",
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
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function safeProviderStatus(value) {
  return PROVIDER_STATUSES.has(value) ? value : null;
}

function safeIncompleteReason(value, providerStatus) {
  if (providerStatus !== "incomplete") return null;
  return INCOMPLETE_REASONS.has(value) ? value : "unknown";
}

function safeTimestamp(value, fallback) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return fallback;
  return new Date(value).toISOString();
}

function boundedAttemptTimes(metadata, localStartedAt, localFinishedAt) {
  const localStart = safeTimestamp(localStartedAt, localStartedAt);
  const parsedLocalFinish = safeTimestamp(localFinishedAt, localStart);
  const localFinish =
    Date.parse(parsedLocalFinish) >= Date.parse(localStart)
      ? parsedLocalFinish
      : localStart;
  const metadataStart = safeTimestamp(metadata?.startedAt, null);
  const metadataFinish = safeTimestamp(metadata?.finishedAt, null);
  if (
    metadataStart !== null &&
    metadataFinish !== null &&
    Date.parse(metadataStart) >= Date.parse(localStart) &&
    Date.parse(metadataFinish) >= Date.parse(metadataStart) &&
    Date.parse(metadataFinish) <= Date.parse(localFinish)
  ) {
    return { startedAt: metadataStart, finishedAt: metadataFinish };
  }
  return { startedAt: localStart, finishedAt: localFinish };
}

function safeHttpStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeDuration(value, fallback) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function coherentAttemptOutcome(value, providerStatus, incompleteReason) {
  const outcome = ATTEMPT_OUTCOMES.has(value) ? value : "permanent_error";
  if (outcome === "harness_error") {
    return providerStatus === null ? "permanent_error" : "harness_error";
  }
  if (["in_progress", "queued"].includes(providerStatus)) return "harness_error";
  if (providerStatus === "completed") {
    return ["completed", "candidate_invalid", "invalid_json", "harness_error"].includes(
      outcome,
    )
      ? outcome
      : "harness_error";
  }
  if (providerStatus === "refused") return "refused";
  if (providerStatus === "incomplete") {
    return incompleteReason === "max_output_tokens"
      ? "truncated"
      : "permanent_error";
  }
  if (["failed", "cancelled"].includes(providerStatus)) {
    return "permanent_error";
  }
  if (outcome === "truncated") {
    return "permanent_error";
  }
  if (["candidate_invalid", "invalid_json", "harness_error"].includes(outcome)) {
    return providerStatus === null ? outcome : "harness_error";
  }
  if (outcome === "completed") return "harness_error";
  return outcome;
}

function normalizedFailureDiagnostic({
  metadata,
  requestedOutcome,
  requestedCode,
  executionMode,
}) {
  const providerStatus = safeProviderStatus(metadata?.providerStatus);
  const incompleteReason = safeIncompleteReason(
    metadata?.incompleteReason,
    providerStatus,
  );
  const outcome = coherentAttemptOutcome(
    requestedOutcome,
    providerStatus,
    incompleteReason,
  );

  if (
    executionMode === "deepseek" &&
    providerStatus === null &&
    ["invalid_json", "candidate_invalid"].includes(outcome)
  ) {
    return { outcome: "permanent_error", code: "model_response_invalid" };
  }

  if (outcome === "completed") {
    return {
      outcome: providerStatus === null ? "permanent_error" : "harness_error",
      code: "internal_error",
    };
  }
  if (outcome === "harness_error") {
    return { outcome, code: "internal_error" };
  }
  if (outcome === "refused") {
    return providerStatus === "refused"
      ? { outcome, code: "model_refused" }
      : {
          outcome: "permanent_error",
          code:
            executionMode === "deepseek"
              ? "model_response_invalid"
              : "internal_error",
        };
  }
  if (["truncated", "invalid_json"].includes(outcome)) {
    return { outcome, code: "model_response_invalid" };
  }
  if (outcome === "timeout") return { outcome, code: "model_timeout" };
  if (outcome === "rate_limited") {
    return { outcome, code: "model_rate_limited" };
  }
  if (outcome === "transient_error") {
    return { outcome, code: "model_transport_failed" };
  }
  if (outcome === "candidate_invalid") {
    const allowed = new Set([
      "candidate_schema_invalid",
      "candidate_reference_invalid",
      "candidate_evidence_invalid",
      "candidate_language_invalid",
      "candidate_forbidden_field",
      "internal_error",
    ]);
    return {
      outcome,
      code: allowed.has(requestedCode) ? requestedCode : "internal_error",
    };
  }
  if (providerStatus === "incomplete") {
    return { outcome: "permanent_error", code: "model_response_invalid" };
  }
  const permanentCodes = new Set([
    "model_auth_failed",
    "model_transport_failed",
    "model_response_invalid",
    "internal_error",
  ]);
  return {
    outcome: "permanent_error",
    code: permanentCodes.has(requestedCode)
      ? requestedCode
      : executionMode === "deepseek"
        ? "model_response_invalid"
        : "internal_error",
  };
}

function completedMetadataFailure(metadata, executionMode) {
  const providerStatus = safeProviderStatus(metadata?.providerStatus);
  const incompleteReason = safeIncompleteReason(
    metadata?.incompleteReason,
    providerStatus,
  );
  if (["completed", "in_progress", "queued"].includes(providerStatus)) {
    return { code: "internal_error", outcome: "harness_error" };
  }
  if (providerStatus === "refused") {
    return { code: "model_refused", outcome: "refused" };
  }
  if (
    providerStatus === "incomplete" &&
    incompleteReason === "max_output_tokens"
  ) {
    return { code: "model_response_invalid", outcome: "truncated" };
  }
  return {
    code: executionMode === "deepseek" ? "model_response_invalid" : "internal_error",
    outcome: "permanent_error",
  };
}

function metadataRequestBodyMatches(metadata, requestPayloadHash, executionMode) {
  const hasRequestBody = Object.hasOwn(metadata ?? {}, "requestBody");
  if (!hasRequestBody) return executionMode === "mock";
  try {
    return hashCanonicalJson(metadata.requestBody) === requestPayloadHash;
  } catch {
    return false;
  }
}

function validOptionalCount(value) {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}

function completedAttemptMetadataIsValid(
  metadata,
  executionMode,
  requestPayloadHash,
) {
  const outputTypes = metadata?.outputItemTypes;
  const outputCount = metadata?.outputItemCount;
  return (
    metadata?.providerStatus === "completed" &&
    metadata?.incompleteReason === null &&
    metadata?.partialVisibleOutputPresent === false &&
    metadata?.partialVisibleOutputUtf8Bytes === 0 &&
    metadata?.partialVisibleOutputSha256 === null &&
    metadata?.maxOutputTokens === PHASE1_CORE_MAX_OUTPUT_TOKENS &&
    Array.isArray(outputTypes) &&
    outputTypes.length >= 1 &&
    outputTypes.length <= 16 &&
    outputTypes.every(
      (item) => typeof item === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(item),
    ) &&
    Number.isInteger(outputCount) &&
    outputCount >= outputTypes.length &&
    outputCount <= 1024 &&
    validOptionalCount(metadata?.inputTokens ?? null) &&
    validOptionalCount(metadata?.outputTokens ?? null) &&
    validOptionalCount(metadata?.reasoningTokens ?? null) &&
    validOptionalCount(metadata?.outputTextTokens ?? null) &&
    Number.isInteger(metadata?.durationMs) &&
    metadata.durationMs >= 0 &&
    metadataRequestBodyMatches(metadata, requestPayloadHash, executionMode) &&
    (executionMode === "mock"
      ? metadata.httpStatus === null
      : Number.isInteger(metadata.httpStatus) &&
        metadata.httpStatus >= 200 &&
        metadata.httpStatus <= 299)
  );
}

function attemptRecord({
  metadata,
  localStartedAt,
  localFinishedAt,
  outcome,
  promptHash,
  requestPayloadHash,
  errorCode = null,
}) {
  const { startedAt, finishedAt } = boundedAttemptTimes(
    metadata,
    localStartedAt,
    localFinishedAt,
  );
  const outputItemTypes = safeOutputItemTypes(metadata?.outputItemTypes);
  const providerStatus = safeProviderStatus(metadata?.providerStatus);
  const incompleteReason = safeIncompleteReason(
    metadata?.incompleteReason,
    providerStatus,
  );
  const normalizedOutcome = coherentAttemptOutcome(
    outcome,
    providerStatus,
    incompleteReason,
  );
  const requestedPartialBytes = safeCount(
    metadata?.partialVisibleOutputUtf8Bytes,
  );
  const requestedPartialHash = metadata?.partialVisibleOutputSha256;
  const partialPresent =
    metadata?.partialVisibleOutputPresent === true &&
    requestedPartialBytes !== null &&
    requestedPartialBytes > 0 &&
    SHA256_PATTERN.test(requestedPartialHash ?? "");
  const partialBytes = partialPresent ? requestedPartialBytes : 0;
  const partialHash = partialPresent ? requestedPartialHash : null;
  const requestedOutputCount = safeCount(metadata?.outputItemCount);
  const outputItemCount =
    requestedOutputCount !== null &&
    requestedOutputCount >= outputItemTypes.length &&
    requestedOutputCount <= 1024
      ? requestedOutputCount
      : outputItemTypes.length;
  const fallbackDuration = elapsedMs(startedAt, finishedAt);

  return {
    attempt: 1,
    started_at: startedAt,
    finished_at: finishedAt,
    outcome: normalizedOutcome,
    http_status: safeHttpStatus(metadata?.httpStatus),
    input_tokens: safeCount(metadata?.inputTokens),
    output_tokens: safeCount(metadata?.outputTokens),
    reasoning_tokens: safeCount(metadata?.reasoningTokens),
    output_text_tokens: safeCount(metadata?.outputTextTokens),
    duration_ms: safeDuration(metadata?.durationMs, fallbackDuration),
    max_output_tokens: PHASE1_CORE_MAX_OUTPUT_TOKENS,
    prompt_hash: promptHash,
    request_payload_hash: requestPayloadHash,
    provider_status: providerStatus,
    incomplete_reason: incompleteReason,
    output_item_types: outputItemTypes,
    output_item_count: outputItemCount,
    partial_output_present: partialPresent,
    partial_output_bytes: partialBytes,
    partial_output_hash: partialHash,
    error_code: errorCode,
  };
}

export class CoreContentPayloadGuard {
  #blockedHashes = new Set();

  constructor(blockedHashes = []) {
    for (const hash of blockedHashes) {
      if (typeof hash !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(hash)) {
        throw new TypeError("blocked content payload hashes must be SHA-256 values");
      }
      this.#blockedHashes.add(hash);
    }
  }

  assertAllowed(requestPayloadHash) {
    if (this.#blockedHashes.has(requestPayloadHash)) {
      throw new Phase1CoreModelAdapterError("duplicate_payload_blocked", {
        blockedPayloadHash: requestPayloadHash,
      });
    }
  }

  markContentFailure(requestPayloadHash) {
    this.#blockedHashes.add(requestPayloadHash);
  }
}

export class Phase1CoreModelAdapterError extends Error {
  constructor(
    code,
    {
      attempts = [],
      validation = validationFlags(),
      candidateHash = null,
      blockedPayloadHash = null,
      diagnostic = null,
    } = {},
  ) {
    const normalized = safeCode(code);
    super(SAFE_ERROR_MESSAGES[normalized]);
    this.name = "Phase1CoreModelAdapterError";
    this.code = normalized;
    this.attempts = attempts;
    this.validation = validation;
    this.candidateHash = candidateHash;
    this.blockedPayloadHash = blockedPayloadHash;
    this.diagnostic = diagnostic;
    this.attemptBudgetExhausted = attempts.length === PHASE1_CORE_MAX_PROVIDER_ATTEMPTS;
  }
}

function assertFixedCoreRequestContract({
  modelInput,
  schema,
  schemaName,
  instructions,
  promptContract,
  validateModelInput,
}) {
  try {
    validateModelInput(modelInput);
  } catch {
    throw new Phase1CoreModelAdapterError("fixture_invalid");
  }

  let schemaMatches = false;
  try {
    schemaMatches =
      hashCanonicalJson(schema) ===
      hashCanonicalJson(NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA);
  } catch {
    schemaMatches = false;
  }
  if (
    schemaName !== CORE_CANDIDATE_SCHEMA_NAME ||
    instructions !== promptContract.instructions ||
    !schemaMatches ||
    Buffer.byteLength(instructions, "utf8") >
      promptContract.max_utf8_bytes ||
    Buffer.byteLength(canonicalJsonStringify(schema), "utf8") >
      PHASE1_CORE_MAX_SCHEMA_UTF8_BYTES
  ) {
    throw new Phase1CoreModelAdapterError("internal_error");
  }
}

export async function analyzePhase1CoreCandidate({
  executionMode,
  modelClient,
  modelInput,
  schema = NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
  schemaName = CORE_CANDIDATE_SCHEMA_NAME,
  promptVersion = CORE_PROMPT_VERSION,
  instructions,
  validateModelInput = validateCoreModelInput,
  validateCandidate = validateCoreCandidate,
  deriveValidationEvidence = deriveCoreValidationEvidence,
  maxModelInputUtf8Bytes = CORE_MAX_MODEL_INPUT_UTF8_BYTES,
  maxRequestUtf8Bytes = PHASE1_CORE_MAX_REQUEST_UTF8_BYTES,
  payloadGuard = new CoreContentPayloadGuard(),
  clock = () => new Date(),
}) {
  if (executionMode !== "mock" && executionMode !== "deepseek") {
    throw new TypeError("executionMode must be fixed to mock or deepseek");
  }
  if (modelClient?.provider !== executionMode) {
    throw new Phase1CoreModelAdapterError("internal_error");
  }
  if (!modelClient?.configured) {
    throw new Phase1CoreModelAdapterError("model_not_configured");
  }
  if (typeof modelClient.createStructuredAttempt !== "function") {
    throw new Phase1CoreModelAdapterError("internal_error");
  }
  if (
    typeof validateModelInput !== "function" ||
    typeof validateCandidate !== "function" ||
    typeof deriveValidationEvidence !== "function" ||
    !Number.isSafeInteger(maxModelInputUtf8Bytes) ||
    maxModelInputUtf8Bytes < 1 ||
    !Number.isSafeInteger(maxRequestUtf8Bytes) ||
    maxRequestUtf8Bytes < 1
  ) {
    throw new Phase1CoreModelAdapterError("internal_error");
  }

  let promptContract;
  try {
    promptContract = resolveCorePromptContract(promptVersion);
  } catch {
    throw new Phase1CoreModelAdapterError("internal_error");
  }
  const effectiveInstructions = instructions ?? promptContract.instructions;

  assertFixedCoreRequestContract({
    modelInput,
    schema,
    schemaName,
    instructions: effectiveInstructions,
    promptContract,
    validateModelInput,
  });

  const promptHash = hashUtf8(effectiveInstructions);
  const serializedInput = canonicalJsonStringify(modelInput);
  if (
    Buffer.byteLength(serializedInput, "utf8") >
    maxModelInputUtf8Bytes
  ) {
    throw new Phase1CoreModelAdapterError("fixture_invalid");
  }
  const requestBody = buildStructuredRequestBody({
    model: modelClient.model,
    instructions: effectiveInstructions,
    input: serializedInput,
    schema,
    schemaName,
    maxOutputTokens: PHASE1_CORE_MAX_OUTPUT_TOKENS,
  });
  if (
    Buffer.byteLength(JSON.stringify(requestBody), "utf8") >
    maxRequestUtf8Bytes
  ) {
    throw new Phase1CoreModelAdapterError("fixture_invalid");
  }
  const requestPayloadHash = hashCanonicalJson(requestBody);
  payloadGuard.assertAllowed(requestPayloadHash);
  const localStartedAt = isoNow(clock);

  try {
    const response = await modelClient.createStructuredAttempt({
      instructions: effectiveInstructions,
      input: serializedInput,
      schema,
      schemaName,
      maxOutputTokens: PHASE1_CORE_MAX_OUTPUT_TOKENS,
      attemptNumber: 1,
    });
    const completedMetadataIsValid = completedAttemptMetadataIsValid(
      response?.metadata,
      executionMode,
      requestPayloadHash,
    );
    if (!completedMetadataIsValid) {
      const failure = completedMetadataFailure(response?.metadata, executionMode);
      if (CONTENT_FAILURE_OUTCOMES.has(failure.outcome)) {
        payloadGuard.markContentFailure(requestPayloadHash);
      }
      const attempts = [
        attemptRecord({
          metadata: response?.metadata,
          localStartedAt,
          localFinishedAt: isoNow(clock),
          outcome: failure.outcome,
          promptHash,
          requestPayloadHash,
          errorCode: failure.code,
        }),
      ];
      throw new Phase1CoreModelAdapterError(failure.code, {
        attempts,
        diagnostic: createProviderFailureDiagnostic({
          outcome: failure.outcome,
          code: failure.code,
          providerStatus: response?.metadata?.providerStatus,
          incompleteReason: response?.metadata?.incompleteReason,
        }),
      });
    }
    const candidate = response?.value;
    let candidateHashBefore = null;
    try {
      candidateHashBefore = hashCanonicalJson(candidate);
    } catch {
      payloadGuard.markContentFailure(requestPayloadHash);
      const attempts = [
        attemptRecord({
          metadata: response?.metadata,
          localStartedAt,
          localFinishedAt: isoNow(clock),
          outcome: "candidate_invalid",
          promptHash,
          requestPayloadHash,
          errorCode: "candidate_schema_invalid",
        }),
      ];
      throw new Phase1CoreModelAdapterError("candidate_schema_invalid", {
        attempts,
        candidateHash: null,
        diagnostic: createCandidateFailureDiagnostic({
          candidate,
          code: "candidate_schema_invalid",
          reason: "candidate_unserializable",
        }),
      });
    }
    let accepted;
    try {
      accepted = validateCandidate(candidate, modelInput);
    } catch (error) {
      const mappedCode = safeCode(error?.code);
      const isCandidateFailure = CANDIDATE_VALIDATION_ERROR_CODES.has(mappedCode);
      const code = isCandidateFailure ? mappedCode : "internal_error";
      const outcome = isCandidateFailure ? "candidate_invalid" : "harness_error";
      if (isCandidateFailure) {
        payloadGuard.markContentFailure(requestPayloadHash);
      }
      const attempts = [
        attemptRecord({
          metadata: response?.metadata,
          localStartedAt,
          localFinishedAt: isoNow(clock),
          outcome,
          promptHash,
          requestPayloadHash,
          errorCode: code,
        }),
      ];
      throw new Phase1CoreModelAdapterError(code, {
        attempts,
        validation: validationForFailure(code),
        candidateHash: candidateHashBefore,
        diagnostic: createCandidateFailureDiagnostic({
          candidate,
          code,
          jsonPaths: error?.jsonPaths,
        }),
      });
    }

    let candidateHashAfter;
    try {
      candidateHashAfter = hashCanonicalJson(candidate);
    } catch {
      payloadGuard.markContentFailure(requestPayloadHash);
      const attempts = [
        attemptRecord({
          metadata: response?.metadata,
          localStartedAt,
          localFinishedAt: isoNow(clock),
          outcome: "candidate_invalid",
          promptHash,
          requestPayloadHash,
          errorCode: "internal_error",
        }),
      ];
      throw new Phase1CoreModelAdapterError("internal_error", {
        attempts,
        candidateHash: candidateHashBefore,
      });
    }
    if (accepted !== candidate || candidateHashBefore !== candidateHashAfter) {
      payloadGuard.markContentFailure(requestPayloadHash);
      const attempts = [
        attemptRecord({
          metadata: response?.metadata,
          localStartedAt,
          localFinishedAt: isoNow(clock),
          outcome: "candidate_invalid",
          promptHash,
          requestPayloadHash,
          errorCode: "internal_error",
        }),
      ];
      throw new Phase1CoreModelAdapterError("internal_error", {
        attempts,
        candidateHash: candidateHashBefore,
      });
    }

    const attempts = [
      attemptRecord({
        metadata: response?.metadata,
        localStartedAt,
        localFinishedAt: isoNow(clock),
        outcome: "completed",
        promptHash,
        requestPayloadHash,
      }),
    ];
    let validationEvidence;
    try {
      validationEvidence = deriveValidationEvidence(candidate, modelInput);
    } catch {
      const failedAttempt = {
        ...attempts[0],
        outcome: "harness_error",
        error_code: "internal_error",
      };
      throw new Phase1CoreModelAdapterError("internal_error", {
        attempts: [failedAttempt],
        candidateHash: candidateHashBefore,
      });
    }
    return Object.freeze({
      candidate,
      candidateHash: candidateHashBefore,
      attempts,
      validation: validationFlags({
        schema_valid: true,
        references_closed: true,
        quote_unique: true,
        profile_refs_allowed: true,
        forbidden_fields_absent: true,
        candidate_unchanged: true,
      }),
      validationEvidence,
      promptHash,
      promptVersion: promptContract.version,
      attemptBudgetExhausted: false,
    });
  } catch (error) {
    if (error instanceof Phase1CoreModelAdapterError) throw error;
    const normalized =
      error instanceof ModelRequestError
        ? error
        : new ModelRequestError("Model request failed", {
            retryable: false,
            code: "model_transport_failed",
            outcome: "transient_error",
          });
    let code = safeCode(normalized.code);
    if (
      !metadataRequestBodyMatches(
        normalized.attemptMetadata,
        requestPayloadHash,
        executionMode,
      )
    ) {
      const providerStatus = safeProviderStatus(
        normalized.attemptMetadata?.providerStatus,
      );
      const attempts = [
        attemptRecord({
          metadata: normalized.attemptMetadata,
          localStartedAt,
          localFinishedAt: isoNow(clock),
          outcome: providerStatus === null ? "permanent_error" : "harness_error",
          promptHash,
          requestPayloadHash,
          errorCode: "internal_error",
        }),
      ];
      throw new Phase1CoreModelAdapterError("internal_error", { attempts });
    }
    const requestedOutcome = normalized.outcome ?? "permanent_error";
    const diagnostic = normalizedFailureDiagnostic({
      metadata: normalized.attemptMetadata,
      requestedOutcome,
      requestedCode: code,
      executionMode,
    });
    if (CONTENT_FAILURE_OUTCOMES.has(diagnostic.outcome)) {
      payloadGuard.markContentFailure(requestPayloadHash);
    }
    code = diagnostic.code;
    const attempts = [
      attemptRecord({
        metadata: normalized.attemptMetadata,
        localStartedAt,
        localFinishedAt: isoNow(clock),
        outcome: diagnostic.outcome,
        promptHash,
        requestPayloadHash,
        errorCode: code,
      }),
    ];
    throw new Phase1CoreModelAdapterError(code, {
      attempts,
      diagnostic: createProviderFailureDiagnostic({
        outcome: diagnostic.outcome,
        code,
        providerStatus: normalized.attemptMetadata?.providerStatus,
        incompleteReason: normalized.attemptMetadata?.incompleteReason,
      }),
    });
  }
}

export function createDev001CoreMockCandidate() {
  const actionQuote = "COMP7101 students must submit Assignment 1";
  const dateQuote = "5:00 pm HKT on 31 August 2026";
  const consequenceQuote =
    "Late submissions receive zero marks unless an approved extension exists.";
  return {
    title_zh: "COMP7101 作业一提交截止通知",
    title_claim_refs: ["cl-action", "cl-deadline"],
    summary_zh:
      "COMP7101 学生须在 2026 年 8 月 31 日香港时间下午 5 点前提交作业一；除非已有获批延期，迟交将计零分。",
    summary_claim_refs: ["cl-action", "cl-deadline", "cl-consequence"],
    topics: [{ label: "专业与课程", claim_refs: ["cl-action"] }],
    applicability: {
      scope: "confirmed_course",
      value: "applies",
      reason_zh: "邮件点名 COMP7101，与当前已确认课程一致。",
      claim_ref: "cl-audience",
      profile_field_ids: ["pf-dev001-course-comp7101"],
    },
    claims: [
      {
        claim_id: "cl-audience",
        type: "audience",
        text_zh: "通知面向 COMP7101 学生。",
        high_impact: true,
        evidence_refs: ["ev-action"],
      },
      {
        claim_id: "cl-action",
        type: "action",
        text_zh: "COMP7101 学生必须提交作业一。",
        high_impact: true,
        evidence_refs: ["ev-action"],
      },
      {
        claim_id: "cl-deadline",
        type: "deadline",
        text_zh: "提交截止为 2026 年 8 月 31 日香港时间下午 5 点。",
        high_impact: true,
        evidence_refs: ["ev-deadline"],
      },
      {
        claim_id: "cl-consequence",
        type: "consequence",
        text_zh: "除非已有获批延期，迟交将计零分。",
        high_impact: true,
        evidence_refs: ["ev-consequence"],
      },
    ],
    evidence: [
      { evidence_id: "ev-action", quote: actionQuote },
      { evidence_id: "ev-deadline", quote: dateQuote },
      { evidence_id: "ev-consequence", quote: consequenceQuote },
    ],
    actions: [
      {
        action_id: "act-submit",
        actor_zh: "COMP7101 学生",
        verb_zh: "提交",
        object_zh: "作业一",
        obligation: "mandatory",
        claim_refs: ["cl-action", "cl-deadline"],
      },
    ],
    deadlines: [
      {
        deadline_id: "deadline-submit",
        original_text: dateQuote,
        role: "submission_deadline",
        claim_ref: "cl-deadline",
      },
    ],
    consequence: {
      level: "medium",
      reason_zh: "邮件明确说明无获批延期时迟交计零分。",
      claim_ref: "cl-consequence",
    },
  };
}

function mockAttemptMetadata(requestBody, startedAt, finishedAt) {
  const metadata = {
    requestId: randomUUID(),
    startedAt,
    finishedAt,
    durationMs: elapsedMs(startedAt, finishedAt),
    httpStatus: null,
    providerStatus: "completed",
    incompleteReason: null,
    outputItemTypes: Object.freeze(["message"]),
    outputItemCount: 1,
    partialVisibleOutputPresent: false,
    partialVisibleOutputUtf8Bytes: 0,
    partialVisibleOutputSha256: null,
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    outputTextTokens: null,
    maxOutputTokens: requestBody.max_output_tokens,
  };
  Object.defineProperty(metadata, "requestBody", {
    enumerable: false,
    value: requestBody,
  });
  return Object.freeze(metadata);
}

export function createPhase1CoreMockModelClient({
  candidateFactory = createDev001CoreMockCandidate,
  clock = () => new Date(),
} = {}) {
  return Object.freeze({
    configured: true,
    provider: "mock",
    model: "phase1-core-offline-mock",
    async createStructuredAttempt(request) {
      const startedAt = isoNow(clock);
      const requestBody = buildStructuredRequestBody({
        model: "phase1-core-offline-mock",
        instructions: request.instructions,
        input: request.input,
        schema: request.schema,
        schemaName: request.schemaName,
        maxOutputTokens: request.maxOutputTokens,
      });
      const modelInput = JSON.parse(request.input);
      const value = await candidateFactory(modelInput, request);
      const finishedAt = isoNow(clock);
      return {
        value,
        metadata: mockAttemptMetadata(requestBody, startedAt, finishedAt),
      };
    },
  });
}
