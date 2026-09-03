import Ajv2020 from "ajv/dist/2020.js";

import {
  CORE_CANDIDATE_SCHEMA_VERSION,
  NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
} from "./notification-analysis-core-candidate-p1-v2.schema.js";
import { ACTIVE_AI_OUTPUT_CONTRACT } from "./ai-output-contract-manifest.js";
import {
  canonicalJsonStringify,
  hashCanonicalJson,
} from "../validation/canonical-json.js";

export const PHASE2_EVALUATION_RECORD_SCHEMA_VERSION =
  "phase2-evaluation-record-v1";
export const PHASE2_CASE_SET_VERSION = "phase2-development-subset-v1";
export const PHASE2_INPUT_PROJECTION_VERSION =
  "phase2-core-model-input-projection-v1";
export const PHASE2_ORACLE_VERSION = "phase2-core-overlap-oracle-v1";
export const PHASE2_EVALUATOR_VERSION =
  "phase2-core-semantic-evaluator-v1";
export const PHASE2_CANDIDATE_SCHEMA_VERSION =
  ACTIVE_AI_OUTPUT_CONTRACT.schema_version;
export const PHASE2_CANDIDATE_SCHEMA_HASH =
  ACTIVE_AI_OUTPUT_CONTRACT.canonical_schema_hash;
export const PHASE2_EVALUATION_SCHEMA_DIALECT =
  "https://json-schema.org/draft/2020-12/schema";

if (
  CORE_CANDIDATE_SCHEMA_VERSION !== PHASE2_CANDIDATE_SCHEMA_VERSION ||
  hashCanonicalJson(NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA) !==
  PHASE2_CANDIDATE_SCHEMA_HASH
) {
  throw new Error(
    "Core Candidate v2 schema changed without a new frozen interface version",
  );
}

export const PHASE2_DEVELOPMENT_CASE_IDS = Object.freeze([
  "DEV001",
  "DEV003",
  "DEV004",
  "DEV005",
  "DEV006",
  "DEV007",
  "DEV008",
  "DEV010",
  "DEV017",
  "DEV018",
  "DEV019",
  "DEV020",
  "DEV022",
  "DEV023",
  "DEV024",
  "DEV025",
]);

export const PHASE2_AUTOMATIC_DIMENSION_NAMES = Object.freeze([
  "topics",
  "applicability_value",
  "profile_field_ids",
  "actions",
  "deadlines",
  "consequence_level",
]);

export const PHASE2_REVIEW_CODES = Object.freeze([
  "title_summary",
  "claim_evidence_semantics",
  "applicability_semantics",
  "action_text_semantics",
  "consequence_reason_semantics",
]);

export const PHASE2A_SUCCESS_CLAIMS = Object.freeze({
  can_prove: Object.freeze([
    "Phase 2A completed an offline reference evaluation for all 16 frozen visible development cases.",
    "All six automatic Core-overlap dimensions matched the reference Oracle in 16 of 16 cases.",
  ]),
  cannot_prove: Object.freeze([
    "This offline reference run cannot prove real-model semantic quality, locked-set performance, production readiness, or any product Harness capability.",
  ]),
});

export const PHASE2A_FAILURE_CLAIMS = Object.freeze({
  can_prove: Object.freeze([]),
  cannot_prove: Object.freeze([
    "An incomplete offline reference run cannot prove Candidate semantic quality or production readiness.",
  ]),
});

export const PHASE2A_SAFETY_ASSURANCE = Object.freeze({
  assurance_kind: "structural_contract_assertion",
  scope: "phase2a_fixed_cli_reachable_paths",
  os_level_telemetry: false,
});

const SHA256_PATTERN = "^sha256:[0-9a-f]{64}$";
const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const RFC3339_PATTERN =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$";
const SNAKE_CASE_PATTERN = "^[a-z][a-z0-9_]{0,95}$";

const hashSchema = { type: "string", pattern: SHA256_PATTERN };
const countSchema = { type: "integer", minimum: 0, maximum: 100000 };

const topicLabelSchema = {
  type: "string",
  enum: [
    "专业与课程",
    "缴费与资助",
    "注册与学籍",
    "签证与身份",
    "考试与成绩",
    "账号安全",
    "校园活动",
    "住宿与校园生活",
    "其他校务资讯",
  ],
};

