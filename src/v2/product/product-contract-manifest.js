import { ACTIVE_AI_OUTPUT_CONTRACT } from "../contracts/ai-output-contract-manifest.js";
import { hashCanonicalJson } from "../validation/canonical-json.js";
import {
  ACTION_CARD_V02_CONTRACT_HASH,
  ACTION_CARD_V02_MANIFEST,
} from "./action-card-v02.js";
import {
  PHASE2AO_HARNESS_POLICY_VERSION,
  PHASE2AO_REQUEST_CONTRACT_HASH,
  PHASE2AO_TASK_CONTRACT_HASH,
} from "./contracts.js";
import {
  DEV001_CAPTURED_REPLAY_CANDIDATE_HASH,
} from "./fixtures/offline-candidates.js";
import { DEV001_SYNTHETIC_MOCK_CANDIDATE_HASH } from "./offline-analyzers.js";
import {
  PHASE2R_CORE_PROMPT_VERSION,
} from "../prompts/notification-analysis-core-p2-v1.js";
import { resolveCorePromptContract } from "../prompts/core-prompt-registry.js";
import {
  PHASE2AO_MODEL_INPUT_HASH,
  PHASE2AO_PRODUCT_INPUT_FILE_HASH,
  PHASE2AO_PRODUCT_INPUT_HASH,
  PHASE2AO_PRODUCT_INPUT_VERSION,
} from "./product-input-loader.js";

export const PHASE2AO_HARNESS_POLICY_DESCRIPTOR = Object.freeze({
  version: PHASE2AO_HARNESS_POLICY_VERSION,
  candidateOwnership: "model_content_only",
  trustedOwnership: Object.freeze([
    "notification_identity",
    "native_importance",
    "source_trust",
    "action_channel_trust",
    "profile_validity",
    "date_normalization",
    "home_section",
    "relation_and_lifecycle",
    "capabilities",
    "provenance",
  ]),
  calendarWrite: "always_blocked",
  timezone: "Asia/Hong_Kong",
  allowedCaseIds: Object.freeze(["DEV001"]),
});

const PHASE2AO_PROMPT_CONTRACT = resolveCorePromptContract(
  PHASE2R_CORE_PROMPT_VERSION,
);

export const PHASE2AO_HARNESS_POLICY_HASH =
  "sha256:5dc1bbb8099f6b58bccf984678877f6d20703341b5b0a4e224ed501d30cbca50";
if (
  hashCanonicalJson(PHASE2AO_HARNESS_POLICY_DESCRIPTOR) !==
  PHASE2AO_HARNESS_POLICY_HASH
) {
  throw new TypeError("Phase 2A-O Harness policy drifted");
}

export const PHASE2AO_CONTRACT_BUNDLE_DESCRIPTOR = Object.freeze({
  bundleVersion: "phase2ao-contract-bundle-v1",
  productInputVersion: PHASE2AO_PRODUCT_INPUT_VERSION,
  productInputHash: PHASE2AO_PRODUCT_INPUT_HASH,
  productInputFileHash: PHASE2AO_PRODUCT_INPUT_FILE_HASH,
  modelInputHash: PHASE2AO_MODEL_INPUT_HASH,
  candidateSchemaVersion: ACTIVE_AI_OUTPUT_CONTRACT.schema_version,
  candidateSchemaHash: ACTIVE_AI_OUTPUT_CONTRACT.canonical_schema_hash,
  promptVersion: PHASE2AO_PROMPT_CONTRACT.version,
  promptHash: PHASE2AO_PROMPT_CONTRACT.prompt_hash,
  mockCandidateHash: DEV001_SYNTHETIC_MOCK_CANDIDATE_HASH,
  replayCandidateHash: DEV001_CAPTURED_REPLAY_CANDIDATE_HASH,
  harnessPolicyVersion: PHASE2AO_HARNESS_POLICY_VERSION,
  harnessPolicyHash: PHASE2AO_HARNESS_POLICY_HASH,
  actionCardVersion: ACTION_CARD_V02_MANIFEST.contract_version,
  actionCardContractHash: ACTION_CARD_V02_CONTRACT_HASH,
  requestContractHash: PHASE2AO_REQUEST_CONTRACT_HASH,
  taskContractHash: PHASE2AO_TASK_CONTRACT_HASH,
});

export const PHASE2AO_CONTRACT_BUNDLE_HASH =
  "sha256:0d026f8b2d69b5a744645aef8040aac1e0c42af40175cf31d140b3cc86a46ede";
if (
  hashCanonicalJson(PHASE2AO_CONTRACT_BUNDLE_DESCRIPTOR) !==
  PHASE2AO_CONTRACT_BUNDLE_HASH
) {
  throw new TypeError("Phase 2A-O contract bundle drifted");
}

export const PHASE2AO_PRODUCT_CONTRACT_MANIFEST = Object.freeze({
  status: "active",
  manifest_version: "phase2ao-product-contract-manifest-v1",
  bundle: PHASE2AO_CONTRACT_BUNDLE_DESCRIPTOR,
  bundle_hash: PHASE2AO_CONTRACT_BUNDLE_HASH,
});
