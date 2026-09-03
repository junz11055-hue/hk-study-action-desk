import Ajv2020 from "ajv/dist/2020.js";

import {
  CORE_CANDIDATE_SCHEMA_VERSION,
  NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
} from "../contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import { canonicalJsonStringify } from "./canonical-json.js";

const CORE_TASK_TYPE = "analyze_school_notification_core";
const CORE_TARGET_LANGUAGE = "zh-Hans";
const CORE_SOURCE_LANGUAGE = "en";
export const CORE_MAX_MODEL_INPUT_UTF8_BYTES = 2_200;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const HAN_PATTERN = /\p{Script=Han}/u;
const URL_LIKE_PATTERN =
  /(?:[a-z][a-z0-9+.-]*:)?\/\/[^\s)\]}>'"]+|\bwww\.[^\s)\]}>'"]+|\bmailto:[^\s)\]}>'"]+/giu;
const DOMAIN_PATTERN =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})\b/giu;
const NON_HTTPS_URI_SCHEME_PATTERN =
  /\b(?:http|ftp|file|mailto|data|javascript|ws|wss):/iu;
const PROFILE_REQUIRED_SCOPES = new Set([
  "current_user",
  "confirmed_course",
  "programme",
  "cohort",
  "department",
]);

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

const SECRET_KEY_PATTERN =
  /^(?:authorization|api[_ -]?key|cookie|session[_ -]?secret|invite[_ -]?code)$/iu;
const SECRET_VALUE_PATTERN =
  /(?:\b(?:authorization|api[_ -]?key|cookie|session[_ -]?secret|invite[_ -]?code)\b\s*[:=]|\bbearer\s+[A-Za-z0-9._~-]{8,}|\bsk-[A-Za-z0-9_-]{8,}|\bDEEPSEEK_API_KEY\b)/iu;
const EXTERNAL_SUCCESS_PATTERN =
  /(?:(?:我|本助手|AI|系统)(?:已(?:经)?|成功).{0,16}(?:付款|支付|缴费|回复|提交|注册|写入(?:了)?日历|同步(?:到|了)?日历|发送(?:了)?通知)|(?:已(?:经)?|成功).{0,8}(?:替|为|帮)(?:用户|你|您).{0,12}(?:付款|支付|缴费|回复|提交|注册|写入(?:了)?日历|同步(?:到|了)?日历|发送(?:了)?通知)|(?:I|we|the assistant|the system) (?:have |has )?(?:already |successfully )?(?:paid|replied|submitted|registered|added.{0,12}calendar|sent.{0,12}notification) (?:for )?(?:you|the user))/iu;

const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateSchema = ajv.compile(
  NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
);

export class CoreCandidateValidationError extends Error {
  constructor(code, message, jsonPaths = []) {
    super(message);
    this.name = "CoreCandidateValidationError";
    this.code = code;
    this.jsonPaths = Object.freeze([...new Set(jsonPaths)].slice(0, 8));
  }
}

function fail(code, message, jsonPaths = []) {
  throw new CoreCandidateValidationError(code, message, jsonPaths);
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function childPath(parent, key) {
  return typeof key === "number" ? `${parent}[${key}]` : `${parent}.${key}`;
}

function scanCandidateTree(value, path = "$", ancestors = new WeakSet()) {
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERN.test(value)) {
      fail(
        "candidate_secret_detected",
        "Core Candidate contains secret-like material",
        [path],
      );
    }
    if (EXTERNAL_SUCCESS_PATTERN.test(value)) {
      fail(
        "candidate_external_action_claim",
        "Core Candidate claims an external action was completed",
        [path],
      );
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (ancestors.has(value)) {
    fail(
      "candidate_schema_invalid",
      "Core Candidate must be an acyclic JSON value",
      [path],
    );
  }

  ancestors.add(value);
  for (const key of Object.keys(value)) {
    const keyPath = childPath(path, key);
    if (FORBIDDEN_KEYS.has(key)) {
      fail(
        "candidate_forbidden_field",
        `Core Candidate contains forbidden field: ${key}`,
        [keyPath],
      );
    }
    if (SECRET_KEY_PATTERN.test(key)) {
      fail(
        "candidate_secret_detected",
        "Core Candidate contains a secret-bearing field",
        [keyPath],
      );
    }
    scanCandidateTree(value[key], keyPath, ancestors);
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
          /^\d+$/.test(part) ? `${path}[${part}]` : `${path}.${part}`,
        "$",
      );
  };

  return (errors ?? []).map((error) => {
    const path = pointerToJsonPath(error.instancePath);
    if (
      error.keyword === "additionalProperties" &&
      error.params?.additionalProperty
    ) {
      return `${path}.${error.params.additionalProperty}`;
    }
    return path;
  });
}

