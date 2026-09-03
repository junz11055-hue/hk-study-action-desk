import { CORE_CANDIDATE_SCHEMA_VERSION } from "../contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import { PHASE2AO_CONTRACT_BUNDLE_HASH } from "../product/product-contract-manifest.js";
import { PHASE2AO_MODEL_INPUT_HASH } from "../product/product-input-loader.js";
import {
  PHASE2R_DEEPSEEK_BASE_URL,
  PHASE2R_DEEPSEEK_MODEL,
  PHASE2R_MAX_OUTPUT_TOKENS,
  PHASE2R_PROMPT_HASH,
  PHASE2R_SCHEMA_HASH,
  PHASE2R_TIMEOUT_MS,
} from "../phase2r/phase2r-request-contract.js";
import { PHASE2R_CORE_PROMPT_VERSION } from "../prompts/notification-analysis-core-p2-v1.js";
import { hashCanonicalJson } from "../validation/canonical-json.js";

export const PHASE2AL_AUTHORIZATION_VERSION =
  "phase2al-one-shot-authorization-v1";
export const PHASE2AL_AUTHORIZATION_ID =
  "PHASE2AL_DEV001_LIVE_PRODUCT_E2E_V1";
export const PHASE2AL_CAPTURE_FILE_VERSION = "phase2al-capture-file-v1";

export const PHASE2AL_CASE_ID = "DEV001";
export const PHASE2AL_DATA_CLASS = "fully_synthetic";
export const PHASE2AL_PROVIDER = "deepseek";
export const PHASE2AL_MODEL = PHASE2R_DEEPSEEK_MODEL;
export const PHASE2AL_BASE_URL = PHASE2R_DEEPSEEK_BASE_URL;
export const PHASE2AL_PROMPT_VERSION = PHASE2R_CORE_PROMPT_VERSION;
export const PHASE2AL_PROMPT_HASH = PHASE2R_PROMPT_HASH;
export const PHASE2AL_SCHEMA_VERSION = CORE_CANDIDATE_SCHEMA_VERSION;
export const PHASE2AL_SCHEMA_HASH = PHASE2R_SCHEMA_HASH;
export const PHASE2AL_MODEL_INPUT_HASH = PHASE2AO_MODEL_INPUT_HASH;
export const PHASE2AL_REQUEST_PAYLOAD_HASH =
  "sha256:44e12abde3db8918112f0a3e2bdd2938d0ab1415ec2acd1ae6aa8691bf922240";
export const PHASE2AL_REQUEST_UTF8_BYTES = 9_424;
export const PHASE2AL_PHASE2AO_BUNDLE_HASH = PHASE2AO_CONTRACT_BUNDLE_HASH;

export const PHASE2AL_MAX_REQUESTS = 1;
export const PHASE2AL_RETRIES = 0;
export const PHASE2AL_CLIENT_MAX_RETRIES = 1;
export const PHASE2AL_MAX_OUTPUT_TOKENS = PHASE2R_MAX_OUTPUT_TOKENS;
export const PHASE2AL_TIMEOUT_MS = PHASE2R_TIMEOUT_MS;
export const PHASE2AL_TASK_TIMEOUT_MS = 95_000;

export const PHASE2AL_REQUEST_DESCRIPTOR = Object.freeze({
  case_id: PHASE2AL_CASE_ID,
  data_class: PHASE2AL_DATA_CLASS,
  provider: PHASE2AL_PROVIDER,
  model: PHASE2AL_MODEL,
  base_url: PHASE2AL_BASE_URL,
  prompt_version: PHASE2AL_PROMPT_VERSION,
  prompt_hash: PHASE2AL_PROMPT_HASH,
  candidate_schema_version: PHASE2AL_SCHEMA_VERSION,
  schema_hash: PHASE2AL_SCHEMA_HASH,
  model_input_hash: PHASE2AL_MODEL_INPUT_HASH,
  request_payload_hash: PHASE2AL_REQUEST_PAYLOAD_HASH,
  request_utf8_bytes: PHASE2AL_REQUEST_UTF8_BYTES,
  phase2ao_bundle_hash: PHASE2AL_PHASE2AO_BUNDLE_HASH,
  max_requests: PHASE2AL_MAX_REQUESTS,
  retries: PHASE2AL_RETRIES,
  max_output_tokens: PHASE2AL_MAX_OUTPUT_TOKENS,
  timeout_ms: PHASE2AL_TIMEOUT_MS,
});

export const PHASE2AL_REQUEST_DESCRIPTOR_HASH = hashCanonicalJson(
  PHASE2AL_REQUEST_DESCRIPTOR,
);
