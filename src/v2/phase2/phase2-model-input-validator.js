import { CORE_CANDIDATE_SCHEMA_VERSION } from "../contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import { canonicalJsonStringify } from "../validation/canonical-json.js";

export const PHASE2_MODEL_INPUT_PROJECTION_VERSION =
  "phase2-core-model-input-projection-v1";
export const PHASE2_TASK_TYPE = "analyze_school_notification_core";
export const PHASE2_TARGET_LANGUAGE = "zh-Hans";
export const PHASE2_MAX_MODEL_INPUT_UTF8_BYTES = 8_000;
export const PHASE2_ALLOWED_MESSAGE_LANGUAGES = Object.freeze([
  "en",
  "zh-Hant",
  "mixed",
  "zh-Hans",
]);
export const PHASE2_ALLOWED_PROFILE_FIELD_TYPES = Object.freeze([
  "school",
  "programme",
  "cohort",
  "term",
  "course",
  "residence",
  "immigration_status",
  "student_category",
]);

const MESSAGE_LANGUAGES = new Set(PHASE2_ALLOWED_MESSAGE_LANGUAGES);
const PROFILE_FIELD_TYPES = new Set(PHASE2_ALLOWED_PROFILE_FIELD_TYPES);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const URL_LIKE_PATTERN =
  /(?:[a-z][a-z0-9+.-]*:)?\/\/[^\s)\]}>'"]+|\bwww\.[^\s)\]}>'"]+|\bmailto:[^\s)\]}>'"]+/giu;
const DOMAIN_PATTERN =
  /[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,62}\.)+(?:[\p{L}]{2,63}|xn--[a-z0-9-]{2,59})/giu;
const EMAIL_LIKE_PATTERN =
  /[^\s<>()\[\]{}'"]+@([^\s<>()\[\]{}'",;]+)/giu;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/u;
const IPV6_PATTERN =
  /(?:^|[\s[(])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?=$|[\s)\]])/iu;
const LOCALHOST_PATTERN = /(?:^|[^\p{L}\p{N}-])localhost(?:$|[^\p{L}\p{N}-])/iu;
const NON_HTTPS_URI_SCHEME_PATTERN =
  /\b(?:http|ftp|file|mailto|data|javascript|ws|wss):/iu;
const SECRET_KEY_PATTERN =
  /^(?:authorization|api[_ -]?key|cookie|session[_ -]?secret|invite[_ -]?code)$/iu;
const SECRET_VALUE_PATTERN =
  /(?:\b(?:authorization|api[_ -]?key|cookie|session[_ -]?secret|invite[_ -]?code)\b\s*[:=]|\bbearer\s+[A-Za-z0-9._~-]{8,}|\bsk-[A-Za-z0-9_-]{8,}|\bDEEPSEEK_API_KEY\b)/iu;
const FORBIDDEN_KEYS = new Set([
  "expected",
  "oracle",
  "answer_key",
  "locked",
  "repair_feedback",
  "attachments",
  "from",
  "links",
  "provider_raw",
  "native_importance",
  "security_facts",
  "incoming_disposition",
  "protection_result",
  "source_truth_id",
  "source_status",
  "source",
  "confirmation_status",
  "valid_until",
  "course_status",
  "home_section",
  "notification_channel",
  "calendar_candidate",
  "calendar_eligible",
  "read_status",
  "management_status",
  "item_status",
  "version_status",
  "visibility_status",
  "due_status",
  "fact_states",
  "resulting_item",
  "tool_calls",
  "tools",
]);

export class Phase2ModelInputValidationError extends Error {
  constructor(code, message, jsonPaths = []) {
    super(message);
    this.name = "Phase2ModelInputValidationError";
    this.code = code;
    this.jsonPaths = Object.freeze([...new Set(jsonPaths)].slice(0, 8));
  }
}

function fail(code, message, jsonPaths = []) {
  throw new Phase2ModelInputValidationError(code, message, jsonPaths);
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

function scanTree(value, path = "$") {
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERN.test(value)) {
      fail(
        "phase2_input_secret_detected",
        "Phase 2 Model Input contains secret-like material",
        [path],
      );
    }
    return;
  }
  if (value === null || typeof value !== "object") return;

  for (const key of Object.keys(value)) {
    const keyPath = childPath(path, key);
    if (SECRET_KEY_PATTERN.test(key)) {
      fail(
        "phase2_input_secret_detected",
        "Phase 2 Model Input contains a secret-bearing field",
        [keyPath],
      );
    }
    if (FORBIDDEN_KEYS.has(key)) {
      fail(
        "phase2_input_forbidden_field",
        `Phase 2 Model Input contains forbidden field: ${key}`,
        [keyPath],
      );
    }
    scanTree(value[key], keyPath);
  }
}