function assertUnique(values, path) {
  if (new Set(values).size !== values.length) {
    fail(
      "candidate_reference_invalid",
      `${path} must not contain duplicates`,
      [path],
    );
  }
}

function assertSyntheticNetworkText(value, path) {
  if (NON_HTTPS_URI_SCHEME_PATTERN.test(value)) {
    fail(
      "candidate_context_invalid",
      "Core Model Input contains a non-HTTPS URI scheme",
      [path],
    );
  }
  for (const token of value.match(URL_LIKE_PATTERN) ?? []) {
    let url;
    try {
      url = new URL(token);
    } catch {
      fail(
        "candidate_context_invalid",
        "Core Model Input contains an invalid or non-HTTPS URL-like value",
        [path],
      );
    }
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      !url.hostname.endsWith(".invalid")
    ) {
      fail(
        "candidate_context_invalid",
        "Core Model Input network identifiers must use private .invalid HTTPS URLs",
        [path],
      );
    }
  }

  for (const domain of value.match(DOMAIN_PATTERN) ?? []) {
    if (!domain.toLowerCase().endsWith(".invalid")) {
      fail(
        "candidate_context_invalid",
        "Core Model Input contains a non-synthetic domain",
        [path],
      );
    }
  }
}

function indexUnique(items, idKey, path) {
  const indexed = new Map();
  for (let index = 0; index < items.length; index += 1) {
    const id = items[index][idKey];
    if (indexed.has(id)) {
      fail(
        "candidate_reference_invalid",
        `${path} contains duplicate ID: ${id}`,
        [`${path}[${index}].${idKey}`],
      );
    }
    indexed.set(id, items[index]);
  }
  return indexed;
}

function assertReferences(values, target, path) {
  assertUnique(values, path);
  if (values.some((value) => !target.has(value))) {
    fail(
      "candidate_reference_invalid",
      `${path} contains an unknown reference`,
      [path],
    );
  }
}

function validatedModelInputContext(modelInput) {
  let serializedInput;
  try {
    serializedInput = canonicalJsonStringify(modelInput);
  } catch {
    fail(
      "candidate_context_invalid",
      "Core Model Input must be a JSON-compatible value",
    );
  }
  if (Buffer.byteLength(serializedInput, "utf8") > CORE_MAX_MODEL_INPUT_UTF8_BYTES) {
    fail(
      "candidate_context_invalid",
      "Core Model Input exceeds the approved UTF-8 byte budget",
    );
  }

  if (
    !hasExactKeys(modelInput, [
      "task_type",
      "target_language",
      "candidate_schema_version",
      "message",
      "profile_refs",
    ]) ||
    modelInput.task_type !== CORE_TASK_TYPE ||
    modelInput.target_language !== CORE_TARGET_LANGUAGE ||
    modelInput.candidate_schema_version !== CORE_CANDIDATE_SCHEMA_VERSION
  ) {
    fail("candidate_context_invalid", "Core Model Input envelope is invalid");
  }

  const message = modelInput.message;
  if (
    !hasExactKeys(message, ["subject", "language", "body"]) ||
    typeof message.subject !== "string" ||
    message.subject.length < 1 ||
    message.subject.length > 500 ||
    message.language !== CORE_SOURCE_LANGUAGE ||
    typeof message.body !== "string" ||
    message.body.length < 1 ||
    message.body.length > 50_000 ||
    !Array.isArray(modelInput.profile_refs) ||
    modelInput.profile_refs.length !== 1
  ) {
    fail("candidate_context_invalid", "Core Model Input message is invalid");
  }
  assertSyntheticNetworkText(message.subject, "$.message.subject");
  assertSyntheticNetworkText(message.body, "$.message.body");

  const profileRefs = new Map();
  for (let index = 0; index < modelInput.profile_refs.length; index += 1) {
    const ref = modelInput.profile_refs[index];
    if (
      !hasExactKeys(ref, ["profile_field_id", "field_type", "value"]) ||
      typeof ref.profile_field_id !== "string" ||
      !ID_PATTERN.test(ref.profile_field_id) ||
      ref.field_type !== "course" ||
      typeof ref.value !== "string" ||
      ref.value.length < 1 ||
      ref.value.length > 200 ||
      profileRefs.has(ref.profile_field_id)
    ) {
      fail(
        "candidate_context_invalid",
        "Core Model Input profile_refs are invalid",
        [`$.profile_refs[${index}]`],
      );
    }
    assertSyntheticNetworkText(ref.value, `$.profile_refs[${index}].value`);
    profileRefs.set(ref.profile_field_id, ref);
  }
  return { message, profileRefs };
}

