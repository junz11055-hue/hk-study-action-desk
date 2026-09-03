import {
  analyzePhase1CoreCandidate,
  Phase1CoreModelAdapterError,
} from "./phase1-core-model-adapter.js";
import {
  derivePhase2rCoreValidationEvidence,
  validatePhase2rCoreCandidate,
} from "../phase2r/phase2r-core-candidate-validator.js";
import { loadPhase2rDevelopmentInput } from "../phase2r/phase2r-development-input-loader.js";
import {
  PHASE2R_MAX_MODEL_INPUT_UTF8_BYTES,
  validatePhase2rModelInput,
} from "../phase2r/phase2r-model-input-validator.js";
import {
  buildPhase2rcRequestDescriptor,
  PHASE2RC_MAX_OUTPUT_TOKENS,
  PHASE2RC_MAX_REQUEST_UTF8_BYTES,
} from "../phase2rc/phase2rc-request-contract.js";
import {
  PHASE2RC_CORE_PROMPT_VERSION,
} from "../prompts/notification-analysis-core-p2-v2.js";
import {
  PHASE2RD_BASE_URL,
  PHASE2RD_CLIENT_MAX_RETRIES,
  PHASE2RD_MODEL,
  PHASE2RD_TIMEOUT_MS,
} from "../phase2rd/phase2rd-spec-contract.js";

function assertModelClientContract(executionMode, modelClient) {
  if (
    executionMode !== "deepseek" ||
    modelClient?.provider !== "deepseek" ||
    modelClient?.configured !== true ||
    modelClient?.model !== PHASE2RD_MODEL ||
    modelClient?.baseUrl !== PHASE2RD_BASE_URL ||
    modelClient?.timeoutMs !== PHASE2RD_TIMEOUT_MS ||
    modelClient?.maxRetries !== PHASE2RD_CLIENT_MAX_RETRIES
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

/** Phase 2R-D live adapter: p2-v2 request, one attempt, structural validation. */
export async function analyzePhase2rdCoreCandidate({
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
  const descriptor = buildPhase2rcRequestDescriptor(
    developmentInput.modelInput,
    { model: modelClient.model },
  );
  try {
    const result = await analyzePhase1CoreCandidate({
      executionMode,
      modelClient,
      modelInput: developmentInput.modelInput,
      promptVersion: PHASE2RC_CORE_PROMPT_VERSION,
      validateModelInput: validatePhase2rModelInput,
      validateCandidate: validatePhase2rCoreCandidate,
      deriveValidationEvidence: derivePhase2rCoreValidationEvidence,
      maxModelInputUtf8Bytes: PHASE2R_MAX_MODEL_INPUT_UTF8_BYTES,
      maxRequestUtf8Bytes: PHASE2RC_MAX_REQUEST_UTF8_BYTES,
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

export {
  buildPhase2rcRequestDescriptor as buildPhase2rdRequestDescriptor,
  PHASE2RC_MAX_OUTPUT_TOKENS as PHASE2RD_MAX_OUTPUT_TOKENS,
  PHASE2RC_MAX_REQUEST_UTF8_BYTES as PHASE2RD_MAX_REQUEST_UTF8_BYTES,
};
