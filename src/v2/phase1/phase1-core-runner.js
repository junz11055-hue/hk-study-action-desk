import { randomUUID } from "node:crypto";

import {
  CORE_CANDIDATE_SCHEMA_DIALECT,
  CORE_CANDIDATE_SCHEMA_VERSION,
  NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
} from "../contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import {
  PHASE1_CORE_RUN_RECORD_SCHEMA_VERSION,
  PHASE1_CORE_SAFE_ERROR_MESSAGES,
} from "../contracts/phase1-core-run-record-v2.schema.js";
import {
  CORE_ALLOWED_CASE_ID,
  CORE_DATASET_SPLIT,
  CoreDevelopmentFixtureError,
  loadDevelopmentCoreFixture,
} from "../fixtures/development-core-fixture-loader.js";
import {
  analyzePhase1CoreCandidate,
  CoreContentPayloadGuard,
  PHASE1_CORE_MAX_OUTPUT_TOKENS,
  PHASE1_CORE_MAX_PROVIDER_ATTEMPTS,
  Phase1CoreModelAdapterError,
} from "../model/phase1-core-model-adapter.js";
import {
  CORE_PROMPT_VERSION,
  NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2,
} from "../prompts/notification-analysis-core-p1-v2.js";
import { hashCanonicalJson, hashUtf8 } from "../validation/canonical-json.js";
import { loadPhase1CoreContentFailureHashes } from "./core-content-payload-history.js";
import {
  Phase1CoreRunRecordWriteError,
  writePhase1CoreRunRecord,
} from "./core-run-record-writer.js";

export const PHASE1_CORE_TIMEOUT_MS = 90_000;
export const PHASE1_CORE_DEEPSEEK_MODEL = "deepseek-v4-flash";
export const PHASE1_CORE_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

const GIT_COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const PREFLIGHT_ERROR_CODES = new Set([
  "smoke_lock_unavailable",
  "implementation_not_frozen",
  "model_configuration_invalid",
]);

const EXIT_CODES = Object.freeze({
  invalid_cli_input: 2,
  fixture_not_allowed: 2,
  fixture_invalid: 2,
  model_not_configured: 3,
  model_auth_failed: 3,
  model_timeout: 4,
  model_rate_limited: 4,
  model_transport_failed: 4,
  model_refused: 4,
  model_response_invalid: 5,
  candidate_schema_invalid: 5,
  candidate_reference_invalid: 5,
  candidate_evidence_invalid: 5,
  candidate_language_invalid: 5,
  candidate_forbidden_field: 5,
  duplicate_payload_blocked: 5,
  smoke_lock_unavailable: 3,
  implementation_not_frozen: 3,
  model_configuration_invalid: 3,
  record_write_failed: 6,
  internal_error: 7,
});

const SAFE_MESSAGES = PHASE1_CORE_SAFE_ERROR_MESSAGES;

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