/** Validate the exact Core v2 Model Input before any provider transport. */
export function validateCoreModelInput(modelInput) {
  validatedModelInputContext(modelInput);
  return modelInput;
}

function assertHan(value, path) {
  if (!HAN_PATTERN.test(value)) {
    fail(
      "candidate_language_invalid",
      "Core Candidate Chinese fields must contain at least one Han character",
      [path],
    );
  }
}

function assertCoreCandidateChineseMinimum(candidate) {
  assertHan(candidate.title_zh, "$.title_zh");
  assertHan(candidate.summary_zh, "$.summary_zh");
  candidate.topics.forEach((topic, index) =>
    assertHan(topic.label, `$.topics[${index}].label`),
  );
  assertHan(candidate.applicability.reason_zh, "$.applicability.reason_zh");
  candidate.claims.forEach((claim, index) =>
    assertHan(claim.text_zh, `$.claims[${index}].text_zh`),
  );
  candidate.actions.forEach((action, index) => {
    assertHan(action.actor_zh, `$.actions[${index}].actor_zh`);
    assertHan(action.verb_zh, `$.actions[${index}].verb_zh`);
    assertHan(action.object_zh, `$.actions[${index}].object_zh`);
  });
  assertHan(candidate.consequence.reason_zh, "$.consequence.reason_zh");
}

