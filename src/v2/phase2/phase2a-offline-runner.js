import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  computePhase2EvaluationHash,
  PHASE2A_FAILURE_CLAIMS as FAILURE_CLAIMS,
  PHASE2A_SAFETY_ASSURANCE,
  PHASE2A_SUCCESS_CLAIMS as SUCCESS_CLAIMS,
  PHASE2_CANDIDATE_SCHEMA_HASH,
  PHASE2_CANDIDATE_SCHEMA_VERSION,
  PHASE2_CASE_SET_VERSION,
  PHASE2_DEVELOPMENT_CASE_IDS,
  PHASE2_EVALUATION_RECORD_SCHEMA_VERSION,
  PHASE2_EVALUATOR_VERSION,
  PHASE2_INPUT_PROJECTION_VERSION,
  PHASE2_ORACLE_VERSION,
  summarizePhase2CaseResults,
} from "../contracts/phase2-evaluation-record-v1.schema.js";
import {
  CoreCandidateValidationError,
  validatePhase2CoreCandidate,
} from "../validation/phase2-core-candidate-validator.js";
import { hashCanonicalJson, hashUtf8 } from "../validation/canonical-json.js";
import {
  buildReferenceCoreCandidateForEvaluation,
  projectCoreOverlapOracle,
} from "./core-overlap-oracle-projector.js";
import { evaluateCoreCandidateSemantics } from "./core-semantic-evaluator.js";
import {
  loadPhase2DevelopmentInputs,
  Phase2DevelopmentInputError,
} from "./development-input-loader.js";
import { projectPhase2DevelopmentInput } from "./development-input-snapshot-builder.js";
import {
  PHASE2_EVALUATION_CANDIDATE_SCHEMA_HASH,
  PHASE2_EVALUATION_CANDIDATE_SCHEMA_VERSION,
  PHASE2_EVALUATION_SOURCE_FILE_HASH,
  PHASE2_EVALUATION_TRUTH_ENTRIES,
  PHASE2_EVALUATION_TRUTH_MANIFEST_HASH,
  PHASE2_EVALUATION_TRUTH_MANIFEST_VERSION,
} from "./phase2-evaluation-truth-manifest.js";
import {
  writePhase2EvaluationRecord,
} from "./phase2-evaluation-record-writer.js";

export const PHASE2_EVALUATION_DEVELOPMENT_FIXTURE_URL = new URL(
  "../../../docs/fixtures/prd-v0.2/base-development.json",
  import.meta.url,
);

const EXIT_CODES = Object.freeze({
  invalid_cli_input: 2,
  offline_input_failed: 3,
  candidate_validation_failed: 4,
  candidate_integrity_failed: 4,
  offline_evaluation_failed: 5,
  record_write_failed: 6,
  internal_error: 7,
});

const SAFE_MESSAGES = Object.freeze({
  invalid_cli_input: "Phase 2A offline accepts no command-line arguments.",
  offline_input_failed: "The frozen Phase 2A development inputs could not be loaded safely.",
  candidate_validation_failed: "A reference Candidate did not pass the Phase 2 Candidate gate.",
  candidate_integrity_failed: "A reference Candidate changed during validation or evaluation.",
  offline_evaluation_failed: "The Phase 2A offline reference evaluation did not complete.",
  record_write_failed: "The terminal Phase 2A evaluation record could not be written.",
  internal_error: "The Phase 2A offline run stopped safely.",
});

class Phase2aCandidateIntegrityError extends Error {
  constructor() {
    super(SAFE_MESSAGES.candidate_integrity_failed);
    this.name = "Phase2aCandidateIntegrityError";
    this.code = "candidate_integrity_failed";
  }
}

class Phase2aOfflineEvaluationError extends Error {
  constructor() {
    super(SAFE_MESSAGES.offline_evaluation_failed);
    this.name = "Phase2aOfflineEvaluationError";
    this.code = "offline_evaluation_failed";
  }
}

export class Phase2aOfflineCliError extends Error {
  constructor() {
    super(SAFE_MESSAGES.invalid_cli_input);
    this.name = "Phase2aOfflineCliError";
    this.code = "invalid_cli_input";
  }
}

/** The offline command is deliberately fixed and accepts no caller input. */
export function parsePhase2aOfflineCli(argv) {
  if (!Array.isArray(argv) || argv.length !== 0) {
    throw new Phase2aOfflineCliError();
  }
  return Object.freeze({});
}