const deadlineAtomSchema = {
  type: "object",
  additionalProperties: false,
  required: ["original_text", "role"],
  properties: {
    original_text: { type: "string", minLength: 1, maxLength: 160 },
    role: {
      type: "string",
      enum: [
        "submission_deadline",
        "payment_deadline",
        "registration_deadline",
        "exam_deadline",
        "response_deadline",
        "other_deadline",
      ],
    },
  },
};

function collectionDimensionSchema({ comparison, item, uniqueItems = false }) {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "comparison",
      "exact",
      "tp",
      "fp",
      "fn",
      "expected",
      "actual",
    ],
    properties: {
      comparison: { type: "string", const: comparison },
      exact: { type: "boolean" },
      tp: countSchema,
      fp: countSchema,
      fn: countSchema,
      expected: {
        type: "array",
        maxItems: 64,
        uniqueItems,
        items: item,
      },
      actual: {
        type: "array",
        maxItems: 64,
        uniqueItems,
        items: item,
      },
    },
  };
}

function scalarDimensionSchema(values) {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "comparison",
      "exact",
      "tp",
      "fp",
      "fn",
      "expected",
      "actual",
    ],
    properties: {
      comparison: { type: "string", const: "scalar" },
      exact: { type: "boolean" },
      tp: countSchema,
      fp: countSchema,
      fn: countSchema,
      expected: { type: "string", enum: values },
      actual: { type: "string", enum: values },
    },
  };
}

const automaticDimensionSchemas = {
  topics: collectionDimensionSchema({
    comparison: "set",
    item: topicLabelSchema,
    uniqueItems: true,
  }),
  applicability_value: scalarDimensionSchema([
    "applies",
    "possibly_applies",
    "not_applicable",
    "unknown",
  ]),
  profile_field_ids: collectionDimensionSchema({
    comparison: "set",
    item: { type: "string", minLength: 1, maxLength: 64 },
    uniqueItems: true,
  }),
  actions: collectionDimensionSchema({
    comparison: "multiset",
    item: {
      type: "string",
      enum: ["mandatory", "recommended", "optional"],
    },
  }),
  deadlines: collectionDimensionSchema({
    comparison: "multiset",
    item: deadlineAtomSchema,
  }),
  consequence_level: scalarDimensionSchema([
    "high",
    "medium",
    "low",
    "unknown",
  ]),
};

const automaticSchema = {
  type: "object",
  additionalProperties: false,
  required: ["passed", "dimensions", "totals"],
  properties: {
    passed: { type: "boolean" },
    dimensions: {
      type: "object",
      additionalProperties: false,
      required: PHASE2_AUTOMATIC_DIMENSION_NAMES,
      properties: automaticDimensionSchemas,
    },
    totals: {
      type: "object",
      additionalProperties: false,
      required: ["dimensions_total", "dimensions_exact", "tp", "fp", "fn"],
      properties: {
        dimensions_total: { type: "integer", const: 6 },
        dimensions_exact: { type: "integer", minimum: 0, maximum: 6 },
        tp: countSchema,
        fp: countSchema,
        fn: countSchema,
      },
    },
  },
};

const safeJsonValueSchema = {
  $dynamicAnchor: "safeJsonValue",
  anyOf: [
    { type: "null" },
    { type: "boolean" },
    { type: "number" },
    { type: "string", maxLength: 1000 },
    {
      type: "array",
      maxItems: 64,
      items: { $dynamicRef: "#safeJsonValue" },
    },
    {
      type: "object",
      maxProperties: 64,
      propertyNames: { type: "string", minLength: 1, maxLength: 96 },
      additionalProperties: { $dynamicRef: "#safeJsonValue" },
    },
  ],
};

const evaluationErrorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "severity", "path", "expected", "actual"],
  properties: {
    code: {
      type: "string",
      minLength: 1,
      maxLength: 96,
      pattern: SNAKE_CASE_PATTERN,
    },
    severity: { type: "string", enum: ["P0", "P1", "observation"] },
    path: {
      type: "string",
      minLength: 1,
      maxLength: 300,
      pattern: "^(?:/|\\$(?:\\.|\\[|$))",
    },
    expected: { $ref: "#/$defs/safeJsonValue" },
    actual: { $ref: "#/$defs/safeJsonValue" },
  },
};

const reviewItemSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "path", "status", "instruction"],
  properties: {
    code: { type: "string", enum: PHASE2_REVIEW_CODES },
    path: {
      type: "string",
      minLength: 1,
      maxLength: 300,
      pattern: "^(?:/|\\$(?:\\.|\\[|$))",
    },
    status: { type: "string", enum: ["pending", "pass", "fail"] },
    instruction: { type: "string", minLength: 1, maxLength: 500 },
  },
};