function createMonotonicClock(clock) {
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

function terminalFinishedAt(record, clock) {
  const observed = isoNow(clock);
  const attemptFinishedAt = record.attempts.at(-1)?.finished_at ?? record.started_at;
  const lowerBound = Math.max(
    Date.parse(record.started_at),
    Date.parse(attemptFinishedAt),
  );
  return Date.parse(observed) >= lowerBound
    ? observed
    : new Date(lowerBound).toISOString();
}

function emptyValidation() {
  return {
    schema_valid: false,
    references_closed: false,
    quote_unique: false,
    profile_refs_allowed: false,
    forbidden_fields_absent: false,
    candidate_unchanged: false,
  };
}

function emptyValidationEvidence() {
  return { evidence_locators: [], profile_refs: [] };
}

function emptyHashes() {
  return {
    fixture_input_hash: null,
    model_input_hash: null,
    prompt_hash: hashUtf8(NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2),
    schema_hash: hashCanonicalJson(
      NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
    ),
    model_payload_hash: null,
    candidate_hash: null,
    delivered_output_hash: null,
    blocked_payload_hash: null,
  };
}

export class Phase1CoreCliError extends Error {
  constructor() {
    super(SAFE_MESSAGES.invalid_cli_input);
    this.name = "Phase1CoreCliError";
    this.code = "invalid_cli_input";
  }
}

export function parsePhase1CoreCli(argv) {
  if (
    !Array.isArray(argv) ||
    argv.length !== 2 ||
    argv[0] !== "--case" ||
    argv[1] !== CORE_ALLOWED_CASE_ID
  ) {
    throw new Phase1CoreCliError();
  }
  return Object.freeze({ caseId: CORE_ALLOWED_CASE_ID });
}

function terminalRecordBase({
  executionMode,
  runId,
  startedAt,
  modelClient,
  implementationCommitSha,
  implementationGitClean,
}) {
  const fixedDeepSeekModel =
    executionMode === "deepseek" &&
    modelClient?.model === PHASE1_CORE_DEEPSEEK_MODEL
      ? PHASE1_CORE_DEEPSEEK_MODEL
      : null;
  const fixedProviderEndpoint =
    executionMode === "deepseek" &&
    modelClient?.baseUrl === PHASE1_CORE_DEEPSEEK_BASE_URL
      ? PHASE1_CORE_DEEPSEEK_BASE_URL
      : null;
  return {
    record_schema_version: PHASE1_CORE_RUN_RECORD_SCHEMA_VERSION,
    run_id: runId,
    case_id: CORE_ALLOWED_CASE_ID,
    dataset_split: CORE_DATASET_SPLIT,
    execution_mode: executionMode,
    status: "failed",
    started_at: startedAt,
    finished_at: startedAt,
    provider: executionMode,
    model: fixedDeepSeekModel,
    provider_endpoint: fixedProviderEndpoint,
    implementation_commit_sha:
      executionMode === "deepseek" &&
      GIT_COMMIT_PATTERN.test(implementationCommitSha ?? "")
        ? implementationCommitSha
        : null,
    implementation_git_clean:
      executionMode === "deepseek" && implementationGitClean === true
        ? true
        : executionMode === "deepseek" && implementationGitClean === false
          ? false
          : null,
    prompt_version: CORE_PROMPT_VERSION,
    candidate_schema_version: CORE_CANDIDATE_SCHEMA_VERSION,
    schema_dialect: CORE_CANDIDATE_SCHEMA_DIALECT,
    attempt_budget_exhausted: false,
    decoding: {
      max_attempts: PHASE1_CORE_MAX_PROVIDER_ATTEMPTS,
      max_output_tokens: PHASE1_CORE_MAX_OUTPUT_TOKENS,
      timeout_ms: PHASE1_CORE_TIMEOUT_MS,
    },
    attempts: [],
    hashes: emptyHashes(),
    validation: emptyValidation(),
    validation_evidence: emptyValidationEvidence(),
    candidate: null,
    error: null,
  };
}

function output(stream, value) {
  stream?.write?.(`${JSON.stringify(value)}\n`);
}

function trustedValidationEvidence(analysisEvidence, fixture) {
  const trusted = new Map(
    (fixture.trustedProfileEvidence ?? []).map((item) => [
      item.profile_field_id,
      item,
    ]),
  );
  const profileRefs = analysisEvidence.profile_ref_matches.map((match) => {
    const resolved = trusted.get(match.profile_field_id);
    if (!resolved) {
      throw new Error("validated profile reference lacks trusted metadata");
    }
    return {
      profile_field_id: resolved.profile_field_id,
      source: resolved.source,
      confirmation_status: resolved.confirmation_status,
      valid_until: resolved.valid_until,
      course_status: resolved.course_status,
    };
  });
  return {
    evidence_locators: analysisEvidence.body_evidence_locations.map((item) => ({
      evidence_id: item.evidence_id,
      kind: item.locator.kind,
      start: item.locator.start,
      end: item.locator.end,
    })),
    profile_refs: profileRefs,
  };
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
      error instanceof Phase1CoreRunRecordWriteError ||
        error?.code === "record_write_failed"
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
      record: null,
      attemptedRecord: record,
      persistenceError: controlled,
      recordPath: null,
      staleTempFiles: [],
    };
  }
}

