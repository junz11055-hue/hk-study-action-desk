import { readFile } from "node:fs/promises";

import { CORE_CANDIDATE_SCHEMA_VERSION } from "../contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import { hashCanonicalJson } from "../validation/canonical-json.js";
import {
  PHASE2_DATASET_SPLIT,
  PHASE2_DEVELOPMENT_CASE_IDS,
  PHASE2_DEVELOPMENT_SNAPSHOT_VERSION,
  Phase2DevelopmentInputError,
} from "./development-input-loader.js";
import {
  PHASE2_MODEL_INPUT_PROJECTION_VERSION,
  PHASE2_TARGET_LANGUAGE,
  PHASE2_TASK_TYPE,
  validatePhase2ModelInput,
} from "./phase2-model-input-validator.js";

export const PHASE2_DEVELOPMENT_SOURCE_URL = new URL(
  "../../../docs/fixtures/prd-v0.2/base-development.json",
  import.meta.url,
);

const ALLOWED_CASE_IDS = new Set(PHASE2_DEVELOPMENT_CASE_IDS);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const SYNTHETIC_SOURCE_PATTERN = /^synthetic_[a-z0-9_]{1,79}$/u;
const SECRET_LIKE_PATTERN =
  /(?:\b(?:authorization|api[_ -]?key|cookie|session[_ -]?secret|invite[_ -]?code)\b\s*[:=]|\bbearer\s+[A-Za-z0-9._~-]{8,}|\bsk-[A-Za-z0-9_-]{8,}|\bDEEPSEEK_API_KEY\b)/iu;
const SCALAR_PROFILE_FIELDS = Object.freeze([
  Object.freeze({ sourceKey: "school", fieldType: "school" }),
  Object.freeze({ sourceKey: "project", fieldType: "programme" }),
  Object.freeze({ sourceKey: "cohort", fieldType: "cohort" }),
  Object.freeze({ sourceKey: "term", fieldType: "term" }),
]);
const OPTIONAL_SCALAR_PROFILE_FIELDS = Object.freeze([
  Object.freeze({ sourceKey: "residence", fieldType: "residence" }),
  Object.freeze({
    sourceKey: "immigration_status",
    fieldType: "immigration_status",
  }),
  Object.freeze({
    sourceKey: "student_category",
    fieldType: "student_category",
  }),
]);
const CONFIRMATION_STATUSES = new Set([
  "confirmed",
  "candidate",
  "unconfirmed",
]);
const COURSE_STATUSES = new Set([
  "confirmed",
  "candidate",
  "removed",
  "expired",
]);

function failFixture(message) {
  throw new Phase2DevelopmentInputError("fixture_invalid", message);
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
  if (SECRET_LIKE_PATTERN.test(value)) {
    failFixture(`${label} must not contain secret-like material`);
  }
}

function isValidDateOnly(value) {
  const match = DATE_ONLY_PATTERN.exec(value ?? "");
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
  if (fixture.harness_context.timezone !== "Asia/Hong_Kong") {
    failFixture("harness_context.timezone must be Asia/Hong_Kong");
  }
  const value = fixture.harness_context.current_time_hkt;
  const match =
    typeof value === "string"
      ? /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?\+08:00$/u.exec(
          value,
        )
      : null;
  if (!match) {
    failFixture(
      "harness_context.current_time_hkt must be a valid +08:00 timestamp",
    );
  }
  const [, dateText, hourText, minuteText, secondText] = match;
  if (
    !isValidDateOnly(dateText) ||
    Number(hourText) > 23 ||
    Number(minuteText) > 59 ||
    Number(secondText) > 59 ||
    Number.isNaN(Date.parse(value))
  ) {
    failFixture(
      "harness_context.current_time_hkt must be a valid +08:00 timestamp",
    );
  }
  return dateText;
}

function assertSourceMetadata(field, label) {
  assertPlainObject(field, label);
  assertBoundedString(field.profile_field_id, `${label}.profile_field_id`, 64);
  if (!ID_PATTERN.test(field.profile_field_id)) {
    failFixture(`${label}.profile_field_id is invalid`);
  }
  assertBoundedString(field.source, `${label}.source`, 80);
  if (!SYNTHETIC_SOURCE_PATTERN.test(field.source)) {
    failFixture(`${label}.source must be synthetic`);
  }
  if (!CONFIRMATION_STATUSES.has(field.confirmation_status)) {
    failFixture(`${label}.confirmation_status is invalid`);
  }
  if (!isValidDateOnly(field.valid_until)) {
    failFixture(`${label}.valid_until must be a valid date`);
  }
}

