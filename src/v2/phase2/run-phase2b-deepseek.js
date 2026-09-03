import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { DeepSeekResponsesClient } from "../../agent/deepseek-responses-client.js";
import {
  CORE_CANDIDATE_SCHEMA_VERSION,
} from "../contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import {
  PHASE2B_DEEPSEEK_BASE_URL,
  PHASE2B_DEEPSEEK_MODEL,
  PHASE2B_MAX_OUTPUT_TOKENS,
  PHASE2B_TIMEOUT_MS,
} from "../model/phase2-core-model-adapter.js";
import { CORE_PROMPT_VERSION } from "../prompts/notification-analysis-core-p1-v2.js";
import { PHASE2_DEVELOPMENT_CASE_IDS } from "./development-input-loader.js";
import {
  capturePhase2bCandidates,
  createPhase2bFailedBatchTerminal,
} from "./phase2b-candidate-capture.js";
import {
  PHASE2B_AUTHORIZATION_VERSION,
  createPhase2bAuthorizationMarker,
  writePhase2bBatchTerminal,
} from "./phase2b-capture-store.js";
import { loadPhase2bDeepSeekConfig } from "./phase2b-deepseek-config.js";
import { inspectFrozenPhase2bImplementation } from "./phase2b-git-preflight.js";

const EXIT_CODES = Object.freeze({
  invalid_cli_input: 2,
  implementation_not_frozen: 3,
  phase2b_authorization_already_consumed: 3,
  phase2b_authorization_marker_failed: 3,
  model_configuration_invalid: 3,
  phase2b_systemic_request_failure: 4,
  phase2b_capture_incomplete: 5,
  phase2b_capture_failed: 6,
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
    : "phase2b_capture_failed";
}

async function persistFailedBatch({
  marker,
  code,
  clock,
  runtimeDirectory,
  writeBatchTerminalImpl,
  snapshot = null,
}) {
  const terminal = snapshot ?? createPhase2bFailedBatchTerminal({
    runId: marker.run_id,
    implementationCommitSha: marker.implementation_commit_sha,
    errorCode: code,
    clock,
  });
  return await writeBatchTerminalImpl(terminal, { runtimeDirectory });
}

export function parsePhase2bCli(argv) {
  if (!Array.isArray(argv) || argv.length !== 0) {
    const error = new Error("Phase 2B capture accepts no CLI arguments.");
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
    parsePhase2bCli(argv);
  } catch (error) {
    output(stderr, { error: { code: error.code }, exit_code: 2 });
    return { exitCode: 2, runId: null };
  }

  let implementation;
  try {
    implementation = await (
      options.implementationInspector ?? inspectFrozenPhase2bImplementation
    )();
  } catch {
    output(stderr, {
      error: { code: "implementation_not_frozen" },
      run_id: runId,
      exit_code: EXIT_CODES.implementation_not_frozen,
    });
    return { exitCode: EXIT_CODES.implementation_not_frozen, runId };
  }

  let markerWrite;
  try {
    markerWrite = await (
      options.createAuthorizationMarkerImpl ?? createPhase2bAuthorizationMarker
    )(
      {
        authorization_version: PHASE2B_AUTHORIZATION_VERSION,
        status: "consumed",
        run_id: runId,
        consumed_at: isoNow(clock),
        implementation_commit_sha: implementation.commitSha,
        case_ids: [...PHASE2_DEVELOPMENT_CASE_IDS],
        provider: "deepseek",
        model: PHASE2B_DEEPSEEK_MODEL,
        prompt_version: CORE_PROMPT_VERSION,
        candidate_schema_version: CORE_CANDIDATE_SCHEMA_VERSION,
        max_requests: 16,
        requests_per_case: 1,
        serial: true,
        retries: 0,
        max_output_tokens: PHASE2B_MAX_OUTPUT_TOKENS,
        timeout_ms: PHASE2B_TIMEOUT_MS,
        data_scope: "synthetic_development_only",
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
    config = await (options.configLoader ?? loadPhase2bDeepSeekConfig)();
    const revalidated = await (
      options.implementationInspector ?? inspectFrozenPhase2bImplementation
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
    const code = error?.code === "implementation_not_frozen"
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
          options.writeBatchTerminalImpl ?? writePhase2bBatchTerminal,
      });
    } catch {
      const terminalCode = "phase2b_capture_failed";
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

  const modelClient = (options.modelClientFactory ?? ((values) =>
    new DeepSeekResponsesClient(values)))({
    apiKey: config.apiKey,
    model: PHASE2B_DEEPSEEK_MODEL,
    baseUrl: PHASE2B_DEEPSEEK_BASE_URL,
    timeoutMs: PHASE2B_TIMEOUT_MS,
    maxRetries: 1,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    clock,
  });

  try {
    const result = await (options.captureImpl ?? capturePhase2bCandidates)({
      runId,
      implementationCommitSha: implementation.commitSha,
      modelClient,
      runtimeDirectory,
      clock,
      writeBatchTerminalImpl:
        options.writeBatchTerminalImpl ?? writePhase2bBatchTerminal,
      onProgress: (progress) => output(stdout, { phase: "phase2b_capture", ...progress }),
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
            options.writeBatchTerminalImpl ?? writePhase2bBatchTerminal,
          snapshot: error?.batchTerminalSnapshot ?? null,
        });
        batchTerminalPath = batchTerminal.path;
      } catch (writeError) {
        if (writeError?.code !== "phase2b_batch_terminal_already_exists") {
          const terminalCode = "phase2b_capture_failed";
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
