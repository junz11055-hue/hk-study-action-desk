export const CORE_CANDIDATE_SCHEMA_DIALECT =
  "https://json-schema.org/draft/2020-12/schema";
export const CORE_CANDIDATE_SCHEMA_VERSION =
  "notification-analysis-core-candidate-p1-v2";
export const CORE_CANDIDATE_SCHEMA_NAME =
  "notification_analysis_core_candidate_p1_v2";

const ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$";
const SNAKE_CASE_PATTERN = "^[a-z][a-z0-9_]{0,63}$";

function idSchema() {
  return {
    type: "string",
    minLength: 1,
    maxLength: 64,
    pattern: ID_PATTERN,
  };
}

function nullableIdSchema() {
  return {
    type: ["string", "null"],
    minLength: 1,
    maxLength: 64,
    pattern: ID_PATTERN,
  };
}

function idArraySchema(minItems, maxItems) {
  return {
    type: "array",
    minItems,
    maxItems,
    items: idSchema(),
  };
}

function boundedString(minLength, maxLength) {
  return { type: "string", minLength, maxLength };
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
    claim_refs: idArraySchema(1, 4),
  },
  required: ["label", "claim_refs"],
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
    reason_zh: boundedString(1, 300),
    claim_ref: nullableIdSchema(),
    profile_field_ids: idArraySchema(0, 4),
  },
  required: [
    "scope",
    "value",
    "reason_zh",
    "claim_ref",
    "profile_field_ids",
  ],
};

const claimSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    claim_id: idSchema(),
    type: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      pattern: SNAKE_CASE_PATTERN,
    },
    text_zh: boundedString(1, 400),
    high_impact: { type: "boolean" },
    evidence_refs: idArraySchema(1, 4),
  },
  required: [
    "claim_id",
    "type",
    "text_zh",
    "high_impact",
    "evidence_refs",
  ],
};

const evidenceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    evidence_id: idSchema(),
    quote: boundedString(1, 500),
  },
  required: ["evidence_id", "quote"],
};

const actionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    action_id: idSchema(),
    actor_zh: boundedString(1, 120),
    verb_zh: boundedString(1, 120),
    object_zh: boundedString(1, 160),
    obligation: {
      type: "string",
      enum: ["mandatory", "recommended", "optional"],
    },
    claim_refs: idArraySchema(1, 4),
  },
  required: [
    "action_id",
    "actor_zh",
    "verb_zh",
    "object_zh",
    "obligation",
    "claim_refs",
  ],
};

const deadlineSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    deadline_id: idSchema(),
    original_text: boundedString(1, 160),
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
    claim_ref: idSchema(),
  },
  required: ["deadline_id", "original_text", "role", "claim_ref"],
};

const consequenceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    level: {
      type: "string",
      enum: ["high", "medium", "low", "unknown"],
    },
    reason_zh: boundedString(1, 300),
    claim_ref: nullableIdSchema(),
  },
  required: ["level", "reason_zh", "claim_ref"],
};

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA = deepFreeze({
  type: "object",
  additionalProperties: false,
  properties: {
    title_zh: boundedString(1, 100),
    title_claim_refs: idArraySchema(1, 2),
    summary_zh: boundedString(1, 400),
    summary_claim_refs: idArraySchema(1, 6),
    topics: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: topicSchema,
    },
    applicability: applicabilitySchema,
    claims: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: claimSchema,
    },
    evidence: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: evidenceSchema,
    },
    actions: {
      type: "array",
      minItems: 0,
      maxItems: 4,
      items: actionSchema,
    },
    deadlines: {
      type: "array",
      minItems: 0,
      maxItems: 4,
      items: deadlineSchema,
    },
    consequence: consequenceSchema,
  },
  required: [
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
  ],
});