const excludedFieldSchema = {
  type: "object",
  additionalProperties: false,
  required: ["path", "reason_code", "reason"],
  properties: {
    path: {
      type: "string",
      minLength: 1,
      maxLength: 300,
      pattern: "^(?:/|\\$(?:\\.|\\[|$))",
    },
    reason_code: {
      type: "string",
      minLength: 1,
      maxLength: 96,
      pattern: SNAKE_CASE_PATTERN,
    },
    reason: { type: "string", minLength: 1, maxLength: 500 },
  },
};

const technicalValidationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "candidate_schema_valid",
    "references_closed",
    "quote_unique",
    "profile_refs_allowed",
    "forbidden_fields_absent",
    "candidate_unchanged",
  ],
  properties: {
    candidate_schema_valid: { type: "boolean" },
    references_closed: { type: "boolean" },
    quote_unique: { type: "boolean" },
    profile_refs_allowed: { type: "boolean" },
    forbidden_fields_absent: { type: "boolean" },
    candidate_unchanged: { type: "boolean" },
  },
};

const caseResultSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "case_id",
    "language",
    "input_projection_version",
    "oracle_version",
    "evaluator_version",
    "hashes",
    "technical_validation",
    "automatic",
    "errors",
    "review_queue",
    "excluded_fields",
  ],
  properties: {
    case_id: { type: "string", enum: PHASE2_DEVELOPMENT_CASE_IDS },
    language: {
      type: "string",
      enum: ["en", "zh-Hant", "mixed", "zh-Hans"],
    },
    input_projection_version: {
      type: "string",
      const: PHASE2_INPUT_PROJECTION_VERSION,
    },
    oracle_version: { type: "string", const: PHASE2_ORACLE_VERSION },
    evaluator_version: { type: "string", const: PHASE2_EVALUATOR_VERSION },
    hashes: {
      type: "object",
      additionalProperties: false,
      required: [
        "model_input_hash",
        "oracle_hash",
        "candidate_hash_before",
        "candidate_hash_after",
      ],
      properties: {
        model_input_hash: hashSchema,
        oracle_hash: hashSchema,
        candidate_hash_before: hashSchema,
        candidate_hash_after: hashSchema,
      },
    },
    technical_validation: technicalValidationSchema,
    automatic: automaticSchema,
    errors: {
      type: "array",
      maxItems: 128,
      items: evaluationErrorSchema,
    },
    review_queue: {
      type: "array",
      minItems: PHASE2_REVIEW_CODES.length,
      maxItems: PHASE2_REVIEW_CODES.length,
      items: reviewItemSchema,
    },
    excluded_fields: {
      type: "array",
      maxItems: 128,
      items: excludedFieldSchema,
    },
  },
};

const dimensionAggregateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["cases_total", "cases_exact", "tp", "fp", "fn"],
  properties: {
    cases_total: { type: "integer", minimum: 0, maximum: 16 },
    cases_exact: { type: "integer", minimum: 0, maximum: 16 },
    tp: countSchema,
    fp: countSchema,
    fn: countSchema,
  },
};

const severityCountsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["P0", "P1", "observation"],
  properties: {
    P0: countSchema,
    P1: countSchema,
    observation: countSchema,
  },
};

const reviewCountsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["pending", "pass", "fail"],
  properties: {
    pending: countSchema,
    pass: countSchema,
    fail: countSchema,
  },
};

const sliceSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "axis",
    "key",
    "case_count",
    "automatic_passed_case_count",
    "errors",
  ],
  properties: {
    axis: { type: "string", enum: ["language", "scenario", "field"] },
    key: { type: "string", minLength: 1, maxLength: 96 },
    case_count: { type: "integer", minimum: 0, maximum: 16 },
    automatic_passed_case_count: {
      type: "integer",
      minimum: 0,
      maximum: 16,
    },
    errors: severityCountsSchema,
  },
};

const summarySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "planned_case_count",
    "evaluated_case_count",
    "automatic_passed_case_count",
    "automatic_failed_case_count",
    "technical_invalid_case_count",
    "dimension_totals",
    "errors",
    "reviews",
    "excluded_field_count",
    "slices",
  ],
  properties: {
    planned_case_count: { type: "integer", const: 16 },
    evaluated_case_count: { type: "integer", minimum: 0, maximum: 16 },
    automatic_passed_case_count: {
      type: "integer",
      minimum: 0,
      maximum: 16,
    },
    automatic_failed_case_count: {
      type: "integer",
      minimum: 0,
      maximum: 16,
    },
    technical_invalid_case_count: {
      type: "integer",
      minimum: 0,
      maximum: 16,
    },
    dimension_totals: {
      type: "object",
      additionalProperties: false,
      required: PHASE2_AUTOMATIC_DIMENSION_NAMES,
      properties: Object.fromEntries(
        PHASE2_AUTOMATIC_DIMENSION_NAMES.map((name) => [
          name,
          dimensionAggregateSchema,
        ]),
      ),
    },
    errors: severityCountsSchema,
    reviews: reviewCountsSchema,
    excluded_field_count: countSchema,
    slices: {
      type: "array",
      maxItems: 64,
      items: sliceSchema,
    },
  },
};

const evaluationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "dataset_split",
    "case_set_version",
    "case_ids",
    "input_projection_version",
    "oracle_version",
    "evaluator_version",
    "candidate_schema_version",
    "candidate_schema_hash",
    "case_results",
    "summary",
    "claims",
  ],
  properties: {
    dataset_split: { type: "string", const: "development" },
    case_set_version: { type: "string", const: PHASE2_CASE_SET_VERSION },
    case_ids: { type: "array", const: PHASE2_DEVELOPMENT_CASE_IDS },
    input_projection_version: {
      type: "string",
      const: PHASE2_INPUT_PROJECTION_VERSION,
    },
    oracle_version: { type: "string", const: PHASE2_ORACLE_VERSION },
    evaluator_version: { type: "string", const: PHASE2_EVALUATOR_VERSION },
    candidate_schema_version: {
      type: "string",
      const: PHASE2_CANDIDATE_SCHEMA_VERSION,
    },
    candidate_schema_hash: {
      type: "string",
      const: PHASE2_CANDIDATE_SCHEMA_HASH,
    },
    case_results: {
      type: "array",
      maxItems: 16,
      items: caseResultSchema,
    },
    summary: summarySchema,
    claims: {
      type: "object",
      additionalProperties: false,
      required: ["can_prove", "cannot_prove"],
      properties: {
        can_prove: {
          type: "array",
          maxItems: 16,
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 500 },
        },
        cannot_prove: {
          type: "array",
          minItems: 1,
          maxItems: 32,
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 500 },
        },
      },
    },
  },
};

const terminalErrorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "message"],
  properties: {
    code: {
      type: "string",
      minLength: 1,
      maxLength: 96,
      pattern: SNAKE_CASE_PATTERN,
    },
    message: { type: "string", minLength: 1, maxLength: 500 },
  },
};

export const PHASE2_EVALUATION_RECORD_SCHEMA = Object.freeze({
  $schema: PHASE2_EVALUATION_SCHEMA_DIALECT,
  $id: "https://local.invalid/schemas/phase2-evaluation-record-v1.schema.json",
  $defs: { safeJsonValue: safeJsonValueSchema },
  type: "object",
  additionalProperties: false,
  required: [
    "record_schema_version",
    "run_id",
    "phase",
    "execution_mode",
    "status",
    "started_at",
    "finished_at",
    "provider",
    "model",
    "prompt_version",
    "safety",
    "safety_assurance",
    "evaluation",
    "canonical_evaluation_hash",
    "error",
  ],
  properties: {
    record_schema_version: {
      type: "string",
      const: PHASE2_EVALUATION_RECORD_SCHEMA_VERSION,
    },
    run_id: { type: "string", pattern: UUID_PATTERN },
    phase: { type: "string", const: "phase2a" },
    execution_mode: { type: "string", const: "offline_reference" },
    status: { type: "string", enum: ["succeeded", "failed"] },
    started_at: { type: "string", pattern: RFC3339_PATTERN },
    finished_at: { type: "string", pattern: RFC3339_PATTERN },
    provider: { type: "string", const: "offline_reference" },
    model: { type: "null" },
    prompt_version: { type: "string", const: "offline_reference" },
    safety: {
      type: "object",
      additionalProperties: false,
      required: [
        "provider_requests",
        "network_connections",
        "locked_file_accesses",
        "secret_reads",
        "listening_ports",
        "real_data_records",
      ],
      properties: {
        provider_requests: { type: "integer", const: 0 },
        network_connections: { type: "integer", const: 0 },
        locked_file_accesses: { type: "integer", const: 0 },
        secret_reads: { type: "integer", const: 0 },
        listening_ports: { type: "integer", const: 0 },
        real_data_records: { type: "integer", const: 0 },
      },
    },
    safety_assurance: { const: PHASE2A_SAFETY_ASSURANCE },
    evaluation: evaluationSchema,
    canonical_evaluation_hash: hashSchema,
    error: { anyOf: [{ type: "null" }, terminalErrorSchema] },
  },
  allOf: [
    {
      if: {
        required: ["status"],
        properties: { status: { const: "succeeded" } },
      },
      then: {
        properties: {
          error: { type: "null" },
          evaluation: {
            type: "object",
            properties: {
              case_results: { type: "array", minItems: 16, maxItems: 16 },
              summary: {
                type: "object",
                properties: {
                  evaluated_case_count: { const: 16 },
                  automatic_passed_case_count: { const: 16 },
                  automatic_failed_case_count: { const: 0 },
                  technical_invalid_case_count: { const: 0 },
                  errors: {
                    type: "object",
                    properties: { P0: { const: 0 }, P1: { const: 0 } },
                  },
                },
              },
              claims: { const: PHASE2A_SUCCESS_CLAIMS },
            },
          },
        },
      },
      else: {
        properties: {
          error: terminalErrorSchema,
          evaluation: {
            type: "object",
            properties: {
              claims: { const: PHASE2A_FAILURE_CLAIMS },
            },
          },
        },
      },
    },
  ],
});