export async function runPhase1Core({
  executionMode,
  argv,
  modelClient = null,
  runId = randomUUID(),
  runsDirectory,
  readFileImpl,
  writeRecordImpl = writePhase1CoreRunRecord,
  analyzeImpl = analyzePhase1CoreCandidate,
  payloadGuard,
  loadContentFailureHashesImpl = loadPhase1CoreContentFailureHashes,
  implementationCommitSha = null,
  implementationGitClean = null,
  preflightError = null,
  clock = () => new Date(),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  if (executionMode !== "mock" && executionMode !== "deepseek") {
    throw new TypeError("executionMode must be fixed by a Core v2 entry point");
  }

  const executionClock = createMonotonicClock(clock);
  const startedAt = isoNow(executionClock);
  const record = terminalRecordBase({
    executionMode,
    runId,
    startedAt,
    modelClient,
    implementationCommitSha,
    implementationGitClean,
  });
  let analysisReturned = false;

  try {
    const parsed = parsePhase1CoreCli(argv);
    if (preflightError) {
      const code = PREFLIGHT_ERROR_CODES.has(preflightError.code)
        ? preflightError.code
        : "internal_error";
      record.finished_at = terminalFinishedAt(record, executionClock);
      record.error = safeError(code);
      return await persistAndReport({
        record,
        runsDirectory,
        writeRecordImpl,
        stdout,
        stderr,
      });
    }
    if (executionMode === "deepseek") {
      if (
        !GIT_COMMIT_PATTERN.test(implementationCommitSha ?? "") ||
        implementationGitClean !== true
      ) {
        const error = new Error(SAFE_MESSAGES.implementation_not_frozen);
        error.code = "implementation_not_frozen";
        throw error;
      }
      if (
        modelClient?.model !== PHASE1_CORE_DEEPSEEK_MODEL ||
        modelClient?.baseUrl !== PHASE1_CORE_DEEPSEEK_BASE_URL ||
        modelClient?.timeoutMs !== PHASE1_CORE_TIMEOUT_MS ||
        modelClient?.maxRetries !== 1
      ) {
        const error = new Error(SAFE_MESSAGES.model_configuration_invalid);
        error.code = "model_configuration_invalid";
        throw error;
      }
    }
    const fixture = await loadDevelopmentCoreFixture({
      caseId: parsed.caseId,
      ...(readFileImpl ? { readFileImpl } : {}),
    });
    record.hashes.fixture_input_hash = hashCanonicalJson({
      fixture_input: fixture.fixtureInput,
      trusted_profile_evidence: fixture.trustedProfileEvidence,
    });
    record.hashes.model_input_hash = hashCanonicalJson(fixture.modelInput);

    const activePayloadGuard =
      payloadGuard ??
      new CoreContentPayloadGuard(
        await loadContentFailureHashesImpl({ runsDirectory }),
      );
    const analysis = await analyzeImpl({
      executionMode,
      modelClient,
      modelInput: fixture.modelInput,
      schema: NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
      instructions: NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2,
      clock: executionClock,
      payloadGuard: activePayloadGuard,
    });

    // Bind provider truth before any post-model Harness projection can fail.
    record.attempts = analysis.attempts;
    record.attempt_budget_exhausted = false;
    record.hashes.model_payload_hash =
      analysis.attempts[0]?.request_payload_hash ?? null;
    record.hashes.candidate_hash = analysis.candidateHash;
    record.validation = analysis.validation;
    analysisReturned = true;

    const validationEvidence = trustedValidationEvidence(
      analysis.validationEvidence,
      fixture,
    );

    record.status = "succeeded";
    record.finished_at = terminalFinishedAt(record, executionClock);
    record.hashes.delivered_output_hash = hashCanonicalJson(analysis.candidate);
    record.validation_evidence = validationEvidence;
    record.candidate = analysis.candidate;
    record.error = null;
  } catch (error) {
    let code = "internal_error";
    if (error instanceof Phase1CoreCliError) {
      code = error.code;
    } else if (error instanceof CoreDevelopmentFixtureError) {
      code = error.code;
    } else if (error instanceof Phase1CoreModelAdapterError) {
      code = error.code;
      record.attempts = error.attempts;
      record.attempt_budget_exhausted = error.attemptBudgetExhausted;
      record.validation = error.validation;
      record.hashes.candidate_hash = error.candidateHash;
      record.hashes.blocked_payload_hash = error.blockedPayloadHash ?? null;
    } else if (Object.hasOwn(EXIT_CODES, error?.code)) {
      code = error.code;
    }
    code = safeCode(code);
    if (analysisReturned && record.attempts.length === 1) {
      record.attempts = [
        {
          ...record.attempts[0],
          outcome: "harness_error",
          error_code: "internal_error",
        },
      ];
      record.validation = emptyValidation();
      code = "internal_error";
    }
    record.status = "failed";
    record.finished_at = terminalFinishedAt(record, executionClock);
    record.attempt_budget_exhausted =
      record.attempts.length === PHASE1_CORE_MAX_PROVIDER_ATTEMPTS;
    record.hashes.model_payload_hash =
      record.attempts[0]?.request_payload_hash ?? null;
    record.hashes.delivered_output_hash = null;
    record.validation_evidence = emptyValidationEvidence();
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

export const PHASE1_CORE_EXIT_CODES = EXIT_CODES;
