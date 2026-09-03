import Ajv2020 from "ajv/dist/2020.js";

import { NOTIFICATION_ANALYSIS_CANDIDATE_P1_SCHEMA } from "../contracts/notification-analysis-candidate-p1.schema.js";

const FORBIDDEN_KEYS = new Set([
  "incoming_disposition",
  "protection_result",
  "source_truth_id",
  "source_status",
  "action_channel_status",
  "relation_truth_id",
  "home_section",
  "notification_channel",
  "calendar_candidate",
  "calendar_eligible",
  "resulting_item",
  "fact_states",
  "blocked_capabilities",
  "north_star_eligible",
  "north_star_maturity_status",
  "read_status",
  "management_status",
  "item_status",
  "version_status",
  "visibility_status",
  "due_status",
  "source_mode",
  "tool_calls",
  "tools",
]);

const PROFILE_REQUIRED_SCOPES = new Set([
  "current_user",
  "confirmed_course",
  "programme",
  "cohort",
  "department",
]);

const SECRET_PATTERN =
  /(?:\b(?:authorization|api[_ -]?key|cookie|session[_ -]?secret|invite[_ -]?code)\b\s*[:=]|\bbearer\s+[A-Za-z0-9._~-]{8,}|\bsk-[A-Za-z0-9_-]{8,}\b|\bDEEPSEEK_API_KEY\b)/iu;
const EXTERNAL_SUCCESS_PATTERN =
  /(?:(?:我|本助手|AI|系统)(?:已(?:经)?|成功).{0,16}(?:付款|支付|缴费|回复|提交|注册|写入(?:了)?日历|同步(?:到|了)?日历|发送(?:了)?通知)|(?:已(?:经)?|成功).{0,8}(?:替|为|帮)(?:用户|你|您).{0,12}(?:付款|支付|缴费|回复|提交|注册|写入(?:了)?日历|同步(?:到|了)?日历|发送(?:了)?通知)|(?:I|we|the assistant|the system) (?:have |has )?(?:already |successfully )?(?:paid|replied|submitted|registered|added.{0,12}calendar|sent.{0,12}notification) (?:for )?(?:you|the user))/iu;
const HIGH_RISK_SUGGESTION_PATTERN =
  /(?:付款|支付|缴费|转账|提交(?:证件|身份证|护照|签证|凭证|验证码|密码)|输入(?:凭证|验证码|密码)|修改(?:账户|账号|密码)|回复(?:邮件|对方)|注册(?:账号|账户)|点击(?:邮件)?链接|登录(?:账号|账户)|\b(?:pay|transfer|submit (?:an? )?(?:credential|passport|identity|password|code)|enter (?:a )?(?:password|code)|reply to|register an? account|click (?:the )?link|log in)\b)/iu;
const CREDENTIAL_ADVICE_PATTERN =
  /(?:回复|提交|发送|提供|输入).{0,16}(?:密码|口令|验证码|凭证)|(?:reply|submit|send|provide|enter).{0,24}(?:password|passcode|verification code|credential)/iu;

const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateSchema = ajv.compile(NOTIFICATION_ANALYSIS_CANDIDATE_P1_SCHEMA);

export class CandidateValidationError extends Error {
  constructor(code, message, jsonPaths = []) {
    super(message);
    this.name = "CandidateValidationError";
    this.code = code;
    this.jsonPaths = Object.freeze([...new Set(jsonPaths)].slice(0, 8));
  }
}

function fail(code, message, jsonPaths = []) {
  throw new CandidateValidationError(code, message, jsonPaths);
}

function childPath(parent, key) {
  if (typeof key === "number") return `${parent}[${key}]`;
  return `${parent}.${key}`;
}

