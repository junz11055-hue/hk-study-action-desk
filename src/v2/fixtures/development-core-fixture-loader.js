import { readFile } from "node:fs/promises";

import { CORE_CANDIDATE_SCHEMA_VERSION } from "../contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import { validateCoreModelInput } from "../validation/core-candidate-validator.js";

export const CORE_ALLOWED_CASE_ID = "DEV001";
export const CORE_DATASET_SPLIT = "development";
export const CORE_TASK_TYPE = "analyze_school_notification_core";
export const CORE_TARGET_LANGUAGE = "zh-Hans";
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const URL_LIKE_PATTERN =
  /(?:[a-z][a-z0-9+.-]*:)?\/\/[^\s)\]}>'"]+|\bwww\.[^\s)\]}>'"]+|\bmailto:[^\s)\]}>'"]+/giu;
const DOMAIN_PATTERN =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})\b/giu;
const NON_HTTPS_URI_SCHEME_PATTERN =
  /\b(?:http|ftp|file|mailto|data|javascript|ws|wss):/iu;
const SECRET_LIKE_PATTERN =
  /(?:\b(?:authorization|api[_ -]?key|cookie|session[_ -]?secret|invite[_ -]?code)\b\s*[:=]|\bbearer\s+[A-Za-z0-9._~-]{8,}|\bsk-[A-Za-z0-9_-]{8,}|\bDEEPSEEK_API_KEY\b)/iu;
export const CORE_DEVELOPMENT_FIXTURE_URL = new URL(
  "../../../docs/fixtures/prd-v0.2/base-development.json",
  import.meta.url,
);

export class CoreDevelopmentFixtureError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CoreDevelopmentFixtureError";
    this.code = code;
  }
}

function failFixture(message) {
  throw new CoreDevelopmentFixtureError("fixture_invalid", message);
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

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) failFixture(`${label} must be an object`);
}

function assertBoundedString(value, label, maxLength) {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    failFixture(`${label} must be a non-empty bounded string`);
  }
}

function cloneJson(value) {
  return structuredClone(value);
}

function containsKey(value, prohibitedKey) {
  if (Array.isArray(value)) {
    return value.some((item) => containsKey(item, prohibitedKey));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).some(
      ([key, child]) =>
        key === prohibitedKey || containsKey(child, prohibitedKey),
    );
  }
  return false;
}

function assertSyntheticText(value, label) {
  if (SECRET_LIKE_PATTERN.test(value)) {
    failFixture(`${label} must not contain secret-like material`);
  }
  if (NON_HTTPS_URI_SCHEME_PATTERN.test(value)) {
    failFixture(`${label} must not contain non-HTTPS URI schemes`);
  }
  for (const rawUrl of value.match(URL_LIKE_PATTERN) ?? []) {
    try {
      const url = new URL(rawUrl);
      if (
        url.protocol !== "https:" ||
        url.username !== "" ||
        url.password !== "" ||
        url.port !== "" ||
        !url.hostname.endsWith(".invalid")
      ) {
        throw new Error("not a synthetic URL");
      }
    } catch {
      failFixture(`${label} URLs must use private .invalid HTTPS domains`);
    }
  }
  for (const domain of value.match(DOMAIN_PATTERN) ?? []) {
    if (!domain.toLowerCase().endsWith(".invalid")) {
      failFixture(`${label} must not contain real domains`);
    }
  }
}

function isValidDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value ?? "");
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function currentFixtureDate(fixture) {
  const value = fixture?.harness_context?.current_time_hkt;
  const match =
    typeof value === "string"
      ? /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?\+08:00$/u.exec(
          value,
        )
      : null;
  if (!match) {
    failFixture("harness_context.current_time_hkt must be a valid +08:00 timestamp");
  }
  const [, dateText, hourText, minuteText, secondText] = match;
  if (
    !isValidDateOnly(dateText) ||
    Number(hourText) > 23 ||
    Number(minuteText) > 59 ||
    Number(secondText) > 59 ||
    Number.isNaN(Date.parse(value))
  ) {
    failFixture("harness_context.current_time_hkt must be a valid +08:00 timestamp");
  }
  return dateText;
}

function selectNecessaryCourse(fixture, message) {
  const courses = fixture.input.profile.courses;
  if (!Array.isArray(courses)) failFixture("input.profile.courses must be an array");

  const currentDate = currentFixtureDate(fixture);
  const messageText = `${message.subject}\n${message.body}`;
  const matching = courses.filter((course) => {
    if (!isPlainObject(course)) return false;
    return (
      typeof course.code === "string" &&
      course.code.length > 0 &&
      messageText.includes(course.code) &&
      course.status === "confirmed" &&
      course.confirmation_status === "confirmed" &&
      typeof course.valid_until === "string" &&
      isValidDateOnly(course.valid_until) &&
      course.valid_until >= currentDate
    );
  });

  if (matching.length !== 1) {
    failFixture("DEV001 must resolve to exactly one current confirmed course");
  }

  const course = matching[0];
  assertBoundedString(course.profile_field_id, "course.profile_field_id", 64);
  if (!ID_PATTERN.test(course.profile_field_id)) {
    failFixture("course.profile_field_id is invalid");
  }
  assertBoundedString(course.code, "course.code", 80);
  assertBoundedString(course.name, "course.name", 120);
  assertBoundedString(course.source, "course.source", 200);
  if (course.source !== "synthetic_user_confirmed") {
    failFixture("course.source must be the approved synthetic source");
  }
  assertSyntheticText(course.code, "course.code");
  assertSyntheticText(course.name, "course.name");
  return course;
}

