import { randomUUID } from "node:crypto";

import {
  CANDIDATE_SCHEMA_DIALECT,
  CANDIDATE_SCHEMA_VERSION,
  NOTIFICATION_ANALYSIS_CANDIDATE_P1_SCHEMA,
} from "../contracts/notification-analysis-candidate-p1.schema.js";
import {
  PHASE1_RUN_RECORD_SCHEMA_VERSION,
} from "../contracts/phase1-run-record-v1.schema.js";
import {
  DevelopmentFixtureError,
  loadDevelopmentFixture,
  PHASE1_ALLOWED_CASE_ID,
  PHASE1_DATASET_SPLIT,
} from "../fixtures/development-fixture-loader.js";
import {
  analyzePhase1Candidate,
  PHASE1_MAX_PROVIDER_ATTEMPTS,
  Phase1ModelAdapterError,
} from "../model/phase1-model-adapter.js";
import {
  NOTIFICATION_ANALYSIS_PROMPT_P1,
  PHASE1_PROMPT_VERSION,
} from "../prompts/notification-analysis-prompt-p1.js";
import { hashCanonicalJson, hashUtf8 } from "../validation/canonical-json.js";
import {
  Phase1RunRecordWriteError,
  writePhase1RunRecord,
} from "./run-record-writer.js";

const EXIT_CODES = Object.freeze({
  invalid_cli_input: 2,
  fixture_not_allowed: 2,
  fixture_invalid: 2,
  model_not_configured: 3,
  model_auth_failed: 3,
  smoke_lock_unavailable: 3,
  model_timeout: 4,
  model_rate_limited: 4,
  model_transport_failed: 4,
  model_refused: 4,
  model_response_invalid: 5,
  candidate_schema_invalid: 5,
  candidate_reference_invalid: 5,
  candidate_evidence_invalid: 5,
  candidate_forbidden_field: 5,
  record_write_failed: 6,
  internal_error: 7,
});

const SAFE_MESSAGES = Object.freeze({
  invalid_cli_input: "Only --case DEV001 is accepted.",
  fixture_not_allowed: "The requested fixture is not allowed in Phase 1.",
  fixture_invalid: "The approved development fixture is invalid.",
  model_not_configured: "DeepSeek is not configured.",
  model_auth_failed: "DeepSeek authentication failed.",
  smoke_lock_unavailable: "Another smoke run holds the exclusive lock.",
  model_timeout: "The model request timed out.",
  model_rate_limited: "The model request was rate limited.",
  model_transport_failed: "The model transport failed.",
  model_refused: "The model refused the structured request.",
  model_response_invalid: "The model response was not valid JSON output.",
  candidate_schema_invalid: "The candidate did not match the approved schema.",
  candidate_reference_invalid: "The candidate contained an invalid reference.",
  candidate_evidence_invalid: "The candidate contained an invalid evidence locator.",
  candidate_forbidden_field: "The candidate crossed a Harness ownership boundary.",
  record_write_failed: "The terminal run record could not be written.",
  internal_error: "The Phase 1 run failed internally.",
});

function safeCode(value) {
  return Object.hasOwn(EXIT_CODES, value) ? value : "internal_error";
}

function safeError(code) {
  const normalized = safeCode(code);
  return { code: normalized, message: SAFE_MESSAGES[normalized] };
}

function isoNow(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("clock must return a valid date");
  return date.toISOString();
}

function emptyValidation() {
  return {
    schema_valid: false,
    references_closed: false,
    locator_quotes_exact: false,
    forbidden_fields_absent: false,
    candidate_unchanged: false,
  };
}

function emptyHashes() {
  return {
    fixture_input_hash: null,
    prompt_hash: hashUtf8(NOTIFICATION_ANALYSIS_PROMPT_P1),
    schema_hash: hashCanonicalJson(NOTIFICATION_ANALYSIS_CANDIDATE_P1_SCHEMA),
    model_payload_hash: null,
    candidate_hash: null,
    delivered_output_hash: null,
  };
}

export class Phase1CliError extends Error {
  constructor(message = SAFE_MESSAGES.invalid_cli_input) {
    super(message);
    this.name = "Phase1CliError";
    this.code = "invalid_cli_input";
  }
}

export function parsePhase1Cli(argv) {
  if (
    !Array.isArray(argv) ||
    argv.length !== 2 ||
    argv[0] !== "--case" ||
    argv[1] !== PHASE1_ALLOWED_CASE_ID
  ) {
    throw new Phase1CliError();
  }
  return Object.freeze({ caseId: PHASE1_ALLOWED_CASE_ID });
}

function terminalRecordBase({
  executionMode,
  runId,
  startedAt,
  modelClient,
  timeoutMs,
}) {
  return {
    record_schema_version: PHASE1_RUN_RECORD_SCHEMA_VERSION,
    run_id: runId,
    case_id: PHASE1_ALLOWED_CASE_ID,
    dataset_split: PHASE1_DATASET_SPLIT,
    execution_mode: executionMode,
    status: "failed",
    started_at: startedAt,
    finished_at: startedAt,
    provider: executionMode,
    model: executionMode === "deepseek" ? (modelClient?.model ?? null) : null,
    prompt_version: PHASE1_PROMPT_VERSION,
    candidate_schema_version: CANDIDATE_SCHEMA_VERSION,
    schema_dialect: CANDIDATE_SCHEMA_DIALECT,
    attempt_budget_exhausted: false,
    decoding: {
      max_attempts: PHASE1_MAX_PROVIDER_ATTEMPTS,
      initial_max_output_tokens: 6_000,
      truncation_max_output_tokens: 8_000,
      timeout_ms: timeoutMs,
    },
    attempts: [],
    hashes: emptyHashes(),
    validation: emptyValidation(),
    candidate: null,
    error: null,
  };
}

