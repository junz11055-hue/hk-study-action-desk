import { buildStructuredRequestBody } from "../../agent/deepseek-responses-client.js";
import {
  CORE_CANDIDATE_SCHEMA_NAME,
  NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
} from "../contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import {
  analyzePhase1CoreCandidate,
  PHASE1_CORE_MAX_OUTPUT_TOKENS,
  PHASE1_CORE_MAX_REQUEST_UTF8_BYTES,
} from "./phase1-core-model-adapter.js";
import {
  NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2,
} from "../prompts/notification-analysis-core-p1-v2.js";
import {
  derivePhase2CoreValidationEvidence,
  validatePhase2CoreCandidate,
} from "../validation/phase2-core-candidate-validator.js";
import {
  PHASE2_MAX_MODEL_INPUT_UTF8_BYTES,
  validatePhase2ModelInput,
} from "../phase2/phase2-model-input-validator.js";
import {
  canonicalJsonStringify,
  hashCanonicalJson,
  hashUtf8,
} from "../validation/canonical-json.js";

export const PHASE2B_DEEPSEEK_MODEL = "deepseek-v4-flash";
export const PHASE2B_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const PHASE2B_TIMEOUT_MS = 90_000;
export const PHASE2B_MAX_OUTPUT_TOKENS = PHASE1_CORE_MAX_OUTPUT_TOKENS;
export const PHASE2B_MAX_REQUEST_UTF8_BYTES =
  PHASE1_CORE_MAX_REQUEST_UTF8_BYTES;

export function buildPhase2bRequestDescriptor(modelInput) {
  validatePhase2ModelInput(modelInput);
  const serializedInput = canonicalJsonStringify(modelInput);
  const requestBody = buildStructuredRequestBody({
    model: PHASE2B_DEEPSEEK_MODEL,
    instructions: NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2,
    input: serializedInput,
    schema: NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
    schemaName: CORE_CANDIDATE_SCHEMA_NAME,
    maxOutputTokens: PHASE2B_MAX_OUTPUT_TOKENS,
  });
  if (
    Buffer.byteLength(JSON.stringify(requestBody), "utf8") >
    PHASE2B_MAX_REQUEST_UTF8_BYTES
  ) {
    throw new TypeError("Phase 2B request exceeds the frozen byte budget");
  }
  return Object.freeze({
    model_input_hash: hashCanonicalJson(modelInput),
    prompt_hash: hashUtf8(NOTIFICATION_ANALYSIS_CORE_PROMPT_P1_V2),
    schema_hash: hashCanonicalJson(
      NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
    ),
    request_payload_hash: hashCanonicalJson(requestBody),
  });
}

/** One Phase 2B request. This wrapper has no retry or repair path. */
export async function analyzePhase2CoreCandidate({
  modelClient,
  modelInput,
  payloadGuard,
  clock,
}) {
  buildPhase2bRequestDescriptor(modelInput);
  return await analyzePhase1CoreCandidate({
    executionMode: "deepseek",
    modelClient,
    modelInput,
    validateModelInput: validatePhase2ModelInput,
    validateCandidate: validatePhase2CoreCandidate,
    deriveValidationEvidence: derivePhase2CoreValidationEvidence,
    maxModelInputUtf8Bytes: PHASE2_MAX_MODEL_INPUT_UTF8_BYTES,
    ...(payloadGuard ? { payloadGuard } : {}),
    ...(clock ? { clock } : {}),
  });
}
