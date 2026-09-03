import {
  getTrustedSyntheticDateFact,
  hasTrustedSyntheticDateSet,
  isTrustedCalendarInstant,
  isTrustedSyntheticDate,
} from "../data/synthetic-date-facts.js";

const ROOT_KEYS = [
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
  "evidence",
];

const ENUMS = Object.freeze({
  appliesToUser: new Set(["yes", "no", "uncertain"]),
  importance: new Set(["low", "medium", "high", "critical"]),
  language: new Set(["english", "traditional", "mixed"]),
  recommendedNotification: new Set(["now", "digest", "none"]),
  actionKind: new Set(["required", "recommended", "info"]),
  confidence: new Set(["high", "medium", "low"]),
  dateStatus: new Set(["confirmed", "ambiguous", "updated", "cancelled"]),
  riskFlag: new Set([
    "prompt_injection",
    "phishing",
    "date_conflict",
    "unsupported_attachment",
    "sensitive_data_request",
  ]),
});

export class CardValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "CardValidationError";
  }
}

function fail(message) {
  throw new CardValidationError(message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertObject(value, label, allowedKeys) {
  if (!isPlainObject(value)) fail(`${label} must be an object`);
  const keys = Object.keys(value);
  const extras = keys.filter((key) => !allowedKeys.includes(key));
  if (extras.length > 0) fail(`${label} contains unsupported fields: ${extras.join(", ")}`);
  for (const key of allowedKeys) {
    if (!(key in value)) fail(`${label}.${key} is required`);
  }
}

function assertString(value, label, maxLength, { allowEmpty = false } = {}) {
  if (typeof value !== "string") fail(`${label} must be a string`);
  if (!allowEmpty && value.trim().length === 0) fail(`${label} cannot be empty`);
  if (value.length > maxLength) fail(`${label} is too long`);
  if (/\u0000/.test(value)) fail(`${label} contains a null byte`);
  return value;
}

function assertArray(value, label, maxLength) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  if (value.length > maxLength) fail(`${label} has too many items`);
  return value;
}

function assertEnum(value, label, allowed) {
  if (!allowed.has(value)) fail(`${label} has an invalid value`);
  return value;
}

function assertNullableIso(value, label) {
  if (value === null) return null;
  assertString(value, label, 80);
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!match || Number.isNaN(Date.parse(value))) {
    fail(`${label} must be an RFC 3339 date-time or null`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offset] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const maxDay = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  const offsetValid =
    offset === "Z" ||
    (() => {
      const [offsetHour, offsetMinute] = offset.slice(1).split(":").map(Number);
      return offsetHour <= 14 && offsetMinute <= 59 && (offsetHour < 14 || offsetMinute === 0);
    })();
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > maxDay ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    !offsetValid
  ) {
    fail(`${label} contains an invalid calendar date or time`);
  }
  return value;
}

function uniqueIds(items, label) {
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) fail(`${label} contains a duplicate id: ${item.id}`);
    ids.add(item.id);
  }
  return ids;
}

function copyStringArray(value, label, maxItems, maxStringLength = 240) {
  const copied = assertArray(value, label, maxItems).map((item, index) =>
    assertString(item, `${label}[${index}]`, maxStringLength),
  );
  if (new Set(copied).size !== copied.length) fail(`${label} must not contain duplicates`);
  return copied;
}