function isoNow(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("clock must return a valid date");
  }
  return date.toISOString();
}

function createMonotonicClock(clock) {
  if (typeof clock !== "function") throw new TypeError("clock must be a function");
  let floor = Number.NEGATIVE_INFINITY;
  return () => {
    const value = clock();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new TypeError("clock must return a valid date");
    }
    floor = Math.max(floor, date.getTime());
    return new Date(floor);
  };
}

function safetyContractAssertions() {
  return {
    provider_requests: 0,
    network_connections: 0,
    locked_file_accesses: 0,
    secret_reads: 0,
    listening_ports: 0,
    real_data_records: 0,
  };
}

function detachedClaims(claims) {
  return {
    can_prove: [...claims.can_prove],
    cannot_prove: [...claims.cannot_prove],
  };
}

function evaluationPayload(caseResults = [], claims = FAILURE_CLAIMS) {
  return {
    dataset_split: "development",
    case_set_version: PHASE2_CASE_SET_VERSION,
    case_ids: [...PHASE2_DEVELOPMENT_CASE_IDS],
    input_projection_version: PHASE2_INPUT_PROJECTION_VERSION,
    oracle_version: PHASE2_ORACLE_VERSION,
    evaluator_version: PHASE2_EVALUATOR_VERSION,
    candidate_schema_version: PHASE2_CANDIDATE_SCHEMA_VERSION,
    candidate_schema_hash: PHASE2_CANDIDATE_SCHEMA_HASH,
    case_results: [...caseResults],
    summary: summarizePhase2CaseResults(caseResults),
    claims: detachedClaims(claims),
  };
}

function terminalRecordBase({ runId, startedAt }) {
  const record = {
    record_schema_version: PHASE2_EVALUATION_RECORD_SCHEMA_VERSION,
    run_id: runId,
    phase: "phase2a",
    execution_mode: "offline_reference",
    status: "failed",
    started_at: startedAt,
    finished_at: startedAt,
    provider: "offline_reference",
    model: null,
    prompt_version: "offline_reference",
    safety: safetyContractAssertions(),
    safety_assurance: { ...PHASE2A_SAFETY_ASSURANCE },
    evaluation: evaluationPayload(),
    canonical_evaluation_hash: "",
    error: null,
  };
  record.canonical_evaluation_hash = computePhase2EvaluationHash(record);
  return record;
}

function output(stream, value) {
  stream?.write?.(`${JSON.stringify(value)}\n`);
}

function controlledError(error) {
  let code = "internal_error";
  if (error instanceof Phase2aOfflineCliError) {
    code = "invalid_cli_input";
  } else if (error instanceof Phase2DevelopmentInputError) {
    code = "offline_input_failed";
  } else if (error instanceof CoreCandidateValidationError) {
    code = "candidate_validation_failed";
  } else if (error instanceof Phase2aCandidateIntegrityError) {
    code = "candidate_integrity_failed";
  } else if (error instanceof Phase2aOfflineEvaluationError) {
    code = "offline_evaluation_failed";
  }
  return { code, message: SAFE_MESSAGES[code] };
}

function assertExactFrozenCaseOrder(values, selectCaseId) {
  if (
    values.length !== PHASE2_DEVELOPMENT_CASE_IDS.length ||
    values.some(
      (value, index) =>
        selectCaseId(value) !== PHASE2_DEVELOPMENT_CASE_IDS[index],
    )
  ) {
    throw new Phase2aOfflineEvaluationError();
  }
}

function assertEvaluationTruthManifest() {
  assertExactFrozenCaseOrder(
    PHASE2_EVALUATION_TRUTH_ENTRIES,
    (entry) => entry.caseId,
  );
  const manifestHash = hashCanonicalJson({
    manifestVersion: PHASE2_EVALUATION_TRUTH_MANIFEST_VERSION,
    candidateSchemaVersion: PHASE2_EVALUATION_CANDIDATE_SCHEMA_VERSION,
    candidateSchemaHash: PHASE2_EVALUATION_CANDIDATE_SCHEMA_HASH,
    caseIds: [...PHASE2_DEVELOPMENT_CASE_IDS],
    entries: PHASE2_EVALUATION_TRUTH_ENTRIES,
  });
  if (
    PHASE2_EVALUATION_CANDIDATE_SCHEMA_VERSION !==
      PHASE2_CANDIDATE_SCHEMA_VERSION ||
    PHASE2_EVALUATION_CANDIDATE_SCHEMA_HASH !== PHASE2_CANDIDATE_SCHEMA_HASH
  ) {
    throw new Phase2aOfflineEvaluationError();
  }
  if (manifestHash !== PHASE2_EVALUATION_TRUTH_MANIFEST_HASH) {
    throw new Phase2aOfflineEvaluationError();
  }
}

