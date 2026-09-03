export const PHASE2RD_SPEC_VERSION =
  "phase2rd-six-case-deepseek-smoke-spec-v0.1";
export const PHASE2RD_APPROVAL_STATE =
  "implementation_and_fixed_six_case_execution_authorized";
export const PHASE2RD_LIVE_EXECUTION_AUTHORIZED = true;

export const PHASE2RD_CASE_IDS = Object.freeze([
  "DEV001",
  "DEV005",
  "DEV006",
  "DEV007",
  "DEV008",
  "DEV010",
]);
export const PHASE2RD_REGRESSION_CASE_IDS = Object.freeze([
  "DEV001",
  "DEV006",
  "DEV008",
  "DEV010",
]);
export const PHASE2RD_OVER_REJECTION_CONTROL_CASE_IDS = Object.freeze([
  "DEV005",
  "DEV007",
]);

export const PHASE2RD_PROVIDER = "deepseek";
export const PHASE2RD_MODEL = "deepseek-v4-flash";
export const PHASE2RD_BASE_URL = "https://api.deepseek.com";
export const PHASE2RD_PROMPT_VERSION =
  "notification-analysis-core-prompt-p2-v2";
export const PHASE2RD_PROMPT_HASH =
  "sha256:78461050b2a0203bfbbf35cfcfe92d9a555e4b3c8e2ebf36452824ce8699e648";
export const PHASE2RD_SCHEMA_VERSION =
  "notification-analysis-core-candidate-p1-v2";
export const PHASE2RD_SCHEMA_HASH =
  "sha256:279562aba228dd9c9d9f7356a32233dfc7270c021b16910bf7b4a9007a0ffb06";

export const PHASE2RD_MAX_REQUESTS = 6;
export const PHASE2RD_REQUESTS_PER_CASE = 1;
export const PHASE2RD_SERIAL = true;
export const PHASE2RD_AUTOMATIC_RETRIES = 0;
export const PHASE2RD_CLIENT_MAX_RETRIES = 1;
export const PHASE2RD_MAX_OUTPUT_TOKENS_PER_CASE = 8_000;
export const PHASE2RD_MAX_TOTAL_OUTPUT_TOKENS = 48_000;
export const PHASE2RD_TIMEOUT_MS = 90_000;
export const PHASE2RD_STORE = false;
export const PHASE2RD_TOOLS_ENABLED = false;
export const PHASE2RD_EXPLICIT_SAMPLING_PARAMETERS = false;
export const PHASE2RD_RUNTIME_DIRECTORY = ".runtime/phase-2rd";

export const PHASE2RD_PASS_GATES = Object.freeze({
  technicalCandidates: Object.freeze({ passed: 6, total: 6 }),
  semanticGate: Object.freeze({ passed: 6, total: 6 }),
  automaticDimensions: Object.freeze({ exact: 36, total: 36 }),
  manualReview: Object.freeze({ resolved: 30, total: 30 }),
  maximumP0: 0,
  maximumP1PerCase: 2,
});

export const PHASE2RD_FROZEN_REQUESTS = Object.freeze([
  Object.freeze({
    case_id: "DEV001",
    model_input_hash:
      "sha256:5f7e4d9e243e95a0f11ac7736f330252d6939ff845658cd91b04e88177888b5e",
    request_payload_hash:
      "sha256:3731421715a028436f6421377b5e1d50be97b6b713bf3e20685aaaf7da17e9cd",
    request_utf8_bytes: 11_068,
  }),
  Object.freeze({
    case_id: "DEV005",
    model_input_hash:
      "sha256:b61df6023d6efd72519c69a9369a1e77a3382ce520e2e6af90309fcb936ab722",
    request_payload_hash:
      "sha256:9eae19eb69be36b414126694a718a58888f4013386a47353e04c52b35758fd64",
    request_utf8_bytes: 10_949,
  }),
  Object.freeze({
    case_id: "DEV006",
    model_input_hash:
      "sha256:de34434353a0dc6c5b7a1b0fe2ffe05ed1bbacee416bb75b225dfb9db452ea60",
    request_payload_hash:
      "sha256:d0668a4b148fe528d0eb0028a2b5cff1cedc5dd7828d2d2db0ab840092314a3c",
    request_utf8_bytes: 10_960,
  }),
  Object.freeze({
    case_id: "DEV007",
    model_input_hash:
      "sha256:4d1c8509047b64c5c12196f73b005b460782eca6f0e84de9e88555aeab832dad",
    request_payload_hash:
      "sha256:b7bdacc101ca3cf802006c9f53767dd521025e16444d03d17a0414a3b2ae5882",
    request_utf8_bytes: 11_055,
  }),
  Object.freeze({
    case_id: "DEV008",
    model_input_hash:
      "sha256:32044ff58a2eb6ddce131c90e366573b91271f1673d94a0d59f697537b03799f",
    request_payload_hash:
      "sha256:a93efbf693524ced7d4c3364dd24e6839e7ca08ebfc4c0cfca9feef18a62c8eb",
    request_utf8_bytes: 11_045,
  }),
  Object.freeze({
    case_id: "DEV010",
    model_input_hash:
      "sha256:a861e6f89ecdb970611d49b2efe97cb423a2f7e1070667cb318fd428b0855ef0",
    request_payload_hash:
      "sha256:024d6418f54b73189a5e9aa7e8d6ef0005ead3cc1715fdcd5f14c009d440c673",
    request_utf8_bytes: 11_125,
  }),
]);