function scanCandidateTree(value, path = "$", ancestors = new WeakSet()) {
  if (typeof value === "string") {
    if (SECRET_PATTERN.test(value)) {
      fail("candidate_secret_detected", "Candidate contains secret-like material", [path]);
    }
    if (EXTERNAL_SUCCESS_PATTERN.test(value)) {
      fail(
        "candidate_external_action_claim",
        "Candidate claims an external action was completed for the user",
        [path],
      );
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (ancestors.has(value)) {
    fail("candidate_schema_invalid", "Candidate must be an acyclic JSON value", [path]);
  }
  ancestors.add(value);
  for (const key of Object.keys(value)) {
    const pathForKey = childPath(path, key);
    if (FORBIDDEN_KEYS.has(key)) {
      fail("candidate_forbidden_field", `Candidate contains forbidden field: ${key}`, [pathForKey]);
    }
    scanCandidateTree(value[key], pathForKey, ancestors);
  }
  ancestors.delete(value);
}

function schemaErrorPaths(errors) {
  const pointerToJsonPath = (pointer) => {
    if (!pointer) return "$";
    return pointer
      .split("/")
      .slice(1)
      .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
      .reduce(
        (path, part) =>
          /^\d+$/.test(part)
            ? `${path}[${part}]`
            : `${path}.${part}`,
        "$",
      );
  };
  return (errors ?? []).map((error) => {
    const instancePath = pointerToJsonPath(error.instancePath);
    if (error.keyword === "additionalProperties" && error.params?.additionalProperty) {
      return `${instancePath}.${error.params.additionalProperty}`;
    }
    return instancePath;
  });
}

function assertUnique(values, path) {
  if (new Set(values).size !== values.length) {
    fail("candidate_reference_invalid", `${path} must not contain duplicates`, [path]);
  }
}

function indexUnique(items, idKey, path) {
  const indexed = new Map();
  for (let index = 0; index < items.length; index += 1) {
    const id = items[index][idKey];
    if (indexed.has(id)) {
      fail("candidate_reference_invalid", `${path} contains duplicate ID: ${id}`, [
        `${path}[${index}].${idKey}`,
      ]);
    }
    indexed.set(id, items[index]);
  }
  return indexed;
}

function assertReferences(values, target, path) {
  assertUnique(values, path);
  const missing = values.filter((value) => !target.has(value));
  if (missing.length > 0) {
    fail("candidate_reference_invalid", `${path} contains an unknown reference`, [path]);
  }
}

function profileFieldIndex(profile) {
  const indexed = new Map();
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return indexed;

  const add = (field, courseStatus) => {
    if (!field || typeof field !== "object" || typeof field.profile_field_id !== "string") return;
    if (indexed.has(field.profile_field_id)) {
      fail("candidate_context_invalid", "Model Input contains duplicate profile field IDs");
    }
    indexed.set(field.profile_field_id, {
      profile_field_id: field.profile_field_id,
      value: courseStatus === null ? field.value : field.code,
      source: field.source,
      confirmation_status: field.confirmation_status,
      valid_until: field.valid_until,
      course_status: courseStatus,
    });
  };

  for (const value of Object.values(profile)) {
    if (Array.isArray(value)) {
      for (const field of value) add(field, field?.status ?? null);
    } else {
      add(value, null);
    }
  }
  return indexed;
}

function sameProfileRef(actual, inputRef) {
  return (
    actual.profile_field_id === inputRef.profile_field_id &&
    actual.value === inputRef.value &&
    actual.source === inputRef.source &&
    actual.confirmation_status === inputRef.confirmation_status &&
    actual.valid_until === inputRef.valid_until &&
    actual.course_status === inputRef.course_status
  );
}

function assertProfileRefs(refs, profileFields, path) {
  assertUnique(
    refs.map((ref) => ref.profile_field_id),
    path,
  );
  for (let index = 0; index < refs.length; index += 1) {
    const ref = refs[index];
    const inputRef = profileFields.get(ref.profile_field_id);
    if (!inputRef || !sameProfileRef(ref, inputRef)) {
      fail("candidate_reference_invalid", `${path} does not exactly match Model Input`, [
        `${path}[${index}]`,
      ]);
    }
  }
}

function isCurrentConfirmedProfileRef(ref, currentTimeHkt) {
  if (ref.confirmation_status !== "confirmed") return false;
  const currentDate = typeof currentTimeHkt === "string" ? currentTimeHkt.slice(0, 10) : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(ref.valid_until) && /^\d{4}-\d{2}-\d{2}$/.test(currentDate)) {
    return ref.valid_until >= currentDate;
  }
  const validUntil = Date.parse(ref.valid_until);
  const currentTime = Date.parse(currentTimeHkt);
  return Number.isFinite(validUntil) && Number.isFinite(currentTime) && validUntil >= currentTime;
}

function assertEvidenceLocator(evidence, message, path) {
  const { locator } = evidence;
  let sourceText;

  if (evidence.source === "body") {
    if (
      locator.kind !== "utf16_range" ||
      locator.attachment_id !== null ||
      locator.page_number !== null
    ) {
      fail("candidate_locator_invalid", "Body evidence requires a UTF-16 body locator", [
        `${path}.locator`,
      ]);
    }
    sourceText = message.body;
  } else {
    if (
      locator.kind !== "attachment_page_range" ||
      locator.attachment_id === null ||
      locator.page_number === null
    ) {
      fail("candidate_locator_invalid", "Attachment evidence requires attachment and page locators", [
        `${path}.locator`,
      ]);
    }
    const attachment = message.attachments?.find(
      (item) => item.attachment_id === locator.attachment_id,
    );
    const page = attachment?.pages?.find((item) => item.page === locator.page_number);
    if (attachment?.parse_status !== "parsed" || typeof page?.text !== "string") {
      fail("candidate_locator_invalid", "Attachment evidence points outside parsed Model Input", [
        `${path}.locator`,
      ]);
    }
    sourceText = page.text;
  }

  if (typeof sourceText !== "string") {
    fail("candidate_context_invalid", "Model Input source text is unavailable", [path]);
  }
  if (locator.end <= locator.start || locator.end > sourceText.length) {
    fail("candidate_locator_invalid", "Evidence UTF-16 range is out of bounds", [
      `${path}.locator`,
    ]);
  }
  if (sourceText.slice(locator.start, locator.end) !== evidence.quote) {
    fail("candidate_locator_invalid", "Evidence quote is not the exact UTF-16 source slice", [
      `${path}.quote`,
      `${path}.locator`,
    ]);
  }
}

function assertRfc3339DateTime(value, timezone, path) {
  if (value === null) return;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!match || Number.isNaN(Date.parse(value))) {
    fail("candidate_cross_field_invalid", "Normalized date must be a real RFC 3339 instant", [path]);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offset] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const maxDay = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  const offsetParts = offset === "Z" ? [0, 0] : offset.slice(1).split(":").map(Number);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > maxDay ||
    Number(hourText) > 23 ||
    Number(minuteText) > 59 ||
    Number(secondText) > 59 ||
    offsetParts[0] > 14 ||
    offsetParts[1] > 59 ||
    (offsetParts[0] === 14 && offsetParts[1] !== 0)
  ) {
    fail("candidate_cross_field_invalid", "Normalized date contains an invalid calendar value", [path]);
  }
  if (timezone === "Asia/Hong_Kong" && offset !== "+08:00") {
    fail("candidate_cross_field_invalid", "Hong Kong dates must use the +08:00 offset", [path]);
  }
}