const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  validateFormats: false,
});
const validateSchema = ajv.compile(PHASE2_EVALUATION_RECORD_SCHEMA);

function publicAjvErrors(errors = []) {
  return errors.map(({ instancePath, keyword, message }) => ({
    instancePath,
    keyword,
    message: message ?? "validation failed",
  }));
}

function customError(instancePath, keyword, message) {
  return { instancePath, keyword, message };
}

function validTimestamp(value) {
  if (
    typeof value !== "string" ||
    !new RegExp(RFC3339_PATTERN, "u").test(value)
  ) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function multisetCounts(expected, actual) {
  const expectedCounts = new Map();
  const actualCounts = new Map();
  for (const value of expected) {
    const key = canonicalJsonStringify(value);
    expectedCounts.set(key, (expectedCounts.get(key) ?? 0) + 1);
  }
  for (const value of actual) {
    const key = canonicalJsonStringify(value);
    actualCounts.set(key, (actualCounts.get(key) ?? 0) + 1);
  }
  const keys = new Set([...expectedCounts.keys(), ...actualCounts.keys()]);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const key of keys) {
    const expectedCount = expectedCounts.get(key) ?? 0;
    const actualCount = actualCounts.get(key) ?? 0;
    tp += Math.min(expectedCount, actualCount);
    fp += Math.max(0, actualCount - expectedCount);
    fn += Math.max(0, expectedCount - actualCount);
  }
  return { tp, fp, fn, exact: fp === 0 && fn === 0 };
}

function expectedDimensionCounts(dimension) {
  if (dimension.comparison === "scalar") {
    const exact = canonicalJsonStringify(dimension.expected) ===
      canonicalJsonStringify(dimension.actual);
    return {
      exact,
      tp: exact ? 1 : 0,
      fp: exact ? 0 : 1,
      fn: exact ? 0 : 1,
    };
  }
  return multisetCounts(dimension.expected, dimension.actual);
}

const DIMENSION_ERROR_CODES = Object.freeze({
  topics: Object.freeze(["topic_missing", "topic_unexpected"]),
  applicability_value: Object.freeze(["applicability_value_mismatch"]),
  profile_field_ids: Object.freeze([
    "profile_field_id_missing",
    "profile_field_id_unexpected",
  ]),
  actions: Object.freeze([
    "action_obligation_mismatch",
    "action_missing",
    "action_unexpected",
  ]),
  deadlines: Object.freeze([
    "deadline_original_text_mismatch",
    "deadline_role_mismatch",
    "deadline_atom_mismatch",
    "deadline_missing",
    "deadline_unexpected",
  ]),
  consequence_level: Object.freeze(["consequence_level_mismatch"]),
});

function allTrue(object) {
  return Object.values(object).every((value) => value === true);
}