async function loadEvaluationDevelopmentCases(readFileImpl) {
  let parsed;
  try {
    const source = await readFileImpl(
      PHASE2_EVALUATION_DEVELOPMENT_FIXTURE_URL,
      "utf8",
    );
    if (
      typeof source !== "string" ||
      hashUtf8(source) !== PHASE2_EVALUATION_SOURCE_FILE_HASH
    ) {
      throw new Phase2aOfflineEvaluationError();
    }
    parsed = JSON.parse(source);
  } catch {
    throw new Phase2aOfflineEvaluationError();
  }
  if (!Array.isArray(parsed)) throw new Phase2aOfflineEvaluationError();

  const selected = PHASE2_DEVELOPMENT_CASE_IDS.map((caseId) => {
    const matches = parsed.filter((item) => item?.case_id === caseId);
    if (matches.length !== 1) throw new Phase2aOfflineEvaluationError();
    return matches[0];
  });
  assertExactFrozenCaseOrder(selected, (item) => item.case_id);
  selected.forEach((developmentCase, index) => {
    const truthEntry = PHASE2_EVALUATION_TRUTH_ENTRIES[index];
    const expectedHash = hashCanonicalJson({
      caseId: developmentCase.case_id,
      datasetSplit: developmentCase.dataset_split,
      expected: developmentCase.expected,
    });
    if (expectedHash !== truthEntry.expectedHash) {
      throw new Phase2aOfflineEvaluationError();
    }
  });
  return selected;
}

function successfulTechnicalValidation(candidateHashBefore, candidateHashAfter) {
  return {
    candidate_schema_valid: true,
    references_closed: true,
    quote_unique: true,
    profile_refs_allowed: true,
    forbidden_fields_absent: true,
    candidate_unchanged: candidateHashBefore === candidateHashAfter,
  };
}

function buildCaseResult({ projectedInput, developmentCase, truthEntry }) {
  if (
    projectedInput.caseId !== developmentCase.case_id ||
    projectedInput.caseId !== truthEntry.caseId ||
    projectedInput.datasetSplit !== "development" ||
    projectedInput.projectionVersion !== PHASE2_INPUT_PROJECTION_VERSION ||
    projectedInput.modelInputHash !== hashCanonicalJson(projectedInput.modelInput) ||
    projectedInput.modelInputHash !== truthEntry.modelInputHash
  ) {
    throw new Phase2aOfflineEvaluationError();
  }

  let sourceModelInputHash;
  let oracle;
  let candidate;
  try {
    sourceModelInputHash = hashCanonicalJson(
      projectPhase2DevelopmentInput(developmentCase),
    );
    oracle = projectCoreOverlapOracle(developmentCase);
    candidate = buildReferenceCoreCandidateForEvaluation(
      developmentCase,
      oracle,
    );
  } catch {
    throw new Phase2aOfflineEvaluationError();
  }
  const oracleHash = hashCanonicalJson(oracle);
  const candidateHashBefore = hashCanonicalJson(candidate);
  if (
    sourceModelInputHash !== projectedInput.modelInputHash ||
    oracleHash !== truthEntry.oracleHash ||
    candidateHashBefore !== truthEntry.referenceCandidateHash
  ) {
    throw new Phase2aOfflineEvaluationError();
  }
  const acceptedCandidate = validatePhase2CoreCandidate(
    candidate,
    projectedInput.modelInput,
  );
  if (acceptedCandidate !== candidate) throw new Phase2aCandidateIntegrityError();
  if (hashCanonicalJson(candidate) !== candidateHashBefore) {
    throw new Phase2aCandidateIntegrityError();
  }

  const evaluation = evaluateCoreCandidateSemantics({
    oracle,
    candidate,
    modelInput: projectedInput.modelInput,
  });
  const candidateHashAfter = hashCanonicalJson(candidate);
  if (candidateHashAfter !== candidateHashBefore) {
    throw new Phase2aCandidateIntegrityError();
  }
  if (
    evaluation.case_id !== projectedInput.caseId ||
    evaluation.evaluator_version !== PHASE2_EVALUATOR_VERSION ||
    evaluation.automatic.passed !== true ||
    evaluation.errors.length !== 0
  ) {
    throw new Phase2aOfflineEvaluationError();
  }

  return {
    case_id: evaluation.case_id,
    language: projectedInput.modelInput.message.language,
    input_projection_version: projectedInput.projectionVersion,
    oracle_version: oracle.oracle_version,
    evaluator_version: evaluation.evaluator_version,
    hashes: {
      model_input_hash: projectedInput.modelInputHash,
      oracle_hash: oracleHash,
      candidate_hash_before: candidateHashBefore,
      candidate_hash_after: candidateHashAfter,
    },
    technical_validation: successfulTechnicalValidation(
      candidateHashBefore,
      candidateHashAfter,
    ),
    automatic: evaluation.automatic,
    errors: evaluation.errors,
    review_queue: evaluation.review_queue,
    excluded_fields: evaluation.excluded_fields,
  };
}