function locateUniqueBodyQuote(quote, body, path) {
  const start = body.indexOf(quote);
  if (start === -1) {
    fail(
      "candidate_evidence_invalid",
      "Evidence quote is not an exact message.body substring",
      [path],
    );
  }
  if (body.indexOf(quote, start + 1) !== -1) {
    fail(
      "candidate_evidence_invalid",
      "Evidence quote must occur exactly once in message.body",
      [path],
    );
  }
  return { start, end: start + quote.length };
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function assertCoreCandidateSafeStructure(candidate) {
  scanCandidateTree(candidate);
  if (!validateSchema(candidate)) {
    fail(
      "candidate_schema_invalid",
      "Core Candidate does not match notification-analysis-core-candidate-p1-v2",
      schemaErrorPaths(validateSchema.errors),
    );
  }
  assertCoreCandidateChineseMinimum(candidate);
  return candidate;
}

function validateAndDerive(candidate, modelInput) {
  assertCoreCandidateSafeStructure(candidate);

  const { message, profileRefs } = validatedModelInputContext(modelInput);
  const claims = indexUnique(candidate.claims, "claim_id", "$.claims");
  const evidence = indexUnique(candidate.evidence, "evidence_id", "$.evidence");
  indexUnique(candidate.actions, "action_id", "$.actions");
  indexUnique(candidate.deadlines, "deadline_id", "$.deadlines");
  assertUnique(
    candidate.topics.map((topic) => topic.label),
    "$.topics",
  );

  assertReferences(candidate.title_claim_refs, claims, "$.title_claim_refs");
  assertReferences(candidate.summary_claim_refs, claims, "$.summary_claim_refs");
  candidate.topics.forEach((topic, index) =>
    assertReferences(topic.claim_refs, claims, `$.topics[${index}].claim_refs`),
  );
  candidate.claims.forEach((claim, index) =>
    assertReferences(
      claim.evidence_refs,
      evidence,
      `$.claims[${index}].evidence_refs`,
    ),
  );

  const bodyEvidenceLocations = candidate.evidence.map((item, index) => {
    const location = locateUniqueBodyQuote(
      item.quote,
      message.body,
      `$.evidence[${index}].quote`,
    );
    return {
      evidence_id: item.evidence_id,
      source: "body",
      locator: {
        kind: "utf16_range",
        start: location.start,
        end: location.end,
      },
    };
  });

  const applicability = candidate.applicability;
  if (applicability.claim_ref !== null) {
    assertReferences(
      [applicability.claim_ref],
      claims,
      "$.applicability.claim_ref",
    );
  }
  assertReferences(
    applicability.profile_field_ids,
    profileRefs,
    "$.applicability.profile_field_ids",
  );
  if (applicability.value === "applies") {
    if (applicability.claim_ref === null) {
      fail(
        "candidate_reference_invalid",
        "Applicable Core Candidate requires a supporting Claim",
        ["$.applicability.claim_ref"],
      );
    }
    if (
      PROFILE_REQUIRED_SCOPES.has(applicability.scope) &&
      applicability.profile_field_ids.length === 0
    ) {
      fail(
        "candidate_reference_invalid",
        "Applicable profile scope requires a projected profile reference",
        ["$.applicability.profile_field_ids"],
      );
    }
  }
  if (
    (applicability.scope === "not_applicable") !==
    (applicability.value === "not_applicable")
  ) {
    fail(
      "candidate_reference_invalid",
      "not_applicable scope and value must agree",
      ["$.applicability.scope", "$.applicability.value"],
    );
  }

  candidate.actions.forEach((action, index) =>
    assertReferences(action.claim_refs, claims, `$.actions[${index}].claim_refs`),
  );

  candidate.deadlines.forEach((deadline, index) => {
    const path = `$.deadlines[${index}]`;
    assertReferences([deadline.claim_ref], claims, `${path}.claim_ref`);
    const claim = claims.get(deadline.claim_ref);
    const supported = claim.evidence_refs.some((evidenceId) =>
      evidence.get(evidenceId).quote.includes(deadline.original_text),
    );
    if (!supported) {
      fail(
        "candidate_evidence_invalid",
        "Deadline original_text is not supported by its Claim evidence",
        [`${path}.original_text`, `${path}.claim_ref`],
      );
    }
  });

  if (candidate.consequence.claim_ref !== null) {
    assertReferences(
      [candidate.consequence.claim_ref],
      claims,
      "$.consequence.claim_ref",
    );
  } else if (candidate.consequence.level !== "unknown") {
    fail(
      "candidate_reference_invalid",
      "A known consequence level requires a supporting Claim",
      ["$.consequence.claim_ref"],
    );
  }

  return deepFreeze({
    body_evidence_locations: bodyEvidenceLocations,
    profile_ref_matches: applicability.profile_field_ids.map((id) => ({
      profile_field_id: id,
      field_type: profileRefs.get(id).field_type,
      value: profileRefs.get(id).value,
    })),
  });
}

/**
 * Validate a Core Candidate without mapping, repairing, sorting, cloning, or
 * changing it. Acceptance returns the exact object identity supplied by the model.
 */
export function validateCoreCandidate(candidate, modelInput) {
  validateAndDerive(candidate, modelInput);
  return candidate;
}

/** Return deterministic Harness evidence without writing it into Candidate. */
export function deriveCoreValidationEvidence(candidate, modelInput) {
  return validateAndDerive(candidate, modelInput);
}