const FORBIDDEN_RECORD_KEYS = new Set([
  "api_key",
  "authorization",
  "cookie",
  "candidate",
  "fixture_input",
  "headers",
  "invite_code",
  "invitation_code",
  "body",
  "model_input",
  "model_payload",
  "oracle",
  "prompt",
  "request_payload",
  "raw_candidate",
  "raw_response",
  "secret",
  "subject",
  "system_prompt",
  "full_prompt",
]);

const SECRET_VALUE_PATTERNS = [
  /authorization\s*:/iu,
  /bearer\s+[a-z0-9._~+/=-]{8,}/iu,
  /(?:api[_ -]?key|deepseek_api_key)\s*[:=]/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /cookie\s*:/iu,
  /\bsk-[a-z0-9_-]{12,}\b/iu,
];

function collectSensitiveValueErrors(value, instancePath = "", depth = 0) {
  const errors = [];
  if (depth > 12) {
    return [customError(instancePath, "safeRecord", "record nesting is too deep")];
  }
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      errors.push(
        customError(
          instancePath,
          "safeRecord",
          "record must not retain a secret-like value",
        ),
      );
    }
    return errors;
  }
  if (!value || typeof value !== "object") return errors;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      errors.push(...collectSensitiveValueErrors(item, `${instancePath}/${index}`, depth + 1));
    });
    return errors;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_RECORD_KEYS.has(key.toLowerCase())) {
      errors.push(
        customError(
          `${instancePath}/${key}`,
          "safeRecord",
          "record contains a forbidden raw or secret-bearing field",
        ),
      );
    }
    errors.push(
      ...collectSensitiveValueErrors(child, `${instancePath}/${key}`, depth + 1),
    );
  }
  return errors;
}

function collectCaseContractErrors(caseResult, index) {
  const errors = [];
  const prefix = `/evaluation/case_results/${index}`;

  for (const name of PHASE2_AUTOMATIC_DIMENSION_NAMES) {
    const dimension = caseResult.automatic.dimensions[name];
    const calculated = expectedDimensionCounts(dimension);
    for (const field of ["exact", "tp", "fp", "fn"]) {
      if (dimension[field] !== calculated[field]) {
        errors.push(
          customError(
            `${prefix}/automatic/dimensions/${name}/${field}`,
            "recomputedScore",
            `${field} must equal the recomputed ${name} score`,
          ),
        );
      }
    }
  }

  const dimensions = Object.values(caseResult.automatic.dimensions);
  const expectedTotals = {
    dimensions_total: dimensions.length,
    dimensions_exact: dimensions.filter(({ exact }) => exact).length,
    tp: dimensions.reduce((total, dimension) => total + dimension.tp, 0),
    fp: dimensions.reduce((total, dimension) => total + dimension.fp, 0),
    fn: dimensions.reduce((total, dimension) => total + dimension.fn, 0),
  };
  for (const [field, expected] of Object.entries(expectedTotals)) {
    if (caseResult.automatic.totals[field] !== expected) {
      errors.push(
        customError(
          `${prefix}/automatic/totals/${field}`,
          "recomputedScore",
          `${field} must equal the sum of the six dimensions`,
        ),
      );
    }
  }
  if (caseResult.automatic.passed !== (expectedTotals.dimensions_exact === 6)) {
    errors.push(
      customError(
        `${prefix}/automatic/passed`,
        "recomputedScore",
        "passed must mean all six automatic dimensions are exact",
      ),
    );
  }

  for (const name of PHASE2_AUTOMATIC_DIMENSION_NAMES) {
    const dimension = caseResult.automatic.dimensions[name];
    const allowedCodes = DIMENSION_ERROR_CODES[name];
    const matchingDiagnostics = caseResult.errors.filter(
      (item) =>
        allowedCodes.includes(item.code) &&
        (item.severity === "P0" || item.severity === "P1"),
    );
    if (!dimension.exact && matchingDiagnostics.length === 0) {
      errors.push(
        customError(
          `${prefix}/errors`,
          "diagnosticClosure",
          `${name} is not exact but has no matching P0/P1 diagnostic`,
        ),
      );
    }
    if (dimension.exact && matchingDiagnostics.length > 0) {
      errors.push(
        customError(
          `${prefix}/errors`,
          "diagnosticClosure",
          `${name} is exact but retains a contradictory diagnostic`,
        ),
      );
    }
  }

  const reviewCodes = caseResult.review_queue.map(({ code }) => code);
  if (
    new Set(reviewCodes).size !== PHASE2_REVIEW_CODES.length ||
    PHASE2_REVIEW_CODES.some((code) => !reviewCodes.includes(code))
  ) {
    errors.push(
      customError(
        `${prefix}/review_queue`,
        "reviewClosure",
        "review queue must contain each frozen manual review exactly once",
      ),
    );
  }
  if (caseResult.review_queue.some(({ status }) => status !== "pending")) {
    errors.push(
      customError(
        `${prefix}/review_queue`,
        "phase2aReviewState",
        "an offline Phase 2A reference record must leave every manual review pending",
      ),
    );
  }

  const hashesEqual =
    caseResult.hashes.candidate_hash_before ===
    caseResult.hashes.candidate_hash_after;
  if (caseResult.technical_validation.candidate_unchanged !== hashesEqual) {
    errors.push(
      customError(
        `${prefix}/technical_validation/candidate_unchanged`,
        "candidateIntegrity",
        "candidate_unchanged must agree with the before and after hashes",
      ),
    );
  }
  return errors;
}

