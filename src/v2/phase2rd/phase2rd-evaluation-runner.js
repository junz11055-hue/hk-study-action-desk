import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  PHASE2RD_EVALUATION_CLAIMS,
  PHASE2RD_EVALUATION_RECORD_VERSION,
  PHASE2RD_FROZEN_PROMPT_HASH,
  PHASE2RD_HISTORICAL_BASELINE,
  assertValidPhase2rdEvaluationRecord,
  buildPhase2rdEvaluationSummary,
  computePhase2rdEvaluationHash,
  phase2rdPassedAutomaticGates,
} from "../contracts/phase2rd-evaluation-record-v1.schema.js";
import {
  PHASE2_CANDIDATE_SCHEMA_HASH,
  PHASE2_CANDIDATE_SCHEMA_VERSION,
  PHASE2_DEVELOPMENT_CASE_IDS,
} from "../contracts/phase2-evaluation-record-v1.schema.js";
import {
  createPhase2ManualReviewQueue,
  evaluateCoreCandidateSemantics,
} from "../phase2/core-semantic-evaluator.js";
import {
  projectCoreOverlapOracle,
} from "../phase2/core-overlap-oracle-projector.js";
import {
  assertPhase2EvaluationTruthManifest,
  loadPhase2EvaluationDevelopmentCases,
} from "../phase2/phase2-evaluation-truth-loader.js";
import {
  PHASE2_EVALUATION_TRUTH_ENTRIES,
} from "../phase2/phase2-evaluation-truth-manifest.js";
import {
  loadPhase2rDevelopmentInputs,
} from "../phase2r/phase2r-development-input-loader.js";
import {
  buildPhase2rcRequestDescriptor,
} from "../phase2rc/phase2rc-request-contract.js";
import {
  Phase2rcSemanticGateError,
  validatePhase2rcSemanticCandidate,
} from "../phase2rc/phase2rc-semantic-gate.js";
import {
  validatePhase2rCoreCandidate,
} from "../phase2r/phase2r-core-candidate-validator.js";
import {
  toPhase2LegacyModelInput,
  validatePhase2rModelInput,
} from "../phase2r/phase2r-model-input-validator.js";
import {
  canonicalJsonStringify,
  hashCanonicalJson,
} from "../validation/canonical-json.js";
import {
  DEFAULT_PHASE2RD_RUNTIME_DIRECTORY,
  phase2rdRunDirectory,
  readPhase2rdAuthorizationMarker,
  readPhase2rdCaptureFile,
  writePhase2rdEvaluationRecord,
} from "./phase2rd-capture-store.js";
import {
  assertValidPhase2rdAuthorizationMarker,
  assertValidPhase2rdCaptureIndex,
  assertValidPhase2rdCaseTerminal,
  assertValidPhase2rdRequestIntent,
} from "./phase2rd-capture-contract.js";
import {
  PHASE2RD_CASE_IDS,
  PHASE2RD_CASE_SET_HASH,
  PHASE2RD_DIAGNOSTIC_VERSION,
  PHASE2RD_MAX_REQUEST_UTF8_BYTES,
  PHASE2RD_MODEL,
  PHASE2RD_MODEL_INPUT_SET_HASH,
  PHASE2RD_PROMPT_VERSION,
  PHASE2RD_PROVIDER,
  PHASE2RD_SOURCE_CONTEXT_FILE_HASH,
  PHASE2RD_SOURCE_CONTEXT_SNAPSHOT_HASH,
} from "./phase2rd-run-contract.js";

