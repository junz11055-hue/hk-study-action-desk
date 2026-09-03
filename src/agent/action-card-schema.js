const evidenceItemSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1, maxLength: 40 },
    quote: { type: "string", minLength: 1, maxLength: 500 },
    explanationZh: { type: "string", minLength: 1, maxLength: 300 },
  },
  required: ["id", "quote", "explanationZh"],
};

export const ACTION_CARD_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    messageId: { type: "string", minLength: 1, maxLength: 80 },
    isSchoolRelated: { type: "boolean" },
    appliesToUser: { type: "string", enum: ["yes", "no", "uncertain"] },
    importance: { type: "string", enum: ["low", "medium", "high", "critical"] },
    titleZh: { type: "string", minLength: 1, maxLength: 100 },
    summaryZh: { type: "string", minLength: 1, maxLength: 500 },
    language: { type: "string", enum: ["english", "traditional", "mixed"] },
    recommendedNotification: { type: "string", enum: ["now", "digest", "none"] },
    actions: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 1, maxLength: 40 },
          labelZh: { type: "string", minLength: 1, maxLength: 160 },
          kind: { type: "string", enum: ["required", "recommended", "info"] },
          dueAt: { type: ["string", "null"] },
          calendarEligible: { type: "boolean" },
          evidenceIds: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: { type: "string" },
          },
        },
        required: ["id", "labelZh", "kind", "dueAt", "calendarEligible", "evidenceIds"],
      },
    },
    dates: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 1, maxLength: 40 },
          raw: { type: "string", minLength: 1, maxLength: 180 },
          normalizedAt: { type: ["string", "null"] },
          timezone: { type: "string", enum: ["Asia/Hong_Kong", "unknown"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          status: { type: "string", enum: ["confirmed", "ambiguous", "updated", "cancelled"] },
          evidenceIds: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: { type: "string" },
          },
        },
        required: [
          "id",
          "raw",
          "normalizedAt",
          "timezone",
          "confidence",
          "status",
          "evidenceIds"
        ],
      },
    },
    riskFlags: {
      type: "array",
      maxItems: 8,
      items: {
        type: "string",
        enum: [
          "prompt_injection",
          "phishing",
          "date_conflict",
          "unsupported_attachment",
          "sensitive_data_request"
        ],
      },
    },
    uncertainties: {
      type: "array",
      maxItems: 8,
      items: { type: "string", maxLength: 240 },
    },
    evidence: {
      type: "array",
      maxItems: 16,
      items: evidenceItemSchema,
    },
  },
  required: [
    "messageId",
    "isSchoolRelated",
    "appliesToUser",
    "importance",
    "titleZh",
    "summaryZh",
    "language",
    "recommendedNotification",
    "actions",
    "dates",
    "riskFlags",
    "uncertainties",
    "evidence"
  ],
});

export const FOLLOW_UP_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    answerZh: { type: "string", minLength: 1, maxLength: 1_200 },
    evidenceQuotes: {
      type: "array",
      maxItems: 5,
      items: { type: "string", minLength: 1, maxLength: 500 },
    },
    uncertainty: { type: ["string", "null"] },
  },
  required: ["answerZh", "evidenceQuotes", "uncertainty"],
});
