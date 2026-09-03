import {
  CoreContentPayloadGuard,
  Phase1CoreModelAdapterError,
} from "../model/phase1-core-model-adapter.js";
import { CORE_CANDIDATE_SCHEMA_VERSION } from "../contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import {
  analyzePhase2CoreCandidate,
  buildPhase2bRequestDescriptor,
  PHASE2B_DEEPSEEK_BASE_URL,
  PHASE2B_DEEPSEEK_MODEL,
  PHASE2B_MAX_OUTPUT_TOKENS,
  PHASE2B_TIMEOUT_MS,
} from "../model/phase2-core-model-adapter.js";
import {
  PHASE2_DEVELOPMENT_CASE_IDS,
  loadPhase2DevelopmentInputs,
} from "./development-input-loader.js";
import { CORE_PROMPT_VERSION } from "../prompts/notification-analysis-core-p1-v2.js";
import {
  PHASE2B_AUTHORIZATION_VERSION,
  PHASE2B_CAPTURE_FILE_VERSION,
  readPhase2bAuthorizationMarker,
  writePhase2bBatchTerminal,
  writePhase2bCaptureIndex,
  writePhase2bCaseTerminal,
  writePhase2bRequestIntent,
} from "./phase2b-capture-store.js";
import { canonicalJsonStringify, hashCanonicalJson } from "../validation/canonical-json.js";

const GIT_COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SYSTEMIC_STOP_CODES = new Set([
  "model_auth_failed",
  "model_not_configured",
  "model_configuration_invalid",
  "internal_error",
]);
const SAFE_ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,95}$/u;
const AUTHORIZATION_KEYS = Object.freeze([
  "authorization_version",
  "status",
  "run_id",
  "consumed_at",
  "implementation_commit_sha",
  "case_ids",
  "provider",
  "model",
  "prompt_version",
  "candidate_schema_version",
  "max_requests",
  "requests_per_case",
  "serial",
  "retries",
  "max_output_tokens",
  "timeout_ms",
  "data_scope",
]);

export class Phase2bCaptureError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "Phase2bCaptureError";
    this.code = code;
    this.triggerCode = options.triggerCode ?? null;
    this.batchTerminalWritten = options.batchTerminalWritten ?? false;
    this.batchTerminalPath = options.batchTerminalPath ?? null;
    this.batchTerminalSnapshot = options.batchTerminalSnapshot ?? null;
  }
}

export class Phase2bRequestBudget {
  #caseIds;
  #used = [];

  constructor(caseIds = PHASE2_DEVELOPMENT_CASE_IDS) {
    if (
      !Array.isArray(caseIds) ||
      caseIds.length !== 16 ||
      new Set(caseIds).size !== 16
    ) {
      throw new TypeError("Phase 2B budget requires 16 unique frozen cases");
    }
    this.#caseIds = [...caseIds];
  }