function aliasesFor(field, label) {
  if (field.aliases === undefined) return [];
  if (!Array.isArray(field.aliases) || field.aliases.length > 8) {
    failFixture(`${label}.aliases must be an array with at most 8 items`);
  }
  const aliases = field.aliases.map((alias, index) => {
    assertBoundedString(alias, `${label}.aliases[${index}]`, 80);
    return alias;
  });
  if (new Set(aliases).size !== aliases.length) {
    failFixture(`${label}.aliases must be unique`);
  }
  return aliases;
}

function appendAliases(value, aliases, label) {
  const projected =
    aliases.length === 0 ? value : `${value} | aliases: ${aliases.join(", ")}`;
  assertBoundedString(projected, `${label}.projected_value`, 200);
  return projected;
}

function isCurrentConfirmed(field, currentDate) {
  return (
    field.confirmation_status === "confirmed" &&
    field.valid_until >= currentDate
  );
}

function projectScalarField(profile, mapping, currentDate) {
  const field = profile[mapping.sourceKey];
  if (field === undefined) return null;

  const label = `input.profile.${mapping.sourceKey}`;
  assertSourceMetadata(field, label);
  assertBoundedString(field.value, `${label}.value`, 160);
  const aliases = aliasesFor(field, label);
  if (!isCurrentConfirmed(field, currentDate)) return null;

  const profileRef = {
    profile_field_id: field.profile_field_id,
    field_type: mapping.fieldType,
    value: appendAliases(field.value, aliases, label),
  };
  return {
    profileRef,
    trustedProfileEvidence: {
      ...profileRef,
      source: field.source,
      confirmation_status: field.confirmation_status,
      valid_until: field.valid_until,
    },
  };
}

