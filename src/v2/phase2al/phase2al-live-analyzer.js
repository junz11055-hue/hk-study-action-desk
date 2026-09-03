import { randomUUID } from "node:crypto";

import { DeepSeekResponsesClient } from "../../agent/deepseek-responses-client.js";
import {
  CORE_CANDIDATE_SCHEMA_NAME,
  NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
} from "../contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import {
  NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V1,
} from "../prompts/notification-analysis-core-p2-v1.js";
import {
  buildPhase2rRequestDescriptor,
} from "../phase2r/phase2r-request-contract.js";
import {
  canonicalJsonStringify,
  hashCanonicalJson,
} from "../validation/canonical-json.js";
import {
  createPhase2alAuthorizationMarker,
  writePhase2alCandidateCapture,
  writePhase2alProviderTerminal,
  writePhase2alRequestIntent,
  writePhase2alRunIndex,
  writePhase2alTaskTerminal,
} from "./phase2al-capture-store.js";
import { loadPhase2alDeepSeekConfig } from "./phase2al-deepseek-config.js";
import { inspectFrozenPhase2alImplementation } from "./phase2al-git-preflight.js";
import {
  PHASE2AL_AUTHORIZATION_ID,
  PHASE2AL_AUTHORIZATION_VERSION,
  PHASE2AL_BASE_URL,
  PHASE2AL_CAPTURE_FILE_VERSION,
  PHASE2AL_CASE_ID,
  PHASE2AL_CLIENT_MAX_RETRIES,
  PHASE2AL_MAX_OUTPUT_TOKENS,
  PHASE2AL_MODEL,
  PHASE2AL_MODEL_INPUT_HASH,
  PHASE2AL_PROVIDER,
  PHASE2AL_REQUEST_DESCRIPTOR,
  PHASE2AL_REQUEST_DESCRIPTOR_HASH,
  PHASE2AL_REQUEST_PAYLOAD_HASH,
  PHASE2AL_REQUEST_UTF8_BYTES,
  PHASE2AL_TIMEOUT_MS,
} from "./phase2al-run-contract.js";

const SAFE_PROVIDER_STATUSES = new Set([
  "cancelled",
  "completed",
  "failed",
  "in_progress",
  "incomplete",
  "queued",
  "refused",
]);
const SAFE_ERROR_CODES = new Set([
  "implementation_not_frozen",
  "model_auth_failed",
  "model_configuration_invalid",
  "model_not_configured",
  "model_rate_limited",
  "model_refused",
  "model_response_invalid",
  "model_timeout",
  "model_transport_failed",
  "phase2al_capture_failed",
  "phase2al_request_budget_exhausted",
]);

export class Phase2alLiveAnalyzerError extends Error {
  constructor(code, message = "The Phase 2A-L Live Analyzer failed safely.", options = {}) {
    super(message, options);
    this.name = "Phase2alLiveAnalyzerError";
    this.code = SAFE_ERROR_CODES.has(code) ? code : "phase2al_capture_failed";
  }
}

function isoNow(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("clock must return a valid date");
  return date.toISOString();
}

