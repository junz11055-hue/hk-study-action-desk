export const AI_OUTPUT_CONTRACT_MANIFEST_VERSION =
  "ai-output-contract-manifest-v1";

export const LEGACY_AI_OUTPUT_CONTRACT = Object.freeze({
  status: "legacy",
  schema_version: "notification-analysis-candidate-p1-v1",
  schema_name: "notification_analysis_candidate_p1_v1",
  schema_dialect: "https://json-schema.org/draft/2020-12/schema",
  canonical_schema_hash:
    "sha256:37bdc411c97cab48de9f7c63bc7974039069f75b59aba7e4172aa148851b7d0f",
});

export const ACTIVE_AI_OUTPUT_CONTRACT = Object.freeze({
  status: "active",
  schema_version: "notification-analysis-core-candidate-p1-v2",
  schema_name: "notification_analysis_core_candidate_p1_v2",
  schema_dialect: "https://json-schema.org/draft/2020-12/schema",
  canonical_schema_hash:
    "sha256:279562aba228dd9c9d9f7356a32233dfc7270c021b16910bf7b4a9007a0ffb06",
  root_fields: Object.freeze([
    "title_zh",
    "title_claim_refs",
    "summary_zh",
    "summary_claim_refs",
    "topics",
    "applicability",
    "claims",
    "evidence",
    "actions",
    "deadlines",
    "consequence",
  ]),
});

export const AI_OUTPUT_CONTRACTS = Object.freeze([
  LEGACY_AI_OUTPUT_CONTRACT,
  ACTIVE_AI_OUTPUT_CONTRACT,
]);