async function persistAndReport({
  record,
  recordsDirectory,
  writeRecordImpl,
  stdout,
  stderr,
}) {
  try {
    const written = await writeRecordImpl(record, { recordsDirectory });
    if (record.status === "succeeded") {
      output(stdout, {
        status: record.status,
        run_id: record.run_id,
        record_path: written.recordPath,
      });
      return {
        exitCode: 0,
        record,
        recordPath: written.recordPath,
        staleTempFiles: written.staleTempFiles ?? [],
      };
    }

    const exitCode = EXIT_CODES[record.error.code] ?? EXIT_CODES.internal_error;
    output(stderr, {
      error: { code: record.error.code },
      run_id: record.run_id,
      record_path: written.recordPath,
      exit_code: exitCode,
    });
    return {
      exitCode,
      record,
      recordPath: written.recordPath,
      staleTempFiles: written.staleTempFiles ?? [],
    };
  } catch {
    const persistenceError = {
      code: "record_write_failed",
      message: SAFE_MESSAGES.record_write_failed,
    };
    output(stderr, {
      error: { code: persistenceError.code },
      run_id: record.run_id,
      record_path: null,
      exit_code: EXIT_CODES.record_write_failed,
    });
    return {
      exitCode: EXIT_CODES.record_write_failed,
      record: null,
      attemptedRecord: record,
      persistenceError,
      recordPath: null,
      staleTempFiles: [],
    };
  }
}

/**
 * Run the fixed Phase 2A reference evaluation once. This function has no
 * provider, configuration, service, environment, network, or listener path.
 */
export async function runPhase2aOffline({
  argv = [],
  runId = randomUUID(),
  recordsDirectory,
  readFileImpl = readFile,
  writeRecordImpl = writePhase2EvaluationRecord,
  clock = () => new Date(),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const executionClock = createMonotonicClock(clock);
  const startedAt = isoNow(executionClock);
  const record = terminalRecordBase({ runId, startedAt });
  const caseResults = [];

  try {
    parsePhase2aOfflineCli(argv);
    assertEvaluationTruthManifest();

    // This first read is the answer-free, sanitized Model Input snapshot.
    const projectedInputs = await loadPhase2DevelopmentInputs({ readFileImpl });
    assertExactFrozenCaseOrder(projectedInputs, (item) => item.caseId);

    // Evaluation truth is opened only after all Model Inputs were captured.
    const developmentCases = await loadEvaluationDevelopmentCases(readFileImpl);
    for (let index = 0; index < projectedInputs.length; index += 1) {
      caseResults.push(
        buildCaseResult({
          projectedInput: projectedInputs[index],
          developmentCase: developmentCases[index],
          truthEntry: PHASE2_EVALUATION_TRUTH_ENTRIES[index],
        }),
      );
    }
    assertExactFrozenCaseOrder(caseResults, (item) => item.case_id);

    record.status = "succeeded";
    record.finished_at = isoNow(executionClock);
    record.evaluation = evaluationPayload(caseResults, SUCCESS_CLAIMS);
    record.error = null;
    record.canonical_evaluation_hash = computePhase2EvaluationHash(record);
  } catch (error) {
    record.status = "failed";
    record.finished_at = isoNow(executionClock);
    record.evaluation = evaluationPayload(caseResults, FAILURE_CLAIMS);
    record.error = controlledError(error);
    record.canonical_evaluation_hash = computePhase2EvaluationHash(record);
  }

  return await persistAndReport({
    record,
    recordsDirectory,
    writeRecordImpl,
    stdout,
    stderr,
  });
}
