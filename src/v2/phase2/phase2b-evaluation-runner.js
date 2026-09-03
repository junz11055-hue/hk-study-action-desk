import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  PHASE2B_APPROVED_MAX_TOTAL_OUTPUT_TOKENS,
  PHASE2B_COST_REASON,
  PHASE2B_EVALUATION_CLAIMS,
  PHASE2B_EVALUATION_RECORD_VERSION,
  PHASE2B_FROZEN_MAX_OUTPUT_TOKENS,
  PHASE2B_FROZEN_MAX_REQUEST_UTF8_BYTES,
  PHASE2B_FROZEN_MODEL,
  assertValidPhase2bAttempt,
  assertValidPhase2bEvaluationRecord,
  computePhase2bEvaluationHash,
} from "../contracts/phase2b-evaluation-record-v1.schema.js";
import {
  CORE_CANDIDATE_SCHEMA_NAME,
  NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
} from "../contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import {
  PHASE2_CANDIDATE_SCHEMA_HASH,
  PHASE2_CANDIDATE_SCHEMA_VERSION,
} from "../contracts/phase2-evaluation-record-v1.schema.js";
import { validatePhase2CoreCandidate } from "../validation/phase2-core-candidate-validator.js";
import {
  canonicalJsonStringify,
  hashCanonicalJson,
  hashUtf8,
} from "../validation/canonical-json.js";
import {
  CORE_PROMPT_VERSION,
  NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2,
} from "../prompts/notification-analysis-core-p1-v2.js";
import {
  projectCoreOverlapOracle,
} from "./core-overlap-oracle-projector.js";
import {
  createPhase2ManualReviewQueue,
  evaluateCoreCandidateSemantics,
} from "./core-semantic-evaluator.js";
import {
  PHASE2_DEVELOPMENT_CASE_IDS,
  loadPhase2DevelopmentInputs,
} from "./development-input-loader.js";
import { loadPhase2EvaluationDevelopmentCases } from "./phase2-evaluation-truth-loader.js";
import {
  DEFAULT_PHASE2B_RUNTIME_DIRECTORY,
  PHASE2B_CAPTURE_FILE_VERSION,
  phase2bRunDirectory,
  readPhase2bAuthorizationMarker,
  readPhase2bCaptureFile,
  writePhase2bEvaluationRecord,
} from "./phase2b-capture-store.js";
import { PHASE2_EVALUATION_TRUTH_ENTRIES } from "./phase2-evaluation-truth-manifest.js";

export class Phase2bEvaluationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "Phase2bEvaluationError";
    this.code = code;
  }
}

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const MARKER_KEYS = Object.freeze([
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
  "planned_case_count",
  "request_intent_count",
  "provider_request_count",
  "terminal_count",
  "terminals",
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
  "model_input_hash",
  "prompt_hash",
  "schema_hash",
  "request_payload_hash",
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
  "error",
]);
const VALIDATION_KEYS = Object.freeze([
  "schema_valid",
  "references_closed",
  "quote_unique",
  "profile_refs_allowed",
  "forbidden_fields_absent",
  "candidate_unchanged",
]);

function exactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJsonStringify(Object.keys(value).sort()) ===
      canonicalJsonStringify([...keys].sort())
  );
}