export class Phase2rdEvaluationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "Phase2rdEvaluationError";
    this.code = code;
  }
}

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
function exactKeys(value, keys) {
  return (
    value !== null &&
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

function fail(code, message, options) {
  throw new Phase2rdEvaluationError(code, message, options);
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

function expectedRequestDescriptor(modelInput) {
  validatePhase2rModelInput(modelInput);
  const descriptor = buildPhase2rcRequestDescriptor(modelInput, {
    model: PHASE2RD_MODEL,
  });
  const requestUtf8Bytes = descriptor.request_utf8_bytes;
  if (requestUtf8Bytes > PHASE2RD_MAX_REQUEST_UTF8_BYTES) {
    fail(
      "phase2rd_capture_invalid",
      "A frozen Phase 2R-D request exceeds its approved byte budget.",
    );
  }
  return {
    promptHash: descriptor.prompt_hash,
    schemaHash: descriptor.schema_hash,
    requestPayloadHash: descriptor.request_payload_hash,
    requestUtf8Bytes,
  };
}

function assertCaptureEnvelope(marker, index) {
  try {
    assertValidPhase2rdAuthorizationMarker(marker);
    assertValidPhase2rdCaptureIndex(index);
  } catch (error) {
    fail(
      "phase2rd_capture_invalid",
      "The Phase 2R-D marker or capture index failed its exact contract.",
      { cause: error },
    );
  }
  if (
    index.run_id !== marker.run_id ||
    index.implementation_commit_sha !== marker.implementation_commit_sha ||
    index.provider !== marker.provider ||
    index.model !== marker.model ||
    index.prompt_version !== marker.prompt_version ||
    !strictTimestamp(index.started_at) ||
    !strictTimestamp(index.finished_at) ||
    Date.parse(index.started_at) < Date.parse(marker.consumed_at) ||
    Date.parse(index.finished_at) < Date.parse(index.started_at)
  ) {
    fail(
      "phase2rd_capture_invalid",
      "The Phase 2R-D marker or capture index is incomplete or inconsistent.",
    );
  }
}

function selectAndVerifyInputs(allInputs) {
  if (
    !Array.isArray(allInputs) ||
    allInputs.length !== PHASE2_DEVELOPMENT_CASE_IDS.length ||
    allInputs.some(
      (item, index) => item?.caseId !== PHASE2_DEVELOPMENT_CASE_IDS[index],
    ) ||
    allInputs.some(
      (item) =>
        item.modelInputHash !== hashCanonicalJson(item.modelInput) ||
        validatePhase2rModelInput(item.modelInput) !== item.modelInput,
    ) ||
    hashCanonicalJson(
      allInputs.map(({ caseId, modelInputHash }) => ({ caseId, modelInputHash })),
    ) !== PHASE2RD_MODEL_INPUT_SET_HASH
  ) {
    fail(
      "phase2rd_input_invalid",
      "The frozen answer-free Phase 2R Input set drifted.",
    );
  }
  return PHASE2RD_CASE_IDS.map(
    (caseId) => allInputs[PHASE2_DEVELOPMENT_CASE_IDS.indexOf(caseId)],
  );
}

async function loadAndVerifyCaptures({
  marker,
  captureIndex,
  inputs,
  runtimeDirectory,
  readCaptureImpl,
}) {
  const runDirectory = phase2rdRunDirectory(marker.run_id, { runtimeDirectory });
  const verified = [];
  for (let caseIndex = 0; caseIndex < PHASE2RD_CASE_IDS.length; caseIndex += 1) {
    const caseId = PHASE2RD_CASE_IDS[caseIndex];
    const reference = captureIndex.terminals[caseIndex];
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
    const input = inputs[caseIndex];
    const descriptor = expectedRequestDescriptor(input.modelInput);
    const markerDescriptor = marker.request_descriptors[caseIndex];
    try {
      assertValidPhase2rdRequestIntent(intent);
      assertValidPhase2rdCaseTerminal(terminal);
    } catch (error) {
      fail(
        "phase2rd_capture_invalid",
        "A Phase 2R-D intent or terminal failed its exact contract.",
        { cause: error },
      );
    }
    if (
      markerDescriptor.case_id !== caseId ||
      markerDescriptor.case_index !== caseIndex ||
      markerDescriptor.model_input_hash !== input.modelInputHash ||
      markerDescriptor.prompt_hash !== descriptor.promptHash ||
      markerDescriptor.schema_hash !== descriptor.schemaHash ||
      markerDescriptor.request_payload_hash !== descriptor.requestPayloadHash ||
      markerDescriptor.request_utf8_bytes !== descriptor.requestUtf8Bytes ||
      intent.run_id !== marker.run_id ||
      intent.case_id !== caseId ||
      intent.case_index !== caseIndex ||
      !strictTimestamp(intent.created_at) ||
      Date.parse(intent.created_at) < Date.parse(captureIndex.started_at) ||
      Date.parse(intent.created_at) > Date.parse(captureIndex.finished_at) ||
      intent.implementation_commit_sha !== marker.implementation_commit_sha ||
      intent.model_input_hash !== input.modelInputHash ||
      intent.prompt_hash !== descriptor.promptHash ||
      intent.schema_hash !== descriptor.schemaHash ||
      intent.schema_hash !== PHASE2_CANDIDATE_SCHEMA_HASH ||
      intent.request_payload_hash !== descriptor.requestPayloadHash ||
      intent.request_utf8_bytes !== descriptor.requestUtf8Bytes ||
      intent.model_input_hash !== markerDescriptor.model_input_hash ||
      intent.request_payload_hash !== markerDescriptor.request_payload_hash ||
      intent.request_utf8_bytes > PHASE2RD_MAX_REQUEST_UTF8_BYTES ||
      terminal.run_id !== marker.run_id ||
      terminal.case_id !== caseId ||
      terminal.case_index !== caseIndex ||
      !strictTimestamp(terminal.captured_at) ||
      Date.parse(terminal.captured_at) < Date.parse(intent.created_at) ||
      Date.parse(terminal.captured_at) > Date.parse(captureIndex.finished_at) ||
      terminal.intent_hash !== hashCanonicalJson(intent) ||
      terminal.model_input_hash !== intent.model_input_hash ||
      terminal.request_payload_hash !== intent.request_payload_hash ||
      hashCanonicalJson(terminal) !== reference.terminal_hash ||
      terminal.attempt === null
    ) {
      fail(
        "phase2rd_capture_invalid",
        "A Phase 2R-D intent or terminal failed full hash verification.",
      );
    }
    let candidate = null;
    if (terminal.status === "candidate_valid") {
      candidate = terminal.candidate;
      let before;
      try {
        before = hashCanonicalJson(candidate);
        if (
          before !== terminal.candidate_hash ||
          terminal.diagnostic !== null ||
          terminal.error !== null ||
          terminal.attempt.outcome !== "completed" ||
          terminal.attempt.provider_status !== "completed" ||
          validatePhase2rCoreCandidate(candidate, input.modelInput) !== candidate ||
          hashCanonicalJson(candidate) !== before ||
          Object.values(terminal.validation).some((value) => value !== true)
        ) {
          throw new Error("candidate integrity mismatch");
        }
      } catch (error) {
        fail(
          "phase2rd_candidate_integrity_failed",
          "A captured Phase 2R-D Candidate failed final pre-truth validation.",
          { cause: error },
        );
      }
    } else {
      if (
        terminal.candidate !== null ||
        !(terminal.candidate_hash === null ||
          HASH_PATTERN.test(terminal.candidate_hash ?? "")) ||
        !exactKeys(terminal.error, ["code"]) ||
        typeof terminal.error.code !== "string" ||
        terminal.diagnostic === null
      ) {
        fail(
          "phase2rd_capture_invalid",
          "An invalid Phase 2R-D capture retained unsafe or incomplete data.",
        );
      }
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

function verifyTruthCase(developmentCase, truthEntry, caseId) {
  if (
    developmentCase?.case_id !== caseId ||
    truthEntry?.caseId !== caseId ||
    hashCanonicalJson({
      caseId: developmentCase.case_id,
      datasetSplit: developmentCase.dataset_split,
      expected: developmentCase.expected,
    }) !== truthEntry.expectedHash
  ) {
    fail(
      "phase2_evaluation_truth_invalid",
      "A frozen Phase 2R-D development expected record drifted.",
    );
  }
  const oracle = projectCoreOverlapOracle(developmentCase);
  if (hashCanonicalJson(oracle) !== truthEntry.oracleHash) {
    fail(
      "phase2_evaluation_truth_invalid",
      "A frozen Phase 2R-D Oracle hash drifted.",
    );
  }
  return oracle;
}

function recordCase({ input, capture, oracle }) {
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
      semantic_gate: { status: "not_run", issues: [] },
      automatic: null,
      errors: [technicalFailureError(terminal)],
      review_queue: createPhase2ManualReviewQueue(),
      excluded_fields: [],
      diagnostic: terminal.diagnostic,
      capture_error: terminal.error,
    };
  }

  const before = hashCanonicalJson(candidate);
  let semanticGate;
  try {
    validatePhase2rcSemanticCandidate(candidate, input.modelInput);
    semanticGate = { status: "pass", issues: [] };
  } catch (error) {
    if (!(error instanceof Phase2rcSemanticGateError)) throw error;
    semanticGate = {
      status: "fail",
      issues: error.issues.map((issue) => ({ ...issue })),
    };
  }
  const evaluation = evaluateCoreCandidateSemantics({
    oracle,
    candidate,
    modelInput: toPhase2LegacyModelInput(input.modelInput),
  });
  if (hashCanonicalJson(candidate) !== before) {
    fail(
      "phase2rd_candidate_integrity_failed",
      "Evaluation changed a captured Phase 2R-D Candidate.",
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
    semantic_gate: semanticGate,
    automatic: evaluation.automatic,
    errors: evaluation.errors,
    review_queue: evaluation.review_queue,
    excluded_fields: evaluation.excluded_fields,
    diagnostic: null,
    capture_error: null,
  };
}

/** No provider, Key, environment, network, service, or listener is reachable here. */
export async function runPhase2rdEvaluation({
  runtimeDirectory = DEFAULT_PHASE2RD_RUNTIME_DIRECTORY,
  readFileImpl = readFile,
  readMarkerImpl = readPhase2rdAuthorizationMarker,
  readCaptureImpl = readPhase2rdCaptureFile,
  loadInputsImpl = loadPhase2rDevelopmentInputs,
  loadTruthImpl = loadPhase2EvaluationDevelopmentCases,
  writeRecordImpl = writePhase2rdEvaluationRecord,
  clock = () => new Date(),
} = {}) {
  const startedAt = isoNow(clock);
  const marker = await readMarkerImpl({ runtimeDirectory });
  try {
    assertValidPhase2rdAuthorizationMarker(marker);
  } catch (error) {
    fail(
      "phase2rd_capture_invalid",
      "The Phase 2R-D authorization marker failed its exact contract.",
      { cause: error },
    );
  }
  const runDirectory = phase2rdRunDirectory(marker.run_id, { runtimeDirectory });
  const captureIndex = await readCaptureImpl(
    path.join(runDirectory, "capture-index.json"),
  );
  assertCaptureEnvelope(marker, captureIndex);

  // These Inputs are answer-free. Expected remains unreachable at this point.
  const inputs = selectAndVerifyInputs(
    await loadInputsImpl({ readFileImpl }),
  );
  const captures = await loadAndVerifyCaptures({
    marker,
    captureIndex,
    inputs,
    runtimeDirectory,
    readCaptureImpl,
  });

  // This is deliberately the first point at which development expected may load.
  assertPhase2EvaluationTruthManifest();
  const developmentCases = await loadTruthImpl({ readFileImpl });
  if (
    !Array.isArray(developmentCases) ||
    developmentCases.length !== PHASE2_DEVELOPMENT_CASE_IDS.length ||
    developmentCases.some(
      (item, index) => item?.case_id !== PHASE2_DEVELOPMENT_CASE_IDS[index],
    )
  ) {
    fail(
      "phase2_evaluation_truth_invalid",
      "The frozen Phase 2R-D development truth set is incomplete.",
    );
  }
  const selectedTruth = PHASE2RD_CASE_IDS.map((caseId) => {
    const truthIndex = PHASE2_DEVELOPMENT_CASE_IDS.indexOf(caseId);
    const developmentCase = developmentCases[truthIndex];
    const truthEntry = PHASE2_EVALUATION_TRUTH_ENTRIES[truthIndex];
    return verifyTruthCase(developmentCase, truthEntry, caseId);
  });
  const cases = PHASE2RD_CASE_IDS.map((_, selectedIndex) =>
    recordCase({
      input: inputs[selectedIndex],
      capture: captures[selectedIndex],
      oracle: selectedTruth[selectedIndex],
    }),
  );
  const summary = buildPhase2rdEvaluationSummary(cases);
  const record = {
    record_version: PHASE2RD_EVALUATION_RECORD_VERSION,
    run_id: marker.run_id,
    phase: "phase2r-d",
    status: phase2rdPassedAutomaticGates(summary)
      ? "pending_manual_review"
      : "failed",
    started_at: startedAt,
    finished_at: isoNow(clock),
    provider: PHASE2RD_PROVIDER,
    model: PHASE2RD_MODEL,
    implementation_commit_sha: marker.implementation_commit_sha,
    prompt_version: PHASE2RD_PROMPT_VERSION,
    prompt_hash: PHASE2RD_FROZEN_PROMPT_HASH,
    candidate_schema_version: PHASE2_CANDIDATE_SCHEMA_VERSION,
    candidate_schema_hash: PHASE2_CANDIDATE_SCHEMA_HASH,
    diagnostic_version: PHASE2RD_DIAGNOSTIC_VERSION,
    case_set_hash: PHASE2RD_CASE_SET_HASH,
    model_input_set_hash: PHASE2RD_MODEL_INPUT_SET_HASH,
    source_context_snapshot_hash: PHASE2RD_SOURCE_CONTEXT_SNAPSHOT_HASH,
    source_context_file_hash: PHASE2RD_SOURCE_CONTEXT_FILE_HASH,
    authorization_marker_hash: hashCanonicalJson(marker),
    capture_index_hash: hashCanonicalJson(captureIndex),
    safety: {
      evaluation_process_key_reads: 0,
      evaluation_process_network_connections: 0,
      locked_file_accesses: 0,
      real_data_records: 0,
      listening_ports: 0,
      expected_loaded_after_capture_verification: true,
      full_batch_provider_requests: 0,
    },
    historical_baseline: {
      ...PHASE2RD_HISTORICAL_BASELINE,
      selected_case_ids: [...PHASE2RD_HISTORICAL_BASELINE.selected_case_ids],
    },
    cases,
    summary,
    claims: {
      can_prove: [...PHASE2RD_EVALUATION_CLAIMS.can_prove],
      cannot_prove: [...PHASE2RD_EVALUATION_CLAIMS.cannot_prove],
    },
    canonical_evaluation_hash: "",
  };
  record.canonical_evaluation_hash = computePhase2rdEvaluationHash(record);
  assertValidPhase2rdEvaluationRecord(record);
  const written = await writeRecordImpl(record, { runtimeDirectory });
  return Object.freeze({
    exitCode: record.status === "pending_manual_review" ? 0 : 5,
    runId: record.run_id,
    record: written.snapshot,
    recordPath: written.path,
    recordHash: written.hash,
  });
}
