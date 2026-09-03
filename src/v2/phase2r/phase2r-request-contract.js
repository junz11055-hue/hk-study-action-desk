import {
  CORE_CANDIDATE_SCHEMA_NAME,
  NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
} from "../contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import {
  NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V1,
  PHASE2R_CORE_PROMPT_VERSION,
} from "../prompts/notification-analysis-core-p2-v1.js";
import {
  canonicalJsonStringify,
  hashCanonicalJson,
  hashUtf8,
} from "../validation/canonical-json.js";
import { validatePhase2rModelInput } from "./phase2r-model-input-validator.js";

export const PHASE2R_DEEPSEEK_MODEL = "deepseek-v4-flash";
export const PHASE2R_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const PHASE2R_TIMEOUT_MS = 90_000;
export const PHASE2R_MAX_OUTPUT_TOKENS = 8_000;
export const PHASE2R_MAX_REQUEST_UTF8_BYTES = 10_000;
export const PHASE2R_PROMPT_HASH = hashUtf8(
  NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V1,
);
export const PHASE2R_SCHEMA_HASH = hashCanonicalJson(
  NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
);

function safeModelName(model) {
  return (
    typeof model === "string" &&
    /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(model)
  );
}

/** Pure request projection with no runtime I/O dependencies. */
export function buildPhase2rStructuredRequestBody(
  modelInput,
  { model = PHASE2R_DEEPSEEK_MODEL } = {},
) {
  validatePhase2rModelInput(modelInput);
  if (!safeModelName(model)) throw new TypeError("Phase 2R model is invalid");
  return {
    model,
    store: false,
    instructions: NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V1,
    input: canonicalJsonStringify(modelInput),
    text: {
      format: {
        type: "json_schema",
        name: CORE_CANDIDATE_SCHEMA_NAME,
        strict: true,
        schema: NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
      },
    },
    max_output_tokens: PHASE2R_MAX_OUTPUT_TOKENS,
  };
}

export function buildPhase2rRequestDescriptor(
  modelInput,
  { model = PHASE2R_DEEPSEEK_MODEL } = {},
) {
  const requestBody = buildPhase2rStructuredRequestBody(modelInput, { model });
  const requestUtf8Bytes = Buffer.byteLength(JSON.stringify(requestBody), "utf8");
  if (requestUtf8Bytes > PHASE2R_MAX_REQUEST_UTF8_BYTES) {
    throw new TypeError("Phase 2R request exceeds the frozen byte budget");
  }
  return Object.freeze({
    prompt_version: PHASE2R_CORE_PROMPT_VERSION,
    model_input_hash: hashCanonicalJson(modelInput),
    prompt_hash: PHASE2R_PROMPT_HASH,
    schema_hash: PHASE2R_SCHEMA_HASH,
    request_payload_hash: hashCanonicalJson(requestBody),
    request_utf8_bytes: requestUtf8Bytes,
  });
}
