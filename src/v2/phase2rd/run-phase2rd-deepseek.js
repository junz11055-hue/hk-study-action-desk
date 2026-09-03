import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { DeepSeekResponsesClient } from "../../agent/deepseek-responses-client.js";
import { hashCanonicalJson } from "../validation/canonical-json.js";
import {
  capturePhase2rdCandidates,
  createPhase2rdFailedBatchTerminal,
  loadPhase2rdRequestDescriptors,
} from "./phase2rd-candidate-capture.js";
import {
  createPhase2rdAuthorizationMarker,
  writePhase2rdBatchTerminal,
} from "./phase2rd-capture-store.js";
import { loadPhase2rdDeepSeekConfig } from "./phase2rd-deepseek-config.js";
import { inspectFrozenPhase2rdImplementation } from "./phase2rd-git-preflight.js";
import {
  PHASE2RD_AUTHORIZATION_ID,
  PHASE2RD_AUTHORIZATION_VERSION,
  PHASE2RD_BASE_SNAPSHOT_FILE_HASH,
  PHASE2RD_BASE_SNAPSHOT_HASH,
  PHASE2RD_BASE_URL,
  PHASE2RD_CANDIDATE_SCHEMA_VERSION,
  PHASE2RD_CASE_IDS,
  PHASE2RD_CASE_SET_HASH,
  PHASE2RD_CLIENT_MAX_RETRIES,
  PHASE2RD_DATA_SCOPE,
  PHASE2RD_DIAGNOSTIC_VERSION,
  PHASE2RD_MAX_OUTPUT_TOKENS,
  PHASE2RD_MAX_REQUESTS,
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

const EXIT_CODES = Object.freeze({
  invalid_cli_input: 2,
  implementation_not_frozen: 3,
  phase2rd_input_set_invalid: 3,
  phase2rd_authorization_already_consumed: 3,
  phase2rd_authorization_marker_failed: 3,
  model_configuration_invalid: 3,
  phase2rd_systemic_request_failure: 4,
  phase2rd_capture_incomplete: 5,
  phase2rd_capture_failed: 6,
});

function isoNow(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("clock must return a date");
  return date.toISOString();
}
function output(stream, value) {
  stream?.write?.(`${JSON.stringify(value)}\n`);
}

function safeCode(error) {
  return Object.hasOwn(EXIT_CODES, error?.code)
    ? error.code
    : "phase2rd_capture_failed";
}

async function persistFailedBatch({
  marker,
  code,
  clock,
  runtimeDirectory,
  writeBatchTerminalImpl,
  snapshot = null,
}) {
  const terminal =
    snapshot ??
    createPhase2rdFailedBatchTerminal({
      runId: marker.run_id,
      implementationCommitSha: marker.implementation_commit_sha,
      errorCode: code,
      clock,
    });
  return await writeBatchTerminalImpl(terminal, { runtimeDirectory });
}

export function parsePhase2rdCli(argv) {
  if (!Array.isArray(argv) || argv.length !== 0) {
    const error = new Error("Phase 2R-D capture accepts no CLI arguments.");
    error.code = "invalid_cli_input";
    throw error;
  }
  return Object.freeze({});
}

export async function main(argv = process.argv.slice(2), options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const clock = options.clock ?? (() => new Date());
  const runId = options.runId ?? randomUUID();
  const runtimeDirectory = options.runtimeDirectory;

  try {
    parsePhase2rdCli(argv);
  } catch (error) {
    output(stderr, { error: { code: error.code }, exit_code: 2 });
    return { exitCode: 2, runId: null };
  }

  let implementation;
  try {
    implementation = await (
      options.implementationInspector ?? inspectFrozenPhase2rdImplementation
    )();
  } catch {
    output(stderr, {
      error: { code: "implementation_not_frozen" },
      run_id: runId,
      exit_code: EXIT_CODES.implementation_not_frozen,
    });
    return { exitCode: EXIT_CODES.implementation_not_frozen, runId };
  }

  let requestDescriptors;
  try {
    requestDescriptors = await (
      options.loadRequestDescriptorsImpl ?? loadPhase2rdRequestDescriptors
    )();
    if (
      !Array.isArray(requestDescriptors) ||
      requestDescriptors.length !== PHASE2RD_MAX_REQUESTS
    ) {
      const error = new Error("request descriptor set is invalid");
      error.code = "phase2rd_input_set_invalid";
      throw error;
    }
  } catch {
    output(stderr, {
      error: { code: "phase2rd_input_set_invalid" },
      run_id: runId,
      exit_code: EXIT_CODES.phase2rd_input_set_invalid,
    });
    return { exitCode: EXIT_CODES.phase2rd_input_set_invalid, runId };
  }

  let markerWrite;
  try {
    markerWrite = await (
      options.createAuthorizationMarkerImpl ?? createPhase2rdAuthorizationMarker
    )(
      {
        authorization_version: PHASE2RD_AUTHORIZATION_VERSION,
        authorization_id: PHASE2RD_AUTHORIZATION_ID,
        status: "consumed",
        run_id: runId,
        consumed_at: isoNow(clock),
        implementation_commit_sha: implementation.commitSha,
        case_ids: [...PHASE2RD_CASE_IDS],
        case_set_hash: PHASE2RD_CASE_SET_HASH,
        provider: PHASE2RD_PROVIDER,
        model: PHASE2RD_MODEL,
        prompt_version: PHASE2RD_PROMPT_VERSION,
        prompt_hash: PHASE2RD_PROMPT_HASH,
        candidate_schema_version: PHASE2RD_CANDIDATE_SCHEMA_VERSION,
        schema_hash: PHASE2RD_SCHEMA_HASH,
        diagnostic_version: PHASE2RD_DIAGNOSTIC_VERSION,
        base_snapshot_hash: PHASE2RD_BASE_SNAPSHOT_HASH,
        base_snapshot_file_hash: PHASE2RD_BASE_SNAPSHOT_FILE_HASH,
        model_input_set_hash: PHASE2RD_MODEL_INPUT_SET_HASH,
        source_context_snapshot_hash: PHASE2RD_SOURCE_CONTEXT_SNAPSHOT_HASH,
        source_context_file_hash: PHASE2RD_SOURCE_CONTEXT_FILE_HASH,
        request_descriptors: requestDescriptors.map((item) => ({ ...item })),
        request_descriptor_set_hash: hashCanonicalJson(requestDescriptors),
        max_requests: PHASE2RD_MAX_REQUESTS,
        requests_per_case: PHASE2RD_REQUESTS_PER_CASE,
        serial: PHASE2RD_SERIAL,
        retries: PHASE2RD_RETRIES,
        max_output_tokens: PHASE2RD_MAX_OUTPUT_TOKENS,
        timeout_ms: PHASE2RD_TIMEOUT_MS,
        data_scope: PHASE2RD_DATA_SCOPE,
      },
      { runtimeDirectory },
    );
  } catch (error) {
    const code = safeCode(error);
    output(stderr, { error: { code }, run_id: runId, exit_code: EXIT_CODES[code] });
    return { exitCode: EXIT_CODES[code], runId };
  }

  let config;
  try {
    config = await (options.configLoader ?? loadPhase2rdDeepSeekConfig)();
    const revalidated = await (
      options.implementationInspector ?? inspectFrozenPhase2rdImplementation
    )();
    if (
      revalidated.gitClean !== true ||
      revalidated.commitSha !== implementation.commitSha
    ) {
      const error = new Error("implementation changed");
      error.code = "implementation_not_frozen";
      throw error;
    }
    implementation = revalidated;
  } catch (error) {
    const code =
      error?.code === "implementation_not_frozen"
        ? "implementation_not_frozen"
        : "model_configuration_invalid";
    let batchTerminal;
    try {
      batchTerminal = await persistFailedBatch({
        marker: markerWrite.snapshot,
        code,
        clock,
        runtimeDirectory,
        writeBatchTerminalImpl:
          options.writeBatchTerminalImpl ?? writePhase2rdBatchTerminal,
      });
    } catch {
      const terminalCode = "phase2rd_capture_failed";
      output(stderr, {
        error: { code: terminalCode },
        run_id: runId,
        exit_code: EXIT_CODES[terminalCode],
      });
      return {
        exitCode: EXIT_CODES[terminalCode],
        runId,
        authorizationPath: markerWrite.path,
      };
    }
    output(stderr, { error: { code }, run_id: runId, exit_code: EXIT_CODES[code] });
    return {
      exitCode: EXIT_CODES[code],
      runId,
      authorizationPath: markerWrite.path,
      batchTerminalPath: batchTerminal.path,
    };
  }

  const modelClient = (
    options.modelClientFactory ??
    ((values) => new DeepSeekResponsesClient(values))
  )({
    apiKey: config.apiKey,
    model: PHASE2RD_MODEL,
    baseUrl: PHASE2RD_BASE_URL,
    timeoutMs: PHASE2RD_TIMEOUT_MS,
    maxRetries: PHASE2RD_CLIENT_MAX_RETRIES,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    clock,
  });

  try {
    const result = await (options.captureImpl ?? capturePhase2rdCandidates)({
      runId,
      implementationCommitSha: implementation.commitSha,
      modelClient,
      runtimeDirectory,
      clock,
      writeBatchTerminalImpl:
        options.writeBatchTerminalImpl ?? writePhase2rdBatchTerminal,
      beforeCasePreflight: async () => {
        const inspected = await (
          options.implementationInspector ?? inspectFrozenPhase2rdImplementation
        )();
        return {
          gitClean: inspected.gitClean,
          commitSha: inspected.commitSha,
        };
      },
      onProgress: (progress) => {
        if (
          Number.isInteger(progress?.completed) &&
          Number.isInteger(progress?.planned) &&
          PHASE2RD_CASE_IDS.includes(progress?.case_id) &&
          ["candidate_valid", "candidate_invalid", "request_failed"].includes(
            progress?.status,
          )
        ) {
          output(stdout, {
            phase: "phase2rd_capture",
            completed: progress.completed,
            planned: progress.planned,
            case_id: progress.case_id,
            status: progress.status,
          });
        }
      },
    });
    output(stdout, {
      status: "captured",
      run_id: runId,
      capture_index_path: result.captureIndexPath,
    });
    return {
      exitCode: 0,
      runId,
      authorizationPath: markerWrite.path,
      ...result,
    };
  } catch (error) {
    const code = safeCode(error);
    let batchTerminalPath = error?.batchTerminalPath ?? null;
    if (error?.batchTerminalWritten !== true) {
      try {
        const batchTerminal = await persistFailedBatch({
          marker: markerWrite.snapshot,
          code,
          clock,
          runtimeDirectory,
          writeBatchTerminalImpl:
            options.writeBatchTerminalImpl ?? writePhase2rdBatchTerminal,
          snapshot: error?.batchTerminalSnapshot ?? null,
        });
        batchTerminalPath = batchTerminal.path;
      } catch (writeError) {
        if (writeError?.code !== "phase2rd_batch_terminal_already_exists") {
          const terminalCode = "phase2rd_capture_failed";
          output(stderr, {
            error: { code: terminalCode },
            run_id: runId,
            exit_code: EXIT_CODES[terminalCode],
          });
          return {
            exitCode: EXIT_CODES[terminalCode],
            runId,
            authorizationPath: markerWrite.path,
          };
        }
      }
    }
    output(stderr, { error: { code }, run_id: runId, exit_code: EXIT_CODES[code] });
    return {
      exitCode: EXIT_CODES[code],
      runId,
      authorizationPath: markerWrite.path,
      batchTerminalPath,
    };
  }
}

const isDirectInvocation =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) {
  const result = await main();
  process.exitCode = result.exitCode;
}
