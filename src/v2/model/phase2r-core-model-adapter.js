import {
  analyzePhase1CoreCandidate,
  Phase1CoreModelAdapterError,
} from "./phase1-core-model-adapter.js";
import {
  NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V1,
  PHASE2R_CORE_PROMPT_VERSION,
} from "../prompts/notification-analysis-core-p2-v1.js";
import {
  derivePhase2rCoreValidationEvidence,
  validatePhase2rCoreCandidate,
} from "../phase2r/phase2r-core-candidate-validator.js";
import {
  loadPhase2rDevelopmentInput,
} from "../phase2r/phase2r-development-input-loader.js";
import {
  PHASE2R_MAX_MODEL_INPUT_UTF8_BYTES,
  validatePhase2rModelInput,
} from "../phase2r/phase2r-model-input-validator.js";
import {
  buildPhase2rRequestDescriptor,
  PHASE2R_DEEPSEEK_BASE_URL,
  PHASE2R_DEEPSEEK_MODEL,
  PHASE2R_MAX_OUTPUT_TOKENS,
  PHASE2R_MAX_REQUEST_UTF8_BYTES,
  PHASE2R_TIMEOUT_MS,
} from "../phase2r/phase2r-request-contract.js";

export {
  buildPhase2rRequestDescriptor,
  PHASE2R_DEEPSEEK_BASE_URL,
  PHASE2R_DEEPSEEK_MODEL,
  PHASE2R_MAX_OUTPUT_TOKENS,
  PHASE2R_MAX_REQUEST_UTF8_BYTES,
  PHASE2R_TIMEOUT_MS,
} from "../phase2r/phase2r-request-contract.js";

function safeModelName(model) {
  return (
    typeof model === "string" &&
    /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(model)
  );
}

function assertModelClientContract(executionMode, modelClient) {
  if (executionMode === "mock") {
    if (
      modelClient?.provider !== "mock" ||
      modelClient?.configured !== true ||
      !safeModelName(modelClient?.model)
    ) {
      throw new Phase1CoreModelAdapterError("internal_error");
    }
    return;
  }
  if (
    executionMode !== "deepseek" ||
    modelClient?.provider !== "deepseek" ||
    modelClient?.configured !== true ||
    modelClient?.model !== PHASE2R_DEEPSEEK_MODEL ||
    modelClient?.baseUrl !== PHASE2R_DEEPSEEK_BASE_URL ||
    modelClient?.timeoutMs !== PHASE2R_TIMEOUT_MS ||
    modelClient?.maxRetries !== 1
  ) {
    throw new Phase1CoreModelAdapterError("internal_error");
  }
}

function descriptorMatchesTerminal(terminal, descriptor) {
  if (
    terminal?.promptHash !== undefined &&
    (terminal.promptHash !== descriptor.prompt_hash ||
      terminal.promptVersion !== descriptor.prompt_version)
  ) {
    return false;
  }
  if (!Array.isArray(terminal?.attempts) || terminal.attempts.length !== 1) {
    return false;
  }
  return (
    terminal.attempts[0]?.request_payload_hash ===
      descriptor.request_payload_hash &&
    terminal.attempts[0]?.prompt_hash === descriptor.prompt_hash
  );
}

/** Offline tests use mock; a future separately approved smoke must pass deepseek. */
export async function analyzePhase2rCoreCandidate({
  executionMode,
  modelClient,
  caseId,
  readFileImpl,
  payloadGuard,
  clock,
}) {
  assertModelClientContract(executionMode, modelClient);
  const developmentInput = await loadPhase2rDevelopmentInput({
    caseId,
    ...(readFileImpl ? { readFileImpl } : {}),
  });
  const descriptor = buildPhase2rRequestDescriptor(developmentInput.modelInput, {
    model: modelClient.model,
  });
  try {
    const result = await analyzePhase1CoreCandidate({
      executionMode,
      modelClient,
      modelInput: developmentInput.modelInput,
      promptVersion: PHASE2R_CORE_PROMPT_VERSION,
      validateModelInput: validatePhase2rModelInput,
      validateCandidate: validatePhase2rCoreCandidate,
      deriveValidationEvidence: derivePhase2rCoreValidationEvidence,
      maxModelInputUtf8Bytes: PHASE2R_MAX_MODEL_INPUT_UTF8_BYTES,
      ...(payloadGuard ? { payloadGuard } : {}),
      ...(clock ? { clock } : {}),
    });
    if (!descriptorMatchesTerminal(result, descriptor)) {
      throw new Phase1CoreModelAdapterError("internal_error");
    }
    return result;
  } catch (error) {
    if (
      error instanceof Phase1CoreModelAdapterError &&
      descriptorMatchesTerminal(error, descriptor)
    ) {
      throw error;
    }
    throw new Phase1CoreModelAdapterError("internal_error");
  }
}