function assertFixtureShape(fixture) {
  assertPlainObject(fixture, "fixture");
  if (fixture.case_id !== CORE_ALLOWED_CASE_ID) {
    failFixture("fixture case_id mismatch");
  }
  if (fixture.dataset_split !== CORE_DATASET_SPLIT) {
    failFixture("fixture must belong to the development split");
  }
  assertPlainObject(fixture.input, "fixture.input");
  assertPlainObject(fixture.input.profile, "fixture.input.profile");
  assertPlainObject(fixture.input.message, "fixture.input.message");
  assertPlainObject(fixture.harness_context, "fixture.harness_context");
  if (fixture.harness_context.timezone !== "Asia/Hong_Kong") {
    failFixture("harness_context.timezone must be Asia/Hong_Kong");
  }

  const message = fixture.input.message;
  assertBoundedString(message.subject, "input.message.subject", 500);
  assertBoundedString(message.language, "input.message.language", 32);
  assertBoundedString(message.body, "input.message.body", 50_000);
  if (!Array.isArray(message.attachments) || message.attachments.length !== 0) {
    failFixture("DEV001 Core input must not contain attachments");
  }
  if (message.language !== "en") {
    failFixture("DEV001 message.language must be en");
  }
  assertSyntheticText(message.subject, "message.subject");
  assertSyntheticText(message.body, "message.body");
}

function buildCoreProjection(fixture) {
  assertFixtureShape(fixture);
  const sourceMessage = fixture.input.message;
  const message = {
    subject: sourceMessage.subject,
    language: sourceMessage.language,
    body: sourceMessage.body,
  };
  const course = selectNecessaryCourse(fixture, message);

  const profileRef = {
    profile_field_id: course.profile_field_id,
    field_type: "course",
    value: `${course.code} | ${course.name}`,
  };
  assertBoundedString(profileRef.value, "profile_ref.value", 200);
  const modelInput = {
    task_type: CORE_TASK_TYPE,
    target_language: CORE_TARGET_LANGUAGE,
    candidate_schema_version: CORE_CANDIDATE_SCHEMA_VERSION,
    message,
    profile_refs: [profileRef],
  };

  if (containsKey(modelInput, "expected")) {
    failFixture("Core Model Input must not contain expected data");
  }
  try {
    validateCoreModelInput(modelInput);
  } catch {
    failFixture("Core Model Input projection is invalid");
  }
  return {
    modelInput,
    trustedProfileEvidence: [
      {
        ...profileRef,
        source: course.source,
        confirmation_status: course.confirmation_status,
        valid_until: course.valid_until,
        course_status: course.status,
      },
    ],
  };
}

/** Project the fixed DEV001 source into the exact approved Core v2 Model Input. */
export function projectDevelopmentCoreFixture(fixture) {
  return buildCoreProjection(fixture).modelInput;
}

/** Load only base-development.json, select only DEV001, and return no answer key. */
export async function loadDevelopmentCoreFixture({
  caseId,
  readFileImpl = readFile,
} = {}) {
  if (caseId !== CORE_ALLOWED_CASE_ID) {
    throw new CoreDevelopmentFixtureError(
      "fixture_not_allowed",
      "Core Phase 1 only allows DEV001",
    );
  }
  if (typeof readFileImpl !== "function") {
    throw new TypeError("readFileImpl must be a function");
  }

  let parsed;
  try {
    const source = await readFileImpl(CORE_DEVELOPMENT_FIXTURE_URL, "utf8");
    parsed = JSON.parse(source);
  } catch (error) {
    if (error instanceof CoreDevelopmentFixtureError) throw error;
    throw new CoreDevelopmentFixtureError(
      "fixture_invalid",
      "development fixture could not be read or parsed",
    );
  }

  if (!Array.isArray(parsed)) failFixture("development fixture root must be an array");
  const matches = parsed.filter((fixture) => fixture?.case_id === caseId);
  if (matches.length !== 1) failFixture("DEV001 must appear exactly once");

  const fixture = matches[0];
  const { modelInput, trustedProfileEvidence } = buildCoreProjection(fixture);
  const fixtureInput = {
    message: cloneJson(modelInput.message),
    profile_refs: cloneJson(modelInput.profile_refs),
  };
  return {
    caseId: fixture.case_id,
    datasetSplit: fixture.dataset_split,
    fixtureInput,
    modelInput,
    trustedProfileEvidence,
  };
}
