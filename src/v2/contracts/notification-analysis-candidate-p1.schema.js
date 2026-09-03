export const CANDIDATE_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";
export const CANDIDATE_SCHEMA_VERSION = "notification-analysis-candidate-p1-v1";
export const CANDIDATE_SCHEMA_NAME = "notification_analysis_candidate_p1_v1";

const ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$";
const SNAKE_CASE_PATTERN = "^[a-z][a-z0-9_]{0,63}$";
const RFC3339_WITH_OFFSET_PATTERN =
  "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,9})?(?:Z|[+-](?:0\\d|1[0-4]):[0-5]\\d)$";

function idSchema() {
  return { type: "string", minLength: 1, maxLength: 64, pattern: ID_PATTERN };
}

function nullableIdSchema() {
  return { type: ["string", "null"], minLength: 1, maxLength: 64, pattern: ID_PATTERN };
}

function idArraySchema(minItems, maxItems) {
  return { type: "array", minItems, maxItems, items: idSchema() };
}

function boundedString(minLength, maxLength) {
  return { type: "string", minLength, maxLength };
}

function nullableBoundedString(minLength, maxLength) {
  return { type: ["string", "null"], minLength, maxLength };
}

function snakeCaseSchema() {
  return {
    type: "string",
    minLength: 1,
    maxLength: 64,
    pattern: SNAKE_CASE_PATTERN,
  };
}

function profileFieldRefSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      profile_field_id: idSchema(),
      value: boundedString(1, 200),
      source: boundedString(1, 200),
      confirmation_status: {
        type: "string",
        enum: ["confirmed", "candidate", "unconfirmed"],
      },
      valid_until: boundedString(1, 200),
      course_status: {
        type: ["string", "null"],
        enum: ["confirmed", "candidate", "removed", "expired", null],
      },
    },
    required: [
      "profile_field_id",
      "value",
      "source",
      "confirmation_status",
      "valid_until",
      "course_status",
    ],
  };
}

function locatorSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      kind: {
        type: "string",
        enum: ["utf16_range", "attachment_page_range"],
      },
      attachment_id: nullableIdSchema(),
      page_number: {
        type: ["integer", "null"],
        minimum: 1,
        maximum: 10000,
      },
      start: { type: "integer", minimum: 0 },
      end: { type: "integer", minimum: 1 },
    },
    required: ["kind", "attachment_id", "page_number", "start", "end"],
  };
}

const topicSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: {
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
    },
    evidence_ids: idArraySchema(1, 8),
  },
  required: ["label", "evidence_ids"],
};

const applicabilitySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    scope: {
      type: "string",
      enum: [
        "current_user",
        "confirmed_course",
        "programme",
        "cohort",
        "department",
        "all_school",
        "unknown",
        "not_applicable",
      ],
    },
    value: {
      type: "string",
      enum: ["applies", "possibly_applies", "not_applicable", "unknown"],
    },
    reason: boundedString(1, 500),
    applicability_claim_id: nullableIdSchema(),
    evidence_ids: idArraySchema(0, 8),
    profile_field_refs: {
      type: "array",
      minItems: 0,
      maxItems: 8,
      items: profileFieldRefSchema(),
    },
    gaps: {
      type: "array",
      minItems: 0,
      maxItems: 8,
      items: boundedString(1, 300),
    },
  },
  required: [
    "scope",
    "value",
    "reason",
    "applicability_claim_id",
    "evidence_ids",
    "profile_field_refs",
    "gaps",
  ],
};

const claimSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    claim_id: idSchema(),
    type: snakeCaseSchema(),
    text: boundedString(1, 500),
    high_impact: { type: "boolean" },
    evidence_ids: idArraySchema(0, 8),
  },
  required: ["claim_id", "type", "text", "high_impact", "evidence_ids"],
};

const evidenceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    evidence_id: idSchema(),
    source: { type: "string", enum: ["body", "attachment"] },
    locator: locatorSchema(),
    quote: { type: "string", minLength: 1 },
  },
  required: ["evidence_id", "source", "locator", "quote"],
};

const actionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    action_id: idSchema(),
    actor: boundedString(1, 160),
    verb: boundedString(1, 160),
    object: boundedString(1, 160),
    condition: nullableBoundedString(1, 300),
    materials: {
      type: "array",
      minItems: 0,
      maxItems: 12,
      items: boundedString(1, 160),
    },
    obligation: {
      type: "string",
      enum: ["mandatory", "conditional_mandatory", "recommended", "optional"],
    },
    condition_status: {
      type: "string",
      enum: ["met", "unmet", "unknown", "not_applicable"],
    },
    condition_claim_refs: idArraySchema(0, 8),
    condition_basis_refs: {
      type: "array",
      minItems: 0,
      maxItems: 8,
      items: profileFieldRefSchema(),
    },
    claim_refs: idArraySchema(1, 8),
  },
  required: [
    "action_id",
    "actor",
    "verb",
    "object",
    "condition",
    "materials",
    "obligation",
    "condition_status",
    "condition_claim_refs",
    "condition_basis_refs",
    "claim_refs",
  ],
};

const managementSuggestionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    suggestion_id: idSchema(),
    text: boundedString(1, 240),
    reason: boundedString(1, 300),
    claim_refs: idArraySchema(1, 8),
  },
  required: ["suggestion_id", "text", "reason", "claim_refs"],
};

const dateSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    date_id: idSchema(),
    original_text: boundedString(1, 200),
    role: snakeCaseSchema(),
    normalized: {
      type: ["string", "null"],
      minLength: 1,
      maxLength: 80,
      pattern: RFC3339_WITH_OFFSET_PATTERN,
    },
    timezone: { type: "string", enum: ["Asia/Hong_Kong", "unknown"] },
    conflict: { type: "boolean" },
    claim_id: idSchema(),
    evidence_ids: idArraySchema(1, 8),
  },
  required: [
    "date_id",
    "original_text",
    "role",
    "normalized",
    "timezone",
    "conflict",
    "claim_id",
    "evidence_ids",
  ],
};

const keyChangeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    change_id: idSchema(),
    field: snakeCaseSchema(),
    old_value: nullableBoundedString(1, 300),
    new_value: nullableBoundedString(1, 300),
    related_historical_item_ids: idArraySchema(0, 8),
    claim_id: idSchema(),
    evidence_ids: idArraySchema(1, 8),
  },
  required: [
    "change_id",
    "field",
    "old_value",
    "new_value",
    "related_historical_item_ids",
    "claim_id",
    "evidence_ids",
  ],
};

const consequenceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    level: { type: "string", enum: ["high", "medium", "low", "unknown"] },
    reason: boundedString(1, 500),
    claim_id: nullableIdSchema(),
    evidence_ids: idArraySchema(0, 8),
  },
  required: ["level", "reason", "claim_id", "evidence_ids"],
};

const securityRiskSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    risk_id: idSchema(),
    risk_type: {
      type: "string",
      enum: [
        "prompt_injection",
        "phishing",
        "credential_request",
        "abnormal_payment",
        "malicious_link",
        "impersonation",
        "other",
      ],
    },
    description: boundedString(1, 400),
    claim_id: idSchema(),
    evidence_ids: idArraySchema(1, 8),
    verification_advice: boundedString(1, 400),
  },
  required: [
    "risk_id",
    "risk_type",
    "description",
    "claim_id",
    "evidence_ids",
    "verification_advice",
  ],
};

const uncertaintySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    uncertainty_id: idSchema(),
    missing_or_conflict: boundedString(1, 400),
    affected_candidate_fields: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "string",
        enum: [
          "topics",
          "applicability",
          "claims",
          "actions",
          "dates",
          "key_changes",
          "consequence",
          "security_risks",
        ],
      },
    },
  },
  required: ["uncertainty_id", "missing_or_conflict", "affected_candidate_fields"],
};

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const NOTIFICATION_ANALYSIS_CANDIDATE_P1_SCHEMA = deepFreeze({
  type: "object",
  additionalProperties: false,
  properties: {
    notification_id: idSchema(),
    source_language: {
      type: "string",
      enum: ["en", "zh-Hant", "zh-Hans", "mixed", "other"],
    },
    title_zh: boundedString(1, 100),
    title_claim_refs: idArraySchema(1, 4),
    summary_zh: boundedString(1, 600),
    summary_claim_refs: idArraySchema(1, 8),
    topics: {
      type: "array",
      minItems: 1,
      maxItems: 9,
      items: topicSchema,
    },
    applicability: applicabilitySchema,
    claims: { type: "array", minItems: 1, maxItems: 32, items: claimSchema },
    evidence: { type: "array", minItems: 1, maxItems: 48, items: evidenceSchema },
    actions: { type: "array", minItems: 0, maxItems: 12, items: actionSchema },
    management_suggestions: {
      type: "array",
      minItems: 0,
      maxItems: 8,
      items: managementSuggestionSchema,
    },
    dates: { type: "array", minItems: 0, maxItems: 16, items: dateSchema },
    key_changes: { type: "array", minItems: 0, maxItems: 8, items: keyChangeSchema },
    consequence: consequenceSchema,
    security_risks: {
      type: "array",
      minItems: 0,
      maxItems: 8,
      items: securityRiskSchema,
    },
    uncertainties: {
      type: "array",
      minItems: 0,
      maxItems: 12,
      items: uncertaintySchema,
    },
  },
  required: [
    "notification_id",
    "source_language",
    "title_zh",
    "title_claim_refs",
    "summary_zh",
    "summary_claim_refs",
    "topics",
    "applicability",
    "claims",
    "evidence",
    "actions",
    "management_suggestions",
    "dates",
    "key_changes",
    "consequence",
    "security_risks",
    "uncertainties",
  ],
});