function strictTimestamp(value) {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function expectedRequestDescriptor(modelInput) {
  const requestBody = {
    model: PHASE2B_FROZEN_MODEL,
    store: false,
    instructions: NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2,
    input: canonicalJsonStringify(modelInput),
    text: {
      format: {
        type: "json_schema",
        name: CORE_CANDIDATE_SCHEMA_NAME,
        strict: true,
        schema: NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
      },
    },
    max_output_tokens: PHASE2B_FROZEN_MAX_OUTPUT_TOKENS,
  };
  if (
    Buffer.byteLength(JSON.stringify(requestBody), "utf8") >
    PHASE2B_FROZEN_MAX_REQUEST_UTF8_BYTES
  ) {
    throw new Phase2bEvaluationError(
      "phase2b_capture_invalid",
      "A frozen Phase 2B request exceeds its approved byte budget.",
    );
  }
  return {
    promptHash: hashUtf8(NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2),
    schemaHash: hashCanonicalJson(
      NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
    ),
    requestPayloadHash: hashCanonicalJson(requestBody),
  };
}

function isoNow(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("clock must return a date");
  return date.toISOString();
}

function caseFileName(caseId, caseIndex, suffix) {
  return `${String(caseIndex + 1).padStart(2, "0")}-${caseId}.${suffix}.json`;
}

function assertCaptureEnvelope(marker, index) {
  if (
    !exactKeys(marker, MARKER_KEYS) ||
    marker?.authorization_version !== "phase2b-one-shot-authorization-v1" ||
    marker.status !== "consumed" ||
    !strictTimestamp(marker.consumed_at) ||
    !COMMIT_PATTERN.test(marker.implementation_commit_sha ?? "") ||
    !Array.isArray(marker.case_ids) ||
    marker.case_ids.length !== 16 ||
    marker.case_ids.some(
      (caseId, position) => caseId !== PHASE2_DEVELOPMENT_CASE_IDS[position],
    ) ||
    marker.provider !== "deepseek" ||
    marker.model !== PHASE2B_FROZEN_MODEL ||
    marker.prompt_version !== CORE_PROMPT_VERSION ||
    marker.candidate_schema_version !== PHASE2_CANDIDATE_SCHEMA_VERSION ||
    marker.max_requests !== 16 ||
    marker.requests_per_case !== 1 ||
    marker.serial !== true ||
    marker.retries !== 0 ||
    marker.max_output_tokens !== PHASE2B_FROZEN_MAX_OUTPUT_TOKENS ||
    marker.timeout_ms !== 90_000 ||
    marker.data_scope !== "synthetic_development_only" ||
    !exactKeys(index, INDEX_KEYS) ||
    index?.capture_file_version !== PHASE2B_CAPTURE_FILE_VERSION ||
    index.kind !== "capture_index" ||
    index.status !== "captured" ||
    index.run_id !== marker.run_id ||
    index.implementation_commit_sha !== marker.implementation_commit_sha ||
    index.provider !== marker.provider ||
    index.model !== marker.model ||
    !strictTimestamp(index.started_at) ||
    !strictTimestamp(index.finished_at) ||
    Date.parse(index.finished_at) < Date.parse(index.started_at) ||
    index.planned_case_count !== 16 ||
    index.request_intent_count !== 16 ||
    index.provider_request_count !== 16 ||
    index.terminal_count !== 16 ||
    !Array.isArray(index.terminals) ||
    index.terminals.length !== 16 ||
    index.terminals.some(
      (reference, caseIndex) =>
        !exactKeys(reference, ["case_id", "case_index", "terminal_hash"]) ||
        reference.case_id !== PHASE2_DEVELOPMENT_CASE_IDS[caseIndex] ||
        reference.case_index !== caseIndex ||
        !HASH_PATTERN.test(reference.terminal_hash ?? ""),
    )
  ) {
    throw new Phase2bEvaluationError(
      "phase2b_capture_invalid",
      "The Phase 2B capture index is incomplete or inconsistent.",
    );
  }
}

async function loadAndVerifyCaptures({
  marker,
  captureIndex,
  inputs,
  runtimeDirectory,
  readCaptureImpl,
}) {
  const runDirectory = phase2bRunDirectory(marker.run_id, { runtimeDirectory });
  const verified = [];
  for (let caseIndex = 0; caseIndex < 16; caseIndex += 1) {
    const caseId = PHASE2_DEVELOPMENT_CASE_IDS[caseIndex];
    const reference = captureIndex.terminals[caseIndex];
    if (
      reference?.case_id !== caseId ||
      reference.case_index !== caseIndex
    ) {
      throw new Phase2bEvaluationError(
        "phase2b_capture_invalid",
        "The Phase 2B terminal order drifted.",
      );
    }
    const intentPath = path.join(
      runDirectory,
      caseFileName(caseId, caseIndex, "intent"),
    );
    const terminalPath = path.join(
      runDirectory,
      caseFileName(caseId, caseIndex, "terminal"),
    );
    const [intent, terminal] = await Promise.all([
      readCaptureImpl(intentPath),
      readCaptureImpl(terminalPath),
    ]);
    const descriptor = expectedRequestDescriptor(inputs[caseIndex].modelInput);
    if (
      !exactKeys(intent, INTENT_KEYS) ||
      intent?.capture_file_version !== PHASE2B_CAPTURE_FILE_VERSION ||
      intent.kind !== "request_intent" ||
      intent.run_id !== marker.run_id ||
      intent.case_id !== caseId ||
      intent.case_index !== caseIndex ||
      !strictTimestamp(intent.created_at) ||
      intent.implementation_commit_sha !== marker.implementation_commit_sha ||
      intent.provider !== "deepseek" ||
      intent.model !== PHASE2B_FROZEN_MODEL ||
      intent.model_input_hash !== inputs[caseIndex].modelInputHash ||
      intent.prompt_hash !== descriptor.promptHash ||
      intent.schema_hash !== descriptor.schemaHash ||
      intent.request_payload_hash !== descriptor.requestPayloadHash ||
      intent.max_output_tokens !== PHASE2B_FROZEN_MAX_OUTPUT_TOKENS ||
      intent.timeout_ms !== 90_000 ||
      !exactKeys(terminal, TERMINAL_KEYS) ||
      terminal?.capture_file_version !== PHASE2B_CAPTURE_FILE_VERSION ||
      terminal.kind !== "case_terminal" ||
      terminal.run_id !== marker.run_id ||
      terminal.case_id !== caseId ||
      terminal.case_index !== caseIndex ||
      !strictTimestamp(terminal.captured_at) ||
      terminal.intent_hash !== hashCanonicalJson(intent) ||
      terminal.model_input_hash !== intent.model_input_hash ||
      terminal.request_payload_hash !== intent.request_payload_hash ||
      hashCanonicalJson(terminal) !== reference.terminal_hash ||
      !["candidate_valid", "candidate_invalid", "request_failed"].includes(
        terminal.status,
      ) ||
      !exactKeys(terminal.validation, VALIDATION_KEYS) ||
      VALIDATION_KEYS.some(
        (key) => typeof terminal.validation[key] !== "boolean",
      )
    ) {
      throw new Phase2bEvaluationError(
        "phase2b_capture_invalid",
        "A Phase 2B intent or terminal failed hash verification.",
      );
    }
    try {
      assertValidPhase2bAttempt(terminal.attempt, intent.request_payload_hash);
    } catch (error) {
      throw new Phase2bEvaluationError(
        "phase2b_capture_invalid",
        "A Phase 2B attempt failed its frozen contract.",
        { cause: error },
      );
    }
    let candidate = null;
    if (terminal.status === "candidate_valid") {
      candidate = terminal.candidate;
      const before = hashCanonicalJson(candidate);
      if (
        before !== terminal.candidate_hash ||
        terminal.error !== null ||
        terminal.attempt.outcome !== "completed" ||
        terminal.attempt.provider_status !== "completed" ||
        validatePhase2CoreCandidate(candidate, inputs[caseIndex].modelInput) !==
          candidate ||
        hashCanonicalJson(candidate) !== before ||
        Object.values(terminal.validation).some((value) => value !== true)
      ) {
        throw new Phase2bEvaluationError(
          "phase2b_candidate_integrity_failed",
          "A captured Phase 2B Candidate failed final pre-truth validation.",
        );
      }
    } else if (
      terminal.candidate !== null ||
      !exactKeys(terminal.error, ["code"]) ||
      typeof terminal.error.code !== "string"
    ) {
      throw new Phase2bEvaluationError(
        "phase2b_capture_invalid",
        "An invalid capture retained a raw Candidate unexpectedly.",
      );
    }
    verified.push({ intent, terminal, candidate });
  }
  return verified;
}

function technicalFailureError(terminal) {
  return {
    code: terminal.error?.code ?? "candidate_unavailable",
    severity: "P0",
    path: "/capture",
    expected: "candidate_valid",
    actual: terminal.status,
  };
}

function recordCase({ input, capture, developmentCase, truthEntry }) {
  const { terminal, candidate } = capture;
  if (candidate === null) {
    return {
      case_id: input.caseId,
      language: input.modelInput.message.language,
      model_input_hash: input.modelInputHash,
      request_payload_hash: terminal.request_payload_hash,
      capture_status: terminal.status,
      attempt: terminal.attempt,
      candidate_hash: terminal.candidate_hash,
      technical_validation: terminal.validation,
      automatic: null,
      errors: [technicalFailureError(terminal)],
      review_queue: createPhase2ManualReviewQueue(),
      excluded_fields: [],
      capture_error: terminal.error,
    };
  }

  const oracle = projectCoreOverlapOracle(developmentCase);
  if (hashCanonicalJson(oracle) !== truthEntry.oracleHash) {
    throw new Phase2bEvaluationError(
      "phase2_evaluation_truth_invalid",
      "A frozen Phase 2B Oracle hash drifted.",
    );
  }
  const before = hashCanonicalJson(candidate);
  const evaluation = evaluateCoreCandidateSemantics({
    oracle,
    candidate,
    modelInput: input.modelInput,
  });
  if (hashCanonicalJson(candidate) !== before) {
    throw new Phase2bEvaluationError(
      "phase2b_candidate_integrity_failed",
      "Evaluation changed a captured Phase 2B Candidate.",
    );
  }
  return {
    case_id: input.caseId,
    language: input.modelInput.message.language,
    model_input_hash: input.modelInputHash,
    request_payload_hash: terminal.request_payload_hash,
    capture_status: terminal.status,
    attempt: terminal.attempt,
    candidate_hash: terminal.candidate_hash,
    technical_validation: terminal.validation,
    automatic: evaluation.automatic,
    errors: evaluation.errors,
    review_queue: evaluation.review_queue,
    excluded_fields: evaluation.excluded_fields,
    capture_error: null,
  };
}

function summaryFromCases(cases) {
  const valid = cases.filter(({ capture_status: status }) => status === "candidate_valid");
  const values = cases.map((item) => item.attempt?.input_tokens ?? null);
  const inputTokens = values.some((value) => value === null)
    ? null
    : values.reduce((total, value) => total + value, 0);
  const outputValues = cases.map((item) => item.attempt?.output_tokens ?? null);
  const outputTokens = outputValues.some((value) => value === null)
    ? null
    : outputValues.reduce((total, value) => total + value, 0);
  return {
    planned_case_count: 16,
    provider_request_count: cases.filter(({ attempt }) => attempt !== null).length,
    valid_candidate_count: valid.length,
    technical_invalid_case_count: 16 - valid.length,
    automatic_passed_case_count: valid.filter(({ automatic }) => automatic.passed)
      .length,
    automatic_failed_case_count: valid.filter(({ automatic }) => !automatic.passed)
      .length,
    pending_manual_review_count: cases.reduce(
      (total, item) =>
        total + item.review_queue.filter(({ status }) => status === "pending").length,
      0,
    ),
    total_input_tokens: inputTokens,
    total_output_tokens: outputTokens,
    total_duration_ms: cases.reduce(
      (total, item) => total + (item.attempt?.duration_ms ?? 0),
      0,
    ),
    approved_max_provider_requests: 16,
    approved_max_output_tokens_per_request: PHASE2B_FROZEN_MAX_OUTPUT_TOKENS,
    approved_max_total_output_tokens: PHASE2B_APPROVED_MAX_TOTAL_OUTPUT_TOKENS,
    approved_max_request_utf8_bytes_per_case:
      PHASE2B_FROZEN_MAX_REQUEST_UTF8_BYTES,
    estimated_cost: null,
    estimated_cost_reason: PHASE2B_COST_REASON,
  };
}

/** No provider, Key, environment, service, or listener import is reachable here. */
export async function runPhase2bEvaluation({
  runtimeDirectory = DEFAULT_PHASE2B_RUNTIME_DIRECTORY,
  readFileImpl = readFile,
  readMarkerImpl = readPhase2bAuthorizationMarker,
  readCaptureImpl = readPhase2bCaptureFile,
  loadInputsImpl = loadPhase2DevelopmentInputs,
  loadTruthImpl = loadPhase2EvaluationDevelopmentCases,
  writeRecordImpl = writePhase2bEvaluationRecord,
  clock = () => new Date(),
} = {}) {
  const startedAt = isoNow(clock);
  const marker = await readMarkerImpl({ runtimeDirectory });
  const runDirectory = phase2bRunDirectory(marker.run_id, { runtimeDirectory });
  const captureIndex = await readCaptureImpl(
    path.join(runDirectory, "capture-index.json"),
  );
  assertCaptureEnvelope(marker, captureIndex);
  const inputs = await loadInputsImpl({ readFileImpl });
  const captures = await loadAndVerifyCaptures({
    marker,
    captureIndex,
    inputs,
    runtimeDirectory,
    readCaptureImpl,
  });

  // This is the first point at which expected is allowed to materialize.
  const developmentCases = await loadTruthImpl({ readFileImpl });
  const cases = inputs.map((input, index) =>
    recordCase({
      input,
      capture: captures[index],
      developmentCase: developmentCases[index],
      truthEntry: PHASE2_EVALUATION_TRUTH_ENTRIES[index],
    }),
  );
  const summary = summaryFromCases(cases);
  const record = {
    record_version: PHASE2B_EVALUATION_RECORD_VERSION,
    run_id: marker.run_id,
    phase: "phase2b",
    status:
      summary.valid_candidate_count === 16
        ? "awaiting_manual_review"
        : "technical_failed",
    started_at: startedAt,
    finished_at: isoNow(clock),
    provider: marker.provider,
    model: marker.model,
    implementation_commit_sha: marker.implementation_commit_sha,
    prompt_version: marker.prompt_version,
    candidate_schema_version: PHASE2_CANDIDATE_SCHEMA_VERSION,
    candidate_schema_hash: PHASE2_CANDIDATE_SCHEMA_HASH,
    capture_index_hash: hashCanonicalJson(captureIndex),
    safety: {
      evaluation_process_key_reads: 0,
      evaluation_process_network_connections: 0,
      locked_file_accesses: 0,
      real_data_records: 0,
      listening_ports: 0,
      expected_loaded_after_capture_verification: true,
    },
    cases,
    summary,
    claims: {
      can_prove: [...PHASE2B_EVALUATION_CLAIMS.can_prove],
      cannot_prove: [...PHASE2B_EVALUATION_CLAIMS.cannot_prove],
    },
    canonical_evaluation_hash: "",
  };
  record.canonical_evaluation_hash = computePhase2bEvaluationHash(record);
  assertValidPhase2bEvaluationRecord(record);
  const written = await writeRecordImpl(record, { runtimeDirectory });
  return Object.freeze({
    exitCode: record.status === "technical_failed" ? 5 : 0,
    runId: record.run_id,
    record: written.snapshot,
    recordPath: written.path,
    recordHash: written.hash,
  });
}