function projectCourseFields(profile, currentDate) {
  if (!Array.isArray(profile.courses)) {
    failFixture("input.profile.courses must be an array");
  }
  return profile.courses.flatMap((course, index) => {
    const label = `input.profile.courses[${index}]`;
    assertSourceMetadata(course, label);
    assertBoundedString(course.code, `${label}.code`, 80);
    assertBoundedString(course.name, `${label}.name`, 120);
    const aliases = aliasesFor(course, label);
    if (!COURSE_STATUSES.has(course.status)) {
      failFixture(`${label}.status is invalid`);
    }
    if (!isCurrentConfirmed(course, currentDate) || course.status !== "confirmed") {
      return [];
    }

    const profileRef = {
      profile_field_id: course.profile_field_id,
      field_type: "course",
      value: appendAliases(`${course.code} | ${course.name}`, aliases, label),
    };
    return [
      {
        profileRef,
        trustedProfileEvidence: {
          ...profileRef,
          source: course.source,
          confirmation_status: course.confirmation_status,
          valid_until: course.valid_until,
          course_status: course.status,
        },
      },
    ];
  });
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function assertFixtureShape(fixture) {
  assertPlainObject(fixture, "fixture");
  if (!ALLOWED_CASE_IDS.has(fixture.case_id)) {
    failFixture("fixture case_id is outside the frozen Phase 2 development set");
  }
  if (fixture.dataset_split !== PHASE2_DATASET_SPLIT) {
    failFixture("fixture must belong to the development split");
  }
  assertPlainObject(fixture.input, "fixture.input");
  assertPlainObject(fixture.input.message, "fixture.input.message");
  assertPlainObject(fixture.input.profile, "fixture.input.profile");
  assertPlainObject(fixture.harness_context, "fixture.harness_context");

  const message = fixture.input.message;
  assertBoundedString(message.subject, "input.message.subject", 500);
  assertBoundedString(message.language, "input.message.language", 32);
  assertBoundedString(message.body, "input.message.body", 50_000);
  if (fixture.language !== message.language) {
    failFixture("fixture language must match input.message.language");
  }
  if (!Array.isArray(message.attachments) || message.attachments.length !== 0) {
    failFixture("Phase 2 development messages must not contain attachments");
  }
  if (message.attachment_overall_status !== "none") {
    failFixture("Phase 2 development messages must declare no attachments");
  }
}

function buildProjection(fixture) {
  assertFixtureShape(fixture);
  const currentDate = currentFixtureDate(fixture);
  const profile = fixture.input.profile;
  const projected = [];

  for (const mapping of SCALAR_PROFILE_FIELDS) {
    const item = projectScalarField(profile, mapping, currentDate);
    if (item) projected.push(item);
  }
  projected.push(...projectCourseFields(profile, currentDate));
  for (const mapping of OPTIONAL_SCALAR_PROFILE_FIELDS) {
    const item = projectScalarField(profile, mapping, currentDate);
    if (item) projected.push(item);
  }

  if (projected.length > 8) {
    failFixture("Phase 2 Model Input cannot project more than 8 profile refs");
  }
  const profileIds = projected.map(
    ({ profileRef }) => profileRef.profile_field_id,
  );
  if (new Set(profileIds).size !== profileIds.length) {
    failFixture("Phase 2 projected profile_field_id values must be unique");
  }

  const modelInput = {
    task_type: PHASE2_TASK_TYPE,
    target_language: PHASE2_TARGET_LANGUAGE,
    candidate_schema_version: CORE_CANDIDATE_SCHEMA_VERSION,
    message: {
      subject: fixture.input.message.subject,
      language: fixture.input.message.language,
      body: fixture.input.message.body,
    },
    profile_refs: projected.map(({ profileRef }) => profileRef),
  };
  try {
    validatePhase2ModelInput(modelInput);
  } catch {
    failFixture("Phase 2 Model Input projection is invalid");
  }

  return deepFreeze({
    modelInput,
    trustedProfileEvidence: projected.map(
      ({ trustedProfileEvidence }) => trustedProfileEvidence,
    ),
    modelInputHash: hashCanonicalJson(modelInput),
  });
}

function selectOneFixture(fixtures, caseId) {
  const matches = fixtures.filter((fixture) => fixture?.case_id === caseId);
  if (matches.length !== 1) {
    failFixture(`${caseId} must appear exactly once`);
  }
  return matches[0];
}

/** Evaluation/build-time only; never import this from the model-input path. */
export function projectPhase2DevelopmentInput(fixture) {
  return buildProjection(fixture).modelInput;
}

/** Build the fixed, answer-free snapshot from the source fixture array. */
export function buildPhase2DevelopmentInputSnapshot(fixtures) {
  if (!Array.isArray(fixtures)) {
    failFixture("development fixture root must be an array");
  }

  const cases = PHASE2_DEVELOPMENT_CASE_IDS.map((caseId) => {
    const projection = buildProjection(selectOneFixture(fixtures, caseId));
    const caseRecord = {
      caseId,
      modelInput: structuredClone(projection.modelInput),
      trustedProfileEvidence: structuredClone(
        projection.trustedProfileEvidence,
      ),
      modelInputHash: projection.modelInputHash,
    };
    return {
      ...caseRecord,
      caseHash: hashCanonicalJson(caseRecord),
    };
  });
  const content = {
    snapshotVersion: PHASE2_DEVELOPMENT_SNAPSHOT_VERSION,
    datasetSplit: PHASE2_DATASET_SPLIT,
    projectionVersion: PHASE2_MODEL_INPUT_PROJECTION_VERSION,
    caseIds: [...PHASE2_DEVELOPMENT_CASE_IDS],
    cases,
  };
  return deepFreeze({
    ...content,
    snapshotHash: hashCanonicalJson(content),
  });
}

/** Explicit build-time read of the answer-bearing source fixture. */
export async function readPhase2DevelopmentSourceFixtures({
  readFileImpl = readFile,
} = {}) {
  if (typeof readFileImpl !== "function") {
    throw new TypeError("readFileImpl must be a function");
  }
  let parsed;
  try {
    const source = await readFileImpl(PHASE2_DEVELOPMENT_SOURCE_URL, "utf8");
    parsed = JSON.parse(source);
  } catch (error) {
    if (error instanceof Phase2DevelopmentInputError) throw error;
    failFixture("development source fixture could not be read or parsed");
  }
  if (!Array.isArray(parsed)) {
    failFixture("development fixture root must be an array");
  }
  return parsed;
}