function assertSyntheticNetworkText(value, path) {
  if (
    IPV4_PATTERN.test(value) ||
    IPV6_PATTERN.test(value) ||
    LOCALHOST_PATTERN.test(value)
  ) {
    fail(
      "phase2_input_network_invalid",
      "Phase 2 Model Input contains a non-synthetic host identifier",
      [path],
    );
  }

  if (NON_HTTPS_URI_SCHEME_PATTERN.test(value)) {
    fail(
      "phase2_input_network_invalid",
      "Phase 2 Model Input contains a non-HTTPS URI scheme",
      [path],
    );
  }

  for (const token of value.match(URL_LIKE_PATTERN) ?? []) {
    let url;
    try {
      url = new URL(token);
    } catch {
      fail(
        "phase2_input_network_invalid",
        "Phase 2 Model Input contains an invalid URL-like value",
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
        "phase2_input_network_invalid",
        "Phase 2 Model Input network identifiers must use private .invalid HTTPS URLs",
        [path],
      );
    }
  }

  for (const match of value.matchAll(EMAIL_LIKE_PATTERN)) {
    const hostname = match[1].replace(/[.!?。！？]+$/u, "").toLowerCase();
    if (!/^[a-z0-9.-]+$/u.test(hostname) || !hostname.endsWith(".invalid")) {
      fail(
        "phase2_input_network_invalid",
        "Phase 2 Model Input email identifiers must use a private .invalid domain",
        [path],
      );
    }
  }

  for (const domain of value.match(DOMAIN_PATTERN) ?? []) {
    if (!domain.toLowerCase().endsWith(".invalid")) {
      fail(
        "phase2_input_network_invalid",
        "Phase 2 Model Input contains a non-synthetic domain",
        [path],
      );
    }
  }
}

function assertBoundedString(value, path, maxLength) {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    fail(
      "phase2_input_invalid",
      `${path} must be a non-empty bounded string`,
      [path],
    );
  }
}

/**
 * Validate the exact multi-case Phase 2 Core Model Input. The function only
 * accepts the value; it never maps, sorts, clones, repairs, or mutates it.
 */
export function validatePhase2ModelInput(modelInput) {
  let serialized;
  try {
    serialized = canonicalJsonStringify(modelInput);
  } catch {
    fail(
      "phase2_input_invalid",
      "Phase 2 Model Input must be an acyclic JSON-compatible value",
    );
  }

  if (Buffer.byteLength(serialized, "utf8") > PHASE2_MAX_MODEL_INPUT_UTF8_BYTES) {
    fail(
      "phase2_input_too_large",
      "Phase 2 Model Input exceeds the approved UTF-8 byte budget",
    );
  }

  scanTree(modelInput);

  if (
    !hasExactKeys(modelInput, [
      "task_type",
      "target_language",
      "candidate_schema_version",
      "message",
      "profile_refs",
    ]) ||
    modelInput.task_type !== PHASE2_TASK_TYPE ||
    modelInput.target_language !== PHASE2_TARGET_LANGUAGE ||
    modelInput.candidate_schema_version !== CORE_CANDIDATE_SCHEMA_VERSION
  ) {
    fail(
      "phase2_input_invalid",
      "Phase 2 Model Input envelope is invalid",
      ["$"],
    );
  }

  const message = modelInput.message;
  if (!hasExactKeys(message, ["subject", "language", "body"])) {
    fail(
      "phase2_input_invalid",
      "Phase 2 Model Input message envelope is invalid",
      ["$.message"],
    );
  }
  assertBoundedString(message.subject, "$.message.subject", 500);
  assertBoundedString(message.body, "$.message.body", 50_000);
  if (!MESSAGE_LANGUAGES.has(message.language)) {
    fail(
      "phase2_input_invalid",
      "Phase 2 Model Input message.language is invalid",
      ["$.message.language"],
    );
  }
  assertSyntheticNetworkText(message.subject, "$.message.subject");
  assertSyntheticNetworkText(message.body, "$.message.body");

  if (
    !Array.isArray(modelInput.profile_refs) ||
    modelInput.profile_refs.length < 1 ||
    modelInput.profile_refs.length > 8
  ) {
    fail(
      "phase2_input_invalid",
      "Phase 2 Model Input profile_refs must contain 1 to 8 items",
      ["$.profile_refs"],
    );
  }

  const profileIds = new Set();
  for (let index = 0; index < modelInput.profile_refs.length; index += 1) {
    const path = `$.profile_refs[${index}]`;
    const ref = modelInput.profile_refs[index];
    if (!hasExactKeys(ref, ["profile_field_id", "field_type", "value"])) {
      fail(
        "phase2_input_invalid",
        "Phase 2 Model Input profile ref envelope is invalid",
        [path],
      );
    }
    if (
      typeof ref.profile_field_id !== "string" ||
      !ID_PATTERN.test(ref.profile_field_id) ||
      profileIds.has(ref.profile_field_id)
    ) {
      fail(
        "phase2_input_invalid",
        "Phase 2 Model Input profile_field_id is invalid or duplicated",
        [`${path}.profile_field_id`],
      );
    }
    if (!PROFILE_FIELD_TYPES.has(ref.field_type)) {
      fail(
        "phase2_input_invalid",
        "Phase 2 Model Input profile field_type is not allowed",
        [`${path}.field_type`],
      );
    }
    assertBoundedString(ref.value, `${path}.value`, 200);
    assertSyntheticNetworkText(ref.value, `${path}.value`);
    profileIds.add(ref.profile_field_id);
  }

  return modelInput;
}