  reserve(caseId) {
    const expected = this.#caseIds[this.#used.length];
    if (expected === undefined) {
      throw new Phase2bCaptureError(
        "phase2b_request_budget_exhausted",
        "The Phase 2B batch cannot exceed 16 request intents.",
      );
    }
    if (caseId !== expected || this.#used.includes(caseId)) {
      throw new Phase2bCaptureError(
        "phase2b_case_order_invalid",
        "Phase 2B cases must be requested once in frozen order.",
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

function hasExactKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isStrictTimestamp(value) {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function assertAuthorizationMarker(marker, { runId, implementationCommitSha }) {
  if (
    !hasExactKeys(marker, AUTHORIZATION_KEYS) ||
    marker.authorization_version !== PHASE2B_AUTHORIZATION_VERSION ||
    marker.status !== "consumed" ||
    marker.run_id !== runId ||
    !isStrictTimestamp(marker.consumed_at) ||
    marker.implementation_commit_sha !== implementationCommitSha ||
    !Array.isArray(marker.case_ids) ||
    marker.case_ids.length !== PHASE2_DEVELOPMENT_CASE_IDS.length ||
    marker.case_ids.some(
      (caseId, index) => caseId !== PHASE2_DEVELOPMENT_CASE_IDS[index],
    ) ||
    marker.provider !== "deepseek" ||
    marker.model !== PHASE2B_DEEPSEEK_MODEL ||
    marker.prompt_version !== CORE_PROMPT_VERSION ||
    marker.candidate_schema_version !== CORE_CANDIDATE_SCHEMA_VERSION ||
    marker.max_requests !== 16 ||
    marker.requests_per_case !== 1 ||
    marker.serial !== true ||
    marker.retries !== 0 ||
    marker.max_output_tokens !== PHASE2B_MAX_OUTPUT_TOKENS ||
    marker.timeout_ms !== PHASE2B_TIMEOUT_MS ||
    marker.data_scope !== "synthetic_development_only"
  ) {
    throw new Phase2bCaptureError(
      "phase2b_authorization_marker_invalid",
      "The durable Phase 2B authorization marker does not match the frozen batch.",
    );
  }
}

function safeErrorCode(value, fallback = "phase2b_capture_failed") {
  return typeof value === "string" && SAFE_ERROR_CODE_PATTERN.test(value)
    ? value
    : fallback;
}

function uniqueFrozenCaseIds(values) {
  const allowed = new Set(PHASE2_DEVELOPMENT_CASE_IDS);
  return [...new Set(values.filter((value) => allowed.has(value)))];
}

export function createPhase2bFailedBatchTerminal({
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
  const intents = uniqueFrozenCaseIds(requestIntentCaseIds);
  const attempted = uniqueFrozenCaseIds(providerAttemptedCaseIds);
  const terminals = uniqueFrozenCaseIds(caseTerminalIds);
  const attemptedSet = new Set(attempted);
  const unattempted = PHASE2_DEVELOPMENT_CASE_IDS.filter(
    (caseId) => !attemptedSet.has(caseId),
  );
  return {
    capture_file_version: PHASE2B_CAPTURE_FILE_VERSION,
    kind: "batch_terminal",
    run_id: runId,
    status: "failed",
    finished_at: isoNow(clock),
    implementation_commit_sha: implementationCommitSha,
    planned_case_count: 16,
    request_intent_count: intents.length,
    provider_request_count:
      Number.isSafeInteger(providerRequestCount) && providerRequestCount >= 0
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

function assertInputs(inputs) {
  if (
    !Array.isArray(inputs) ||
    inputs.length !== PHASE2_DEVELOPMENT_CASE_IDS.length ||
    inputs.some(
      (input, index) => input?.caseId !== PHASE2_DEVELOPMENT_CASE_IDS[index],
    )
  ) {
    throw new Phase2bCaptureError(
      "phase2b_input_set_invalid",
      "The answer-free Phase 2B input set is not the frozen 16-case set.",
    );
  }
}

function assertClient(modelClient) {
  if (
    modelClient?.provider !== "deepseek" ||
    modelClient?.configured !== true ||
    modelClient?.model !== PHASE2B_DEEPSEEK_MODEL ||
    modelClient?.baseUrl !== PHASE2B_DEEPSEEK_BASE_URL ||
    modelClient?.timeoutMs !== PHASE2B_TIMEOUT_MS ||
    modelClient?.maxRetries !== 1 ||
    typeof modelClient?.createStructuredAttempt !== "function"
  ) {
    throw new Phase2bCaptureError(
      "model_configuration_invalid",
      "Phase 2B DeepSeek configuration is not frozen.",
    );
  }
}

function terminalStatus(error) {
  if (error === null) return "candidate_valid";
  if (
    [
      "candidate_schema_invalid",
      "candidate_reference_invalid",
      "candidate_evidence_invalid",
      "candidate_language_invalid",
      "candidate_forbidden_field",
      "model_response_invalid",
      "model_refused",
    ].includes(error.code)
  ) {
    return "candidate_invalid";
  }
  return "request_failed";
}

function safeAdapterError(error) {
  if (error instanceof Phase1CoreModelAdapterError) {
    return {
      code: error.code,
      attempts: Array.isArray(error.attempts) ? error.attempts : [],
      candidateHash: error.candidateHash ?? null,
    };
  }
  return {
    code: "internal_error",
    attempts: [],
    candidateHash: null,
  };
}

function detachedCandidate(candidate) {
  return JSON.parse(canonicalJsonStringify(candidate));
}

function outputProgress(onProgress, value) {
  if (typeof onProgress === "function") onProgress(Object.freeze(value));
}

/**
 * Capture exactly one DeepSeek attempt per frozen case, strictly serially.
 * This module intentionally has no Oracle, expected fixture, or evaluator import.
 */
export async function capturePhase2bCandidates({
  runId,
  implementationCommitSha,
  modelClient,
  runtimeDirectory,
  readMarkerImpl = readPhase2bAuthorizationMarker,
  loadInputsImpl = loadPhase2DevelopmentInputs,
  analyzeImpl = analyzePhase2CoreCandidate,
  writeIntentImpl = writePhase2bRequestIntent,
  writeTerminalImpl = writePhase2bCaseTerminal,
  writeIndexImpl = writePhase2bCaptureIndex,
  writeBatchTerminalImpl = writePhase2bBatchTerminal,
  budget = new Phase2bRequestBudget(),
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
      throw new Phase2bCaptureError(
        "implementation_not_frozen",
        "Phase 2B requires a frozen clean implementation commit.",
      );
    }
    const marker = await readMarkerImpl({ runtimeDirectory });
    assertAuthorizationMarker(marker, { runId, implementationCommitSha });
    assertClient(modelClient);
    startedAt = isoNow(clock);
    const inputs = await loadInputsImpl();
    assertInputs(inputs);
    const payloadGuard = new CoreContentPayloadGuard();

    for (let caseIndex = 0; caseIndex < inputs.length; caseIndex += 1) {
      const input = inputs[caseIndex];
      const ordinal = budget.reserve(input.caseId);
      if (ordinal !== caseIndex + 1) {
        throw new Phase2bCaptureError(
          "phase2b_case_order_invalid",
          "Phase 2B request reservation order drifted.",
        );
      }
      const descriptor = buildPhase2bRequestDescriptor(input.modelInput);
      if (descriptor.model_input_hash !== input.modelInputHash) {
        throw new Phase2bCaptureError(
          "phase2b_input_set_invalid",
          "A frozen Phase 2B Model Input hash drifted.",
        );
      }
      const intent = {
        capture_file_version: PHASE2B_CAPTURE_FILE_VERSION,
        kind: "request_intent",
        run_id: runId,
        case_id: input.caseId,
        case_index: caseIndex,
        created_at: isoNow(clock),
        implementation_commit_sha: implementationCommitSha,
        provider: "deepseek",
        model: PHASE2B_DEEPSEEK_MODEL,
        model_input_hash: descriptor.model_input_hash,
        prompt_hash: descriptor.prompt_hash,
        schema_hash: descriptor.schema_hash,
        request_payload_hash: descriptor.request_payload_hash,
        max_output_tokens: PHASE2B_MAX_OUTPUT_TOKENS,
        timeout_ms: PHASE2B_TIMEOUT_MS,
      };
      const intentWrite = await writeIntentImpl(intent, { runtimeDirectory });
      requestIntentCaseIds.push(input.caseId);

      let analysis = null;
      let controlledError = null;
      try {
        analysis = await analyzeImpl({
          modelClient,
          modelInput: input.modelInput,
          payloadGuard,
          clock,
        });
      } catch (error) {
        controlledError = safeAdapterError(error);
      }

      const attempts = analysis?.attempts ?? controlledError.attempts;
      providerRequestCount += attempts.length;
      if (attempts.length > 0) providerAttemptedCaseIds.push(input.caseId);
      if (attempts.length > 1) {
        throw new Phase2bCaptureError(
          "phase2b_request_budget_exhausted",
          "A Phase 2B case attempted more than one provider request.",
        );
      }
      const attempt = attempts[0] ?? null;
      if (
        attempt !== null &&
        attempt.request_payload_hash !== descriptor.request_payload_hash
      ) {
        throw new Phase2bCaptureError(
          "phase2b_attempt_integrity_failed",
          "A Phase 2B attempt did not match its persisted intent.",
        );
      }

      let candidate = null;
      let candidateHash = controlledError?.candidateHash ?? null;
      let validation = {
        schema_valid: false,
        references_closed: false,
        quote_unique: false,
        profile_refs_allowed: false,
        forbidden_fields_absent: false,
        candidate_unchanged: false,
      };
      if (analysis !== null) {
        candidate = detachedCandidate(analysis.candidate);
        candidateHash = hashCanonicalJson(candidate);
        if (candidateHash !== analysis.candidateHash) {
          throw new Phase2bCaptureError(
            "phase2b_candidate_integrity_failed",
            "A Phase 2B Candidate changed before terminal capture.",
          );
        }
        validation = { ...analysis.validation };
      }

      const error = controlledError
        ? { code: controlledError.code }
        : null;
      const terminal = {
        capture_file_version: PHASE2B_CAPTURE_FILE_VERSION,
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
        throw new Phase2bCaptureError(
          "phase2b_systemic_request_failure",
          "Phase 2B stopped after a systemic request failure.",
          { triggerCode: error.code },
        );
      }
    }

    if (!budget.complete || terminalRefs.length !== 16) {
      throw new Phase2bCaptureError(
        "phase2b_capture_incomplete",
        "Phase 2B did not persist all 16 case terminals.",
      );
    }
    const captureIndex = {
      capture_file_version: PHASE2B_CAPTURE_FILE_VERSION,
      kind: "capture_index",
      run_id: runId,
      status: "captured",
      started_at: startedAt,
      finished_at: isoNow(clock),
      implementation_commit_sha: implementationCommitSha,
      provider: "deepseek",
      model: PHASE2B_DEEPSEEK_MODEL,
      planned_case_count: 16,
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
    const controlled = error instanceof Phase2bCaptureError
      ? error
      : new Phase2bCaptureError(
          safeErrorCode(error?.code),
          "The Phase 2B capture stopped safely.",
          { cause: error },
        );
    const failedTerminal = createPhase2bFailedBatchTerminal({
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
      throw new Phase2bCaptureError(
        "phase2b_batch_terminal_write_failed",
        "The failed Phase 2B batch could not persist its terminal record.",
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