function safeErrorCode(error, fallback = "phase2al_capture_failed") {
  return SAFE_ERROR_CODES.has(error?.code) ? error.code : fallback;
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeHttpStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function safeProviderStatus(value) {
  return SAFE_PROVIDER_STATUSES.has(value) ? value : null;
}

function assertDescriptor(modelInput) {
  const descriptor = buildPhase2rRequestDescriptor(modelInput, {
    model: PHASE2AL_MODEL,
  });
  if (
    descriptor.model_input_hash !== PHASE2AL_MODEL_INPUT_HASH ||
    descriptor.request_payload_hash !== PHASE2AL_REQUEST_PAYLOAD_HASH ||
    descriptor.request_utf8_bytes !== PHASE2AL_REQUEST_UTF8_BYTES ||
    hashCanonicalJson({
      ...PHASE2AL_REQUEST_DESCRIPTOR,
      prompt_version: descriptor.prompt_version,
      prompt_hash: descriptor.prompt_hash,
      schema_hash: descriptor.schema_hash,
      model_input_hash: descriptor.model_input_hash,
      request_payload_hash: descriptor.request_payload_hash,
      request_utf8_bytes: descriptor.request_utf8_bytes,
    }) !== PHASE2AL_REQUEST_DESCRIPTOR_HASH
  ) {
    throw new Phase2alLiveAnalyzerError(
      "phase2al_capture_failed",
      "The frozen DEV001 request descriptor drifted.",
    );
  }
  return descriptor;
}

function assertModelClient(client) {
  if (
    client?.provider !== PHASE2AL_PROVIDER ||
    client?.configured !== true ||
    client?.model !== PHASE2AL_MODEL ||
    client?.baseUrl !== PHASE2AL_BASE_URL ||
    client?.timeoutMs !== PHASE2AL_TIMEOUT_MS ||
    client?.maxRetries !== PHASE2AL_CLIENT_MAX_RETRIES ||
    client?.logger != null ||
    typeof client?.createStructuredAttempt !== "function"
  ) {
    throw new Phase2alLiveAnalyzerError(
      "model_configuration_invalid",
      "The DeepSeek client does not match the one-shot contract.",
    );
  }
}

function assertLoadedConfig(config) {
  if (
    typeof config?.apiKey !== "string" ||
    config.apiKey.length < 1 ||
    config.apiKey.length > 4_096 ||
    /\s/u.test(config.apiKey) ||
    config.model !== PHASE2AL_MODEL ||
    config.baseUrl !== PHASE2AL_BASE_URL ||
    config.timeoutMs !== PHASE2AL_TIMEOUT_MS
  ) {
    throw new Phase2alLiveAnalyzerError(
      "model_configuration_invalid",
      "The loaded DeepSeek configuration drifted.",
    );
  }
}

function completedResponse(response) {
  const metadata = response?.metadata;
  let candidateHash;
  let requestHash;
  try {
    candidateHash = hashCanonicalJson(response?.value);
    requestHash = hashCanonicalJson(metadata?.requestBody);
  } catch (error) {
    throw new Phase2alLiveAnalyzerError(
      "model_response_invalid",
      "DeepSeek did not return canonical Candidate JSON.",
      { cause: error },
    );
  }
  if (
    requestHash !== PHASE2AL_REQUEST_PAYLOAD_HASH ||
    metadata?.providerStatus !== "completed" ||
    metadata?.incompleteReason !== null ||
    metadata?.maxOutputTokens !== PHASE2AL_MAX_OUTPUT_TOKENS ||
    safeHttpStatus(metadata?.httpStatus) === null ||
    metadata.httpStatus < 200 ||
    metadata.httpStatus > 299
  ) {
    throw new Phase2alLiveAnalyzerError(
      "model_response_invalid",
      "DeepSeek completion metadata did not match the frozen request.",
    );
  }
  return { candidateHash, metadata };
}

function providerTerminal({
  runId,
  requestIntentHash,
  status,
  transportAttempted,
  metadata = undefined,
  candidateHash = null,
  errorCode = null,
  clock,
}) {
  return {
    capture_file_version: PHASE2AL_CAPTURE_FILE_VERSION,
    kind: "provider_terminal",
    run_id: runId,
    recorded_at: isoNow(clock),
    request_intent_hash: requestIntentHash,
    status,
    transport_attempted: transportAttempted,
    attempt_count: transportAttempted ? 1 : 0,
    http_status: safeHttpStatus(metadata?.httpStatus),
    provider_status: safeProviderStatus(metadata?.providerStatus),
    duration_ms: safeCount(metadata?.durationMs),
    input_tokens: safeCount(metadata?.inputTokens),
    output_tokens: safeCount(metadata?.outputTokens),
    response_payload_hash: candidateHash,
    candidate_hash: candidateHash,
    error_code: errorCode,
  };
}

/**
 * Build a lazy Live Analyzer. Construction performs no environment or network
 * access. Its first and only analyze call consumes the durable authorization
 * before request intent, Key access, client construction, or transport.
 */
export function createPhase2alLiveAnalyzer({
  runId = randomUUID(),
  runtimeDirectory = undefined,
  clock = () => new Date(),
  implementationInspector = inspectFrozenPhase2alImplementation,
  createAuthorizationMarkerImpl = createPhase2alAuthorizationMarker,
  writeRequestIntentImpl = writePhase2alRequestIntent,
  writeProviderTerminalImpl = writePhase2alProviderTerminal,
  writeCandidateCaptureImpl = writePhase2alCandidateCapture,
  writeTaskTerminalImpl = writePhase2alTaskTerminal,
  writeRunIndexImpl = writePhase2alRunIndex,
  configLoader = loadPhase2alDeepSeekConfig,
  modelClientFactory = (config) =>
    new DeepSeekResponsesClient({
      apiKey: config.apiKey,
      model: PHASE2AL_MODEL,
      baseUrl: PHASE2AL_BASE_URL,
      timeoutMs: PHASE2AL_TIMEOUT_MS,
      maxRetries: PHASE2AL_CLIENT_MAX_RETRIES,
      logger: null,
      clock,
    }),
} = {}) {
  const storeOptions = runtimeDirectory === undefined ? {} : { runtimeDirectory };
  let callCount = 0;
  let evidence = null;

  async function persistProviderFailure(error, { attempted }) {
    if (evidence?.intent === undefined || evidence?.provider !== undefined) return;
    const code = safeErrorCode(error);
    const written = await writeProviderTerminalImpl(
      providerTerminal({
        runId,
        requestIntentHash: evidence.intent.hash,
        status: attempted ? "request_failed" : "failed_without_transport",
        transportAttempted: attempted,
        metadata: error?.attemptMetadata,
        errorCode: code,
        clock,
      }),
      storeOptions,
    );
    evidence.provider = written;
  }

  return Object.freeze({
    executionMode: "live_model",
    get callCount() {
      return callCount;
    },

    async analyze({ caseId, modelInput, taskId } = {}) {
      if (
        caseId !== PHASE2AL_CASE_ID ||
        hashCanonicalJson(modelInput) !== PHASE2AL_MODEL_INPUT_HASH ||
        typeof taskId !== "string"
      ) {
        throw new Phase2alLiveAnalyzerError(
          "phase2al_capture_failed",
          "The Live Analyzer received an unapproved Product Input.",
        );
      }
      if (callCount !== 0) {
        throw new Phase2alLiveAnalyzerError(
          "phase2al_request_budget_exhausted",
          "The one-shot Live Analyzer cannot be called twice.",
        );
      }
      callCount += 1;
      assertDescriptor(modelInput);

      let implementation;
      try {
        implementation = await implementationInspector();
      } catch (error) {
        throw new Phase2alLiveAnalyzerError(
          "implementation_not_frozen",
          "The Phase 2A-L implementation is not frozen.",
          { cause: error },
        );
      }

      const marker = await createAuthorizationMarkerImpl(
        {
          authorization_version: PHASE2AL_AUTHORIZATION_VERSION,
          authorization_id: PHASE2AL_AUTHORIZATION_ID,
          status: "consumed",
          run_id: runId,
          consumed_at: isoNow(clock),
          implementation_commit_sha: implementation.commitSha,
          approval_scope: "phase2al_dev001_one_shot_live_e2e",
          request_descriptor: { ...PHASE2AL_REQUEST_DESCRIPTOR },
          request_descriptor_hash: PHASE2AL_REQUEST_DESCRIPTOR_HASH,
        },
        storeOptions,
      );
      evidence = { marker, taskId };

      const intent = await writeRequestIntentImpl(
        {
          capture_file_version: PHASE2AL_CAPTURE_FILE_VERSION,
          kind: "request_intent",
          run_id: runId,
          created_at: isoNow(clock),
          implementation_commit_sha: implementation.commitSha,
          authorization_marker_hash: marker.hash,
          request_descriptor: { ...PHASE2AL_REQUEST_DESCRIPTOR },
          request_descriptor_hash: PHASE2AL_REQUEST_DESCRIPTOR_HASH,
        },
        storeOptions,
      );
      evidence.intent = intent;

      let config;
      try {
        config = await configLoader();
        assertLoadedConfig(config);
        const revalidated = await implementationInspector();
        if (
          revalidated.gitClean !== true ||
          revalidated.commitSha !== implementation.commitSha
        ) {
          throw new Phase2alLiveAnalyzerError("implementation_not_frozen");
        }
      } catch (error) {
        const normalized =
          error instanceof Phase2alLiveAnalyzerError
            ? error
            : new Phase2alLiveAnalyzerError(
                safeErrorCode(error, "model_configuration_invalid"),
                "DeepSeek configuration is unavailable after authorization consumption.",
                { cause: error },
              );
        await persistProviderFailure(normalized, { attempted: false });
        throw normalized;
      }

      let client;
      try {
        client = modelClientFactory(config);
        assertModelClient(client);
      } catch (error) {
        const normalized =
          error instanceof Phase2alLiveAnalyzerError
            ? error
            : new Phase2alLiveAnalyzerError("model_configuration_invalid", undefined, {
                cause: error,
              });
        await persistProviderFailure(normalized, { attempted: false });
        throw normalized;
      }

      let response;
      try {
        response = await client.createStructuredAttempt({
          instructions: NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V1,
          input: canonicalJsonStringify(modelInput),
          schema: NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
          schemaName: CORE_CANDIDATE_SCHEMA_NAME,
          maxOutputTokens: PHASE2AL_MAX_OUTPUT_TOKENS,
          attemptNumber: 1,
        });
        const completed = completedResponse(response);
        const terminal = await writeProviderTerminalImpl(
          providerTerminal({
            runId,
            requestIntentHash: intent.hash,
            status: "completed",
            transportAttempted: true,
            metadata: completed.metadata,
            candidateHash: completed.candidateHash,
            clock,
          }),
          storeOptions,
        );
        evidence.provider = terminal;
        const capture = await writeCandidateCaptureImpl(
          {
            capture_file_version: PHASE2AL_CAPTURE_FILE_VERSION,
            kind: "candidate_capture",
            run_id: runId,
            captured_at: isoNow(clock),
            provider_terminal_hash: terminal.hash,
            candidate_hash: completed.candidateHash,
            candidate: structuredClone(response.value),
          },
          storeOptions,
        );
        evidence.capture = capture;
        return Object.freeze({
          executionMode: "live_model",
          candidate: structuredClone(response.value),
          candidateCaptureHash: capture.hash,
        });
      } catch (error) {
        const normalized =
          error instanceof Phase2alLiveAnalyzerError
            ? error
            : new Phase2alLiveAnalyzerError(safeErrorCode(error), undefined, {
                cause: error,
              });
        await persistProviderFailure(
          Object.assign(normalized, {
            attemptMetadata: error?.attemptMetadata ?? normalized.attemptMetadata,
          }),
          { attempted: true },
        );
        throw normalized;
      }
    },

    async recordTaskTerminal({
      taskId,
      status,
      candidateHash = null,
      actionCardHash = null,
      errorCode = null,
    } = {}) {
      if (
        evidence === null ||
        evidence.taskId !== taskId ||
        evidence.provider === undefined ||
        evidence.task !== undefined
      ) {
        return null;
      }
      const terminal = await writeTaskTerminalImpl(
        {
          capture_file_version: PHASE2AL_CAPTURE_FILE_VERSION,
          kind: "task_terminal",
          run_id: runId,
          recorded_at: isoNow(clock),
          task_id: taskId,
          status,
          provider_terminal_hash: evidence.provider.hash,
          candidate_capture_hash: evidence.capture?.hash ?? null,
          candidate_hash: candidateHash ?? evidence.provider.snapshot.candidate_hash,
          action_card_hash: actionCardHash,
          error_code: errorCode,
        },
        storeOptions,
      );
      evidence.task = terminal;
      const index = await writeRunIndexImpl(
        {
          capture_file_version: PHASE2AL_CAPTURE_FILE_VERSION,
          kind: "run_index",
          run_id: runId,
          completed_at: isoNow(clock),
          authorization_marker_hash: evidence.marker.hash,
          request_intent_hash: evidence.intent.hash,
          provider_terminal_hash: evidence.provider.hash,
          candidate_capture_hash: evidence.capture?.hash ?? null,
          task_terminal_hash: terminal.hash,
          provider_attempt_count: evidence.provider.snapshot.attempt_count,
          final_status: status,
        },
        storeOptions,
      );
      evidence.index = index;
      return Object.freeze({ taskTerminalHash: terminal.hash, runIndexHash: index.hash });
    },
  });
}