function emptyDimensionAggregate() {
  return { cases_total: 0, cases_exact: 0, tp: 0, fp: 0, fn: 0 };
}

function recomputeSummary(caseResults) {
  const summary = {
    evaluated_case_count: caseResults.length,
    automatic_passed_case_count: 0,
    automatic_failed_case_count: 0,
    technical_invalid_case_count: 0,
    dimension_totals: Object.fromEntries(
      PHASE2_AUTOMATIC_DIMENSION_NAMES.map((name) => [
        name,
        emptyDimensionAggregate(),
      ]),
    ),
    errors: { P0: 0, P1: 0, observation: 0 },
    reviews: { pending: 0, pass: 0, fail: 0 },
    excluded_field_count: 0,
  };

  for (const caseResult of caseResults) {
    if (caseResult.automatic.passed) summary.automatic_passed_case_count += 1;
    else summary.automatic_failed_case_count += 1;
    if (!allTrue(caseResult.technical_validation)) {
      summary.technical_invalid_case_count += 1;
    }
    for (const name of PHASE2_AUTOMATIC_DIMENSION_NAMES) {
      const dimension = caseResult.automatic.dimensions[name];
      const aggregate = summary.dimension_totals[name];
      aggregate.cases_total += 1;
      if (dimension.exact) aggregate.cases_exact += 1;
      aggregate.tp += dimension.tp;
      aggregate.fp += dimension.fp;
      aggregate.fn += dimension.fn;
    }
    for (const item of caseResult.errors) summary.errors[item.severity] += 1;
    for (const item of caseResult.review_queue) summary.reviews[item.status] += 1;
    summary.excluded_field_count += caseResult.excluded_fields.length;
  }
  return summary;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Build the deterministic run summary from already-captured per-case results.
 * The returned value is detached from caller-owned slices and deeply frozen.
 */
export function summarizePhase2CaseResults(
  caseResults,
  { slices = [] } = {},
) {
  if (!Array.isArray(caseResults)) {
    throw new TypeError("caseResults must be an array");
  }
  if (!Array.isArray(slices)) {
    throw new TypeError("slices must be an array");
  }
  const detachedSlices = JSON.parse(canonicalJsonStringify(slices));
  return deepFreeze({
    planned_case_count: PHASE2_DEVELOPMENT_CASE_IDS.length,
    ...recomputeSummary(caseResults),
    slices: detachedSlices,
  });
}

function collectSummaryErrors(record) {
  const errors = [];
  const caseResults = record.evaluation.case_results;
  const caseIds = caseResults.map(({ case_id: caseId }) => caseId);
  if (new Set(caseIds).size !== caseIds.length) {
    errors.push(
      customError(
        "/evaluation/case_results",
        "caseClosure",
        "case results must have unique case IDs",
      ),
    );
  }
  const expectedOrder = PHASE2_DEVELOPMENT_CASE_IDS.filter((caseId) =>
    caseIds.includes(caseId),
  );
  if (canonicalJsonStringify(caseIds) !== canonicalJsonStringify(expectedOrder)) {
    errors.push(
      customError(
        "/evaluation/case_results",
        "caseOrder",
        "case results must follow the frozen case-set order",
      ),
    );
  }
  if (
    record.status === "succeeded" &&
    canonicalJsonStringify(caseIds) !==
      canonicalJsonStringify(PHASE2_DEVELOPMENT_CASE_IDS)
  ) {
    errors.push(
      customError(
        "/evaluation/case_results",
        "caseClosure",
        "a successful reference record must contain all 16 frozen cases",
      ),
    );
  }

  const recomputed = recomputeSummary(caseResults);
  const supplied = record.evaluation.summary;
  for (const field of [
    "evaluated_case_count",
    "automatic_passed_case_count",
    "automatic_failed_case_count",
    "technical_invalid_case_count",
    "excluded_field_count",
  ]) {
    if (supplied[field] !== recomputed[field]) {
      errors.push(
        customError(
          `/evaluation/summary/${field}`,
          "recomputedSummary",
          `${field} must equal the per-case aggregate`,
        ),
      );
    }
  }
  for (const group of ["errors", "reviews"]) {
    for (const [field, expected] of Object.entries(recomputed[group])) {
      if (supplied[group][field] !== expected) {
        errors.push(
          customError(
            `/evaluation/summary/${group}/${field}`,
            "recomputedSummary",
            `${group}.${field} must equal the per-case aggregate`,
          ),
        );
      }
    }
  }
  for (const name of PHASE2_AUTOMATIC_DIMENSION_NAMES) {
    for (const [field, expected] of Object.entries(
      recomputed.dimension_totals[name],
    )) {
      if (supplied.dimension_totals[name][field] !== expected) {
        errors.push(
          customError(
            `/evaluation/summary/dimension_totals/${name}/${field}`,
            "recomputedSummary",
            `${name}.${field} must equal the per-case aggregate`,
          ),
        );
      }
    }
  }
  return errors;
}

function collectContractErrors(record) {
  const errors = [];
  try {
    const serialized = canonicalJsonStringify(record);
    if (Buffer.byteLength(serialized, "utf8") > 2_000_000) {
      errors.push(customError("", "recordSize", "record exceeds 2 MB"));
    }
  } catch {
    return [
      customError("", "jsonValue", "record must contain only JSON-compatible data"),
    ];
  }

  errors.push(...collectSensitiveValueErrors(record));

  const startedAtValid = validTimestamp(record.started_at);
  const finishedAtValid = validTimestamp(record.finished_at);
  if (!startedAtValid) {
    errors.push(
      customError(
        "/started_at",
        "strictTimestamp",
        "started_at must be an exact UTC ISO timestamp with milliseconds",
      ),
    );
  }
  if (!finishedAtValid) {
    errors.push(
      customError(
        "/finished_at",
        "strictTimestamp",
        "finished_at must be an exact UTC ISO timestamp with milliseconds",
      ),
    );
  }
  if (
    startedAtValid &&
    finishedAtValid &&
    Date.parse(record.finished_at) < Date.parse(record.started_at)
  ) {
    errors.push(
      customError(
        "/finished_at",
        "timeOrder",
        "finished_at must not precede started_at",
      ),
    );
  }

  const expectedHash = computePhase2EvaluationHash(record);
  if (record.canonical_evaluation_hash !== expectedHash) {
    errors.push(
      customError(
        "/canonical_evaluation_hash",
        "canonicalHash",
        "canonical_evaluation_hash must cover only the complete evaluation object",
      ),
    );
  }

  record.evaluation.case_results.forEach((caseResult, index) => {
    errors.push(...collectCaseContractErrors(caseResult, index));
  });
  errors.push(...collectSummaryErrors(record));
  return errors;
}

/**
 * Hash the deterministic evaluation payload. Run IDs, timestamps, terminal
 * error text, and this hash field itself are intentionally excluded.
 */
export function computePhase2EvaluationHash(record) {
  if (!record || typeof record !== "object" || !record.evaluation) {
    throw new TypeError("record.evaluation is required");
  }
  return hashCanonicalJson(record.evaluation);
}

export function validatePhase2EvaluationRecord(record) {
  const schemaValid = validateSchema(record);
  const errors = schemaValid ? [] : publicAjvErrors(validateSchema.errors);
  if (schemaValid) errors.push(...collectContractErrors(record));
  return { valid: errors.length === 0, errors };
}

export class Phase2EvaluationRecordValidationError extends Error {
  constructor(errors) {
    super("phase2 evaluation record does not satisfy phase2-evaluation-record-v1");
    this.name = "Phase2EvaluationRecordValidationError";
    this.code = "record_write_failed";
    this.validationErrors = errors;
  }
}

export function assertValidPhase2EvaluationRecord(record) {
  const result = validatePhase2EvaluationRecord(record);
  if (!result.valid) {
    throw new Phase2EvaluationRecordValidationError(result.errors);
  }
  return record;
}