/**
 * Accepts the Candidate by identity or throws a controlled error. It never maps,
 * repairs, sorts, freezes, clones, or otherwise changes the Candidate.
 */
export function validateNotificationAnalysisCandidate(candidate, modelInput) {
  scanCandidateTree(candidate);

  if (!validateSchema(candidate)) {
    fail(
      "candidate_schema_invalid",
      "Candidate does not match notification-analysis-candidate-p1-v1",
      schemaErrorPaths(validateSchema.errors),
    );
  }

  const message = modelInput?.message;
  if (
    !message ||
    typeof message.notification_id !== "string" ||
    typeof message.body !== "string" ||
    !Array.isArray(message.attachments) ||
    !modelInput.profile ||
    typeof modelInput.profile !== "object" ||
    Array.isArray(modelInput.profile) ||
    !Array.isArray(modelInput.historical_items)
  ) {
    fail("candidate_context_invalid", "Model Input message context is invalid");
  }
  if (candidate.notification_id !== message.notification_id) {
    fail("candidate_reference_invalid", "notification_id does not match Model Input", [
      "$.notification_id",
    ]);
  }

  const claims = indexUnique(candidate.claims, "claim_id", "$.claims");
  const evidence = indexUnique(candidate.evidence, "evidence_id", "$.evidence");
  indexUnique(candidate.actions, "action_id", "$.actions");
  indexUnique(candidate.management_suggestions, "suggestion_id", "$.management_suggestions");
  indexUnique(candidate.dates, "date_id", "$.dates");
  indexUnique(candidate.key_changes, "change_id", "$.key_changes");
  indexUnique(candidate.security_risks, "risk_id", "$.security_risks");
  indexUnique(candidate.uncertainties, "uncertainty_id", "$.uncertainties");
  assertUnique(
    candidate.topics.map((topic) => topic.label),
    "$.topics",
  );

  assertReferences(candidate.title_claim_refs, claims, "$.title_claim_refs");
  assertReferences(candidate.summary_claim_refs, claims, "$.summary_claim_refs");

  candidate.topics.forEach((topic, index) => {
    assertReferences(topic.evidence_ids, evidence, `$.topics[${index}].evidence_ids`);
  });
  candidate.claims.forEach((claim, index) => {
    assertReferences(claim.evidence_ids, evidence, `$.claims[${index}].evidence_ids`);
    if (claim.high_impact && claim.evidence_ids.length === 0) {
      fail("candidate_cross_field_invalid", "High-impact claims require evidence", [
        `$.claims[${index}].evidence_ids`,
      ]);
    }
  });
  candidate.evidence.forEach((item, index) =>
    assertEvidenceLocator(item, message, `$.evidence[${index}]`),
  );

  const profileFields = profileFieldIndex(modelInput.profile);
  const applicability = candidate.applicability;
  assertReferences(applicability.evidence_ids, evidence, "$.applicability.evidence_ids");
  if (applicability.applicability_claim_id !== null) {
    assertReferences(
      [applicability.applicability_claim_id],
      claims,
      "$.applicability.applicability_claim_id",
    );
  }
  assertProfileRefs(
    applicability.profile_field_refs,
    profileFields,
    "$.applicability.profile_field_refs",
  );
  assertUnique(applicability.gaps, "$.applicability.gaps");

  if (applicability.value === "applies") {
    if (applicability.applicability_claim_id === null || applicability.evidence_ids.length === 0) {
      fail("candidate_cross_field_invalid", "Applied applicability requires a claim and email evidence", [
        "$.applicability",
      ]);
    }
    if (PROFILE_REQUIRED_SCOPES.has(applicability.scope) && applicability.profile_field_refs.length === 0) {
      fail("candidate_cross_field_invalid", "This applicability scope requires profile evidence", [
        "$.applicability.profile_field_refs",
      ]);
    }
    for (const ref of applicability.profile_field_refs) {
      if (!isCurrentConfirmedProfileRef(ref, modelInput.current_time_hkt)) {
        fail("candidate_cross_field_invalid", "Applied profile evidence must be confirmed and current", [
          "$.applicability.profile_field_refs",
        ]);
      }
      if (applicability.scope === "confirmed_course" && ref.course_status !== "confirmed") {
        fail("candidate_cross_field_invalid", "confirmed_course must use a confirmed course profile", [
          "$.applicability.profile_field_refs",
        ]);
      }
    }
  }
  if (
    ["unknown", "possibly_applies"].includes(applicability.value) &&
    applicability.gaps.length === 0
  ) {
    fail("candidate_cross_field_invalid", "Uncertain applicability requires a stated gap", [
      "$.applicability.gaps",
    ]);
  }

  candidate.actions.forEach((action, index) => {
    const path = `$.actions[${index}]`;
    assertReferences(action.claim_refs, claims, `${path}.claim_refs`);
    assertReferences(action.condition_claim_refs, claims, `${path}.condition_claim_refs`);
    assertUnique(action.materials, `${path}.materials`);
    assertProfileRefs(action.condition_basis_refs, profileFields, `${path}.condition_basis_refs`);

    if (action.obligation === "conditional_mandatory") {
      if (
        action.condition === null ||
        action.condition_claim_refs.length === 0 ||
        action.condition_status === "not_applicable"
      ) {
        fail(
          "candidate_cross_field_invalid",
          "conditional_mandatory requires a condition, condition claim, and applicable status",
          [path],
        );
      }
      if (
        ["met", "unmet"].includes(action.condition_status) &&
        action.condition_basis_refs.length === 0
      ) {
        fail("candidate_cross_field_invalid", "met/unmet conditions require profile basis", [
          `${path}.condition_basis_refs`,
        ]);
      }
      if (
        ["met", "unmet"].includes(action.condition_status) &&
        action.condition_basis_refs.some(
          (ref) => !isCurrentConfirmedProfileRef(ref, modelInput.current_time_hkt),
        )
      ) {
        fail(
          "candidate_cross_field_invalid",
          "met/unmet conditions require confirmed and current profile basis",
          [`${path}.condition_basis_refs`],
        );
      }
    } else if (
      action.condition_status !== "not_applicable" ||
      action.condition !== null ||
      action.condition_claim_refs.length !== 0 ||
      action.condition_basis_refs.length !== 0
    ) {
      fail("candidate_cross_field_invalid", "Non-conditional obligations cannot carry condition state", [
        path,
      ]);
    }
  });

  candidate.management_suggestions.forEach((suggestion, index) => {
    const path = `$.management_suggestions[${index}]`;
    assertReferences(suggestion.claim_refs, claims, `${path}.claim_refs`);
    if (HIGH_RISK_SUGGESTION_PATTERN.test(suggestion.text)) {
      fail("candidate_forbidden_action", "Management suggestion exceeds the low-risk boundary", [path]);
    }
  });

  candidate.dates.forEach((date, index) => {
    const path = `$.dates[${index}]`;
    assertReferences([date.claim_id], claims, `${path}.claim_id`);
    assertReferences(date.evidence_ids, evidence, `${path}.evidence_ids`);
    assertRfc3339DateTime(date.normalized, date.timezone, `${path}.normalized`);
  });

  const historicalIds = new Map();
  for (const item of modelInput.historical_items ?? []) {
    if (!item || typeof item.item_id !== "string" || historicalIds.has(item.item_id)) {
      fail("candidate_context_invalid", "Model Input historical item IDs are invalid");
    }
    historicalIds.set(item.item_id, item);
  }
  candidate.key_changes.forEach((change, index) => {
    const path = `$.key_changes[${index}]`;
    if (change.old_value === null && change.new_value === null) {
      fail("candidate_cross_field_invalid", "Key change cannot have two null values", [path]);
    }
    assertReferences([change.claim_id], claims, `${path}.claim_id`);
    assertReferences(change.evidence_ids, evidence, `${path}.evidence_ids`);
    assertReferences(
      change.related_historical_item_ids,
      historicalIds,
      `${path}.related_historical_item_ids`,
    );
  });

  const consequence = candidate.consequence;
  if (consequence.claim_id !== null) {
    assertReferences([consequence.claim_id], claims, "$.consequence.claim_id");
  }
  assertReferences(consequence.evidence_ids, evidence, "$.consequence.evidence_ids");
  if (
    consequence.level !== "unknown" &&
    (consequence.claim_id === null || consequence.evidence_ids.length === 0)
  ) {
    fail("candidate_cross_field_invalid", "Known consequence requires a claim and evidence", [
      "$.consequence",
    ]);
  }

  candidate.security_risks.forEach((risk, index) => {
    const path = `$.security_risks[${index}]`;
    assertReferences([risk.claim_id], claims, `${path}.claim_id`);
    assertReferences(risk.evidence_ids, evidence, `${path}.evidence_ids`);
    if (CREDENTIAL_ADVICE_PATTERN.test(risk.verification_advice)) {
      fail("candidate_forbidden_action", "Security advice must not request credential disclosure", [
        `${path}.verification_advice`,
      ]);
    }
  });

  candidate.uncertainties.forEach((uncertainty, index) => {
    assertUnique(
      uncertainty.affected_candidate_fields,
      `$.uncertainties[${index}].affected_candidate_fields`,
    );
  });

  return candidate;
}