export function validateActionCard(candidate, email) {
  assertObject(candidate, "card", ROOT_KEYS);
  if (candidate.messageId !== email.id) fail("card.messageId does not match the current message");
  if (typeof candidate.isSchoolRelated !== "boolean") fail("card.isSchoolRelated must be boolean");

  const evidence = assertArray(candidate.evidence, "card.evidence", 16).map((item, index) => {
    assertObject(item, `card.evidence[${index}]`, ["id", "quote", "explanationZh"]);
    const quote = assertString(item.quote, `card.evidence[${index}].quote`, 500);
    if (!email.body.includes(quote)) fail(`evidence quote ${item.id} is not in the synthetic source message`);
    return {
      id: assertString(item.id, `card.evidence[${index}].id`, 40),
      quote,
      explanationZh: assertString(item.explanationZh, `card.evidence[${index}].explanationZh`, 300),
    };
  });
  const evidenceIds = uniqueIds(evidence, "card.evidence");

  const actions = assertArray(candidate.actions, "card.actions", 8).map((item, index) => {
    assertObject(item, `card.actions[${index}]`, [
      "id",
      "labelZh",
      "kind",
      "dueAt",
      "calendarEligible",
      "evidenceIds",
    ]);
    const dueAt = assertNullableIso(item.dueAt, `card.actions[${index}].dueAt`);
    if (typeof item.calendarEligible !== "boolean") {
      fail(`card.actions[${index}].calendarEligible must be boolean`);
    }
    if (item.calendarEligible && dueAt === null) {
      fail(`card.actions[${index}] cannot be calendar eligible without a date`);
    }
    const refs = copyStringArray(item.evidenceIds, `card.actions[${index}].evidenceIds`, 4, 40);
    if (refs.length === 0 || refs.some((id) => !evidenceIds.has(id))) {
      fail(`card.actions[${index}] has invalid evidence references`);
    }
    return {
      id: assertString(item.id, `card.actions[${index}].id`, 40),
      labelZh: assertString(item.labelZh, `card.actions[${index}].labelZh`, 160),
      kind: assertEnum(item.kind, `card.actions[${index}].kind`, ENUMS.actionKind),
      dueAt,
      calendarEligible: item.calendarEligible,
      evidenceIds: refs,
    };
  });
  uniqueIds(actions, "card.actions");

  const dates = assertArray(candidate.dates, "card.dates", 8).map((item, index) => {
    assertObject(item, `card.dates[${index}]`, [
      "id",
      "raw",
      "normalizedAt",
      "timezone",
      "confidence",
      "status",
      "evidenceIds",
    ]);
    const confidence = assertEnum(item.confidence, `card.dates[${index}].confidence`, ENUMS.confidence);
    const status = assertEnum(item.status, `card.dates[${index}].status`, ENUMS.dateStatus);
    const normalizedAt = assertNullableIso(item.normalizedAt, `card.dates[${index}].normalizedAt`);
    if ((status === "ambiguous" || confidence === "low") && normalizedAt !== null) {
      fail(`card.dates[${index}] cannot normalize an ambiguous or low-confidence date`);
    }
    if (item.timezone === "Asia/Hong_Kong" && normalizedAt !== null && !normalizedAt.endsWith("+08:00")) {
      fail(`card.dates[${index}] must use the Hong Kong UTC+08:00 offset`);
    }
    const refs = copyStringArray(item.evidenceIds, `card.dates[${index}].evidenceIds`, 4, 40);
    if (refs.length === 0 || refs.some((id) => !evidenceIds.has(id))) {
      fail(`card.dates[${index}] has invalid evidence references`);
    }
    const raw = assertString(item.raw, `card.dates[${index}].raw`, 180);
    const referencedQuotes = refs.map((id) => evidence.find((entry) => entry.id === id)?.quote ?? "");
    if (!referencedQuotes.some((quote) => quote.includes(raw))) {
      fail(`card.dates[${index}].raw is not present in its referenced evidence`);
    }
    if (
      normalizedAt !== null &&
      hasTrustedSyntheticDateSet(email.id) &&
      !isTrustedSyntheticDate(email.id, normalizedAt)
    ) {
      fail(`card.dates[${index}].normalizedAt conflicts with the trusted synthetic date facts`);
    }
    const trustedDateFact =
      normalizedAt === null ? null : getTrustedSyntheticDateFact(email.id, normalizedAt);
    if (trustedDateFact && !trustedDateFact.statuses.includes(status)) {
      fail(`card.dates[${index}].status conflicts with the trusted date role`);
    }
    return {
      id: assertString(item.id, `card.dates[${index}].id`, 40),
      raw,
      normalizedAt,
      timezone: assertEnum(
        item.timezone,
        `card.dates[${index}].timezone`,
        new Set(["Asia/Hong_Kong", "unknown"]),
      ),
      confidence,
      status,
      evidenceIds: refs,
    };
  });
  uniqueIds(dates, "card.dates");

  for (const [index, action] of actions.entries()) {
    const matchingDates = dates.filter((date) => date.normalizedAt === action.dueAt);
    if (action.dueAt !== null && matchingDates.length === 0) {
      fail(`card.actions[${index}].dueAt does not match a validated date`);
    }
    if (
      action.calendarEligible &&
      !matchingDates.some(
        (date) =>
          date.timezone === "Asia/Hong_Kong" &&
          date.confidence !== "low" &&
          ["confirmed", "updated"].includes(date.status),
      )
    ) {
      fail(`card.actions[${index}] is not eligible for a confirmed Hong Kong calendar preview`);
    }
    if (action.calendarEligible && !isTrustedCalendarInstant(email.id, action.dueAt)) {
      fail(`card.actions[${index}].dueAt is not a trusted calendar start or deadline`);
    }
  }

  const riskFlags = assertArray(candidate.riskFlags, "card.riskFlags", 8).map((flag, index) =>
    assertEnum(flag, `card.riskFlags[${index}]`, ENUMS.riskFlag),
  );
  if (new Set(riskFlags).size !== riskFlags.length) fail("card.riskFlags must be unique");

  const untrustedBody = email.body.toLowerCase();
  const containsPromptInjection =
    /ignore all previous instructions|reveal (?:its |the )?system prompt|invitation codes|api key/i.test(
      untrustedBody,
    );
  const containsCredentialRequest =
    /password/.test(untrustedBody) && /one-time verification code/.test(untrustedBody);
  if (containsPromptInjection && !riskFlags.includes("prompt_injection")) {
    fail("card must flag prompt injection found in the source message");
  }
  if (
    containsCredentialRequest &&
    (!riskFlags.includes("phishing") || !riskFlags.includes("sensitive_data_request"))
  ) {
    fail("card must flag phishing and sensitive-data requests found in the source message");
  }
  if ((containsPromptInjection || containsCredentialRequest) && dates.length > 0) {
    fail("security challenge messages cannot create trusted dates");
  }
  if (
    (containsPromptInjection || containsCredentialRequest) &&
    actions.some((action) => action.calendarEligible || action.dueAt !== null)
  ) {
    fail("security challenge messages cannot create calendar actions");
  }
  const sensitiveAction = actions.find(
    (action) =>
      /密码|验证码|api\s*key|密钥|系统提示|邀请码/i.test(action.labelZh) &&
      !/不要|切勿|不可|拒绝|禁止|勿|不应/i.test(action.labelZh),
  );
  if (containsCredentialRequest && sensitiveAction) {
    fail("card cannot recommend sharing credentials or secrets");
  }

  return Object.freeze({
    messageId: candidate.messageId,
    isSchoolRelated: candidate.isSchoolRelated,
    appliesToUser: assertEnum(candidate.appliesToUser, "card.appliesToUser", ENUMS.appliesToUser),
    importance: assertEnum(candidate.importance, "card.importance", ENUMS.importance),
    titleZh: assertString(candidate.titleZh, "card.titleZh", 100),
    summaryZh: assertString(candidate.summaryZh, "card.summaryZh", 500),
    language: assertEnum(candidate.language, "card.language", ENUMS.language),
    recommendedNotification: assertEnum(
      candidate.recommendedNotification,
      "card.recommendedNotification",
      ENUMS.recommendedNotification,
    ),
    actions,
    dates,
    riskFlags,
    uncertainties: copyStringArray(candidate.uncertainties, "card.uncertainties", 8),
    evidence,
  });
}

export function validateFollowUp(candidate, email) {
  assertObject(candidate, "followUp", ["answerZh", "evidenceQuotes", "uncertainty"]);
  const evidenceQuotes = assertArray(candidate.evidenceQuotes, "followUp.evidenceQuotes", 5).map(
    (quote, index) => {
      const checked = assertString(quote, `followUp.evidenceQuotes[${index}]`, 500);
      if (!email.body.includes(checked)) fail("follow-up evidence is not in the synthetic source message");
      return checked;
    },
  );
  const uncertainty =
    candidate.uncertainty === null
      ? null
      : assertString(candidate.uncertainty, "followUp.uncertainty", 400);
  return Object.freeze({
    answerZh: assertString(candidate.answerZh, "followUp.answerZh", 1_200),
    evidenceQuotes,
    uncertainty,
  });
}