function modelPayloadHash(attempts) {
  return attempts.length > 0
    ? hashCanonicalJson(attempts.map((attempt) => attempt.request_payload_hash))
    : null;
}

function output(stream, value) {
  stream?.write?.(`${JSON.stringify(value)}\n`);
}

async function persistAndReport({
  record,
  runsDirectory,
  writeRecordImpl,
  stdout,
  stderr,
}) {
  try {
    const written = await writeRecordImpl(record, { runsDirectory });
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

    const exitCode = EXIT_CODES[record.error.code];
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
  } catch (error) {
    const controlled = safeError(
      error instanceof Phase1RunRecordWriteError || error?.code === "record_write_failed"
        ? "record_write_failed"
        : "record_write_failed",
    );
    output(stderr, {
      error: { code: controlled.code },
      run_id: record.run_id,
      record_path: null,
      exit_code: EXIT_CODES.record_write_failed,
    });
    return {
      exitCode: EXIT_CODES.record_write_failed,
      record: {
        ...record,
        status: "failed",
        attempt_budget_exhausted: record.attempts.length === PHASE1_MAX_PROVIDER_ATTEMPTS,
        hashes: { ...record.hashes, delivered_output_hash: null },
        candidate: null,
        error: controlled,
      },
      recordPath: null,
      staleTempFiles: [],
    };
  }
}

export async function runPhase1({
  executionMode,
  argv,
  modelClient = null,
  runId = randomUUID(),
  timeoutMs = 90_000,
  runsDirectory,
  readFileImpl,
  writeRecordImpl = writePhase1RunRecord,
  analyzeImpl = analyzePhase1Candidate,
  clock = () => new Date(),
  sleepImpl,
  stdout = process.stdout,
  stderr = process.stderr,
  preflightError = null,
} = {}) {
  if (executionMode !== "mock" && executionMode !== "deepseek") {
    throw new TypeError("executionMode must be fixed by a Phase 1 entry point");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 3_000 || timeoutMs > 120_000) {
    throw new TypeError("timeoutMs must be between 3000 and 120000");
  }

  const startedAt = isoNow(clock);
  const record = terminalRecordBase({
    executionMode,
    runId,
    startedAt,
    modelClient,
    timeoutMs,
  });

  let fixture;
  try {
    const parsed = parsePhase1Cli(argv);
    if (preflightError) {
      const code = safeCode(preflightError.code);
      record.error = safeError(code);
      record.finished_at = isoNow(clock);
      return await persistAndReport({
        record,
        runsDirectory,
        writeRecordImpl,
        stdout,
        stderr,
      });
    }

    fixture = await loadDevelopmentFixture({
      caseId: parsed.caseId,
      ...(readFileImpl ? { readFileImpl } : {}),
    });
    record.hashes.fixture_input_hash = hashCanonicalJson(fixture.fixtureInput);

    const analysis = await analyzeImpl({
      executionMode,
      modelClient,
      modelInput: fixture.modelInput,
      schema: NOTIFICATION_ANALYSIS_CANDIDATE_P1_SCHEMA,
      instructions: NOTIFICATION_ANALYSIS_PROMPT_P1,
      clock,
      ...(sleepImpl ? { sleepImpl } : {}),
    });

    record.status = "succeeded";
    record.finished_at = isoNow(clock);
    record.attempts = analysis.attempts;
    record.attempt_budget_exhausted = false;
    record.hashes.model_payload_hash = modelPayloadHash(analysis.attempts);
    record.hashes.candidate_hash = analysis.candidateHash;
    record.hashes.delivered_output_hash = hashCanonicalJson(analysis.candidate);
    record.validation = analysis.validation;
    record.candidate = analysis.candidate;
    record.error = null;
  } catch (error) {
    let code = "internal_error";
    if (error instanceof Phase1CliError) {
      code = error.code;
    } else if (error instanceof DevelopmentFixtureError) {
      code = error.code;
    } else if (error instanceof Phase1ModelAdapterError) {
      code = error.code;
      record.attempts = error.attempts;
      record.attempt_budget_exhausted = error.attemptBudgetExhausted;
      record.validation = error.validation;
      record.hashes.candidate_hash = error.candidateHash;
    }
    code = safeCode(code);
    record.status = "failed";
    record.finished_at = isoNow(clock);
    record.hashes.model_payload_hash = modelPayloadHash(record.attempts);
    record.hashes.delivered_output_hash = null;
    record.candidate = null;
    record.error = safeError(code);
  }

  return await persistAndReport({
    record,
    runsDirectory,
    writeRecordImpl,
    stdout,
    stderr,
  });
}

export const PHASE1_EXIT_CODES = EXIT_CODES;
