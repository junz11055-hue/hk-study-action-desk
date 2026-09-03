import { readFile } from "node:fs/promises";

export const PHASE1_ALLOWED_CASE_ID = "DEV001";
export const PHASE1_DATASET_SPLIT = "development";
export const PHASE1_TASK_TYPE = "analyze_school_notification_candidate";
export const PHASE1_TARGET_LANGUAGE = "zh-Hans";
export const PHASE1_CANDIDATE_SCHEMA_VERSION =
  "notification-analysis-candidate-p1-v1";
export const DEVELOPMENT_FIXTURE_URL = new URL(
  "../../../docs/fixtures/prd-v0.2/base-development.json",
  import.meta.url,
);

const REPAIR_ERROR_CODES = new Set([
  "model_response_invalid",
  "candidate_schema_invalid",
  "candidate_reference_invalid",
  "candidate_evidence_invalid",
]);

export class DevelopmentFixtureError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DevelopmentFixtureError";
    this.code = code;
  }
}

function fixtureError(message) {
  return new DevelopmentFixtureError("fixture_invalid", message);
}

function assertPlainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw fixtureError(`${label} must be an object`);
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
      ([key, child]) => key === prohibitedKey || containsKey(child, prohibitedKey),
    );
  }
  return false;
}

function assertSyntheticMessage(message) {
  assertPlainObject(message, "input.message");
  assertPlainObject(message.from, "input.message.from");

  const address = message.from.address;
  const addressDomain =
    typeof address === "string" && address.includes("@")
      ? address.slice(address.lastIndexOf("@") + 1).toLowerCase()
      : "";
  if (!addressDomain.endsWith(".invalid")) {
    throw fixtureError("sender address must use a .invalid domain");
  }

  if (!Array.isArray(message.links)) {
    throw fixtureError("input.message.links must be an array");
  }
  for (const link of message.links) {
    assertPlainObject(link, "input.message.links[]");
    for (const field of ["display_url", "resolved_url"]) {
      try {
        const url = new URL(link[field]);
        if (url.protocol !== "https:" || !url.hostname.endsWith(".invalid")) {
          throw new Error("not synthetic HTTPS");
        }
      } catch {
        throw fixtureError(`${field} must be a synthetic .invalid HTTPS URL`);
      }
    }
  }

  const bodyUrls =
    typeof message.body === "string"
      ? message.body.match(/https:\/\/[^\s)\]}>"']+/gu) ?? []
      : [];
  for (const rawUrl of bodyUrls) {
    try {
      if (!new URL(rawUrl).hostname.endsWith(".invalid")) {
        throw new Error("not synthetic");
      }
    } catch {
      throw fixtureError("message body URLs must use .invalid domains");
    }
  }
}

function validateRepairFeedback(repairFeedback, fixture) {
  if (repairFeedback === null) {
    return null;
  }
  assertPlainObject(repairFeedback, "repair_feedback");
  const keys = Object.keys(repairFeedback).sort();
  if (keys.join(",") !== "error_code,json_paths,message") {
    throw fixtureError("repair_feedback has unexpected fields");
  }
  if (!REPAIR_ERROR_CODES.has(repairFeedback.error_code)) {
    throw fixtureError("repair_feedback.error_code is not allowed");
  }
  if (
    !Array.isArray(repairFeedback.json_paths) ||
    repairFeedback.json_paths.length < 1 ||
    repairFeedback.json_paths.length > 8 ||
    repairFeedback.json_paths.some(
      (path) =>
        typeof path !== "string" ||
        path.length < 1 ||
        path.length > 200 ||
        !path.startsWith("/"),
    )
  ) {
    throw fixtureError("repair_feedback.json_paths is invalid");
  }
  if (
    typeof repairFeedback.message !== "string" ||
    repairFeedback.message.length < 1 ||
    repairFeedback.message.length > 300
  ) {
    throw fixtureError("repair_feedback.message is invalid");
  }

  const body = fixture?.input?.message?.body;
  if (typeof body === "string" && body.length > 0 && repairFeedback.message.includes(body)) {
    throw fixtureError("repair_feedback must not contain the message body");
  }
  return cloneJson(repairFeedback);
}

function assertFixtureShape(fixture) {
  assertPlainObject(fixture, "fixture");
  if (fixture.case_id !== PHASE1_ALLOWED_CASE_ID) {
    throw fixtureError("fixture case_id mismatch");
  }
  if (fixture.dataset_split !== PHASE1_DATASET_SPLIT) {
    throw fixtureError("fixture must be in the development split");
  }
  if (typeof fixture.thread_id !== "string" || fixture.thread_id.length === 0) {
    throw fixtureError("thread_id is required");
  }
  if (
    typeof fixture.source_message_id !== "string" ||
    fixture.source_message_id.length === 0
  ) {
    throw fixtureError("source_message_id is required");
  }
  assertPlainObject(fixture.input, "input");
  assertPlainObject(fixture.input.profile, "input.profile");
  assertPlainObject(fixture.harness_context, "harness_context");

  const timezone = fixture.harness_context.timezone;
  if (
    timezone !== "Asia/Hong_Kong" ||
    fixture.input.profile?.timezone?.value !== timezone
  ) {
    throw fixtureError("profile timezone and harness timezone must match");
  }
  const currentTime = fixture.harness_context.current_time_hkt;
  if (
    typeof currentTime !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?\+08:00$/.test(
      currentTime,
    ) ||
    Number.isNaN(Date.parse(currentTime))
  ) {
    throw fixtureError("current_time_hkt must be a valid +08:00 timestamp");
  }
  if (
    !Array.isArray(fixture.harness_context.historical_items) ||
    fixture.harness_context.historical_items.length !== 0
  ) {
    throw fixtureError("DEV001 historical_items must be an empty array");
  }
  assertSyntheticMessage(fixture.input.message);
}

/**
 * Project exactly the seven approved fixture paths plus trusted task fields.
 * The returned object never contains the fixture's expected subtree.
 */
export function projectDevelopmentFixture(
  fixture,
  { repairFeedback = null } = {},
) {
  assertFixtureShape(fixture);
  const safeRepairFeedback = validateRepairFeedback(repairFeedback, fixture);

  const modelInput = {
    task_type: PHASE1_TASK_TYPE,
    target_language: PHASE1_TARGET_LANGUAGE,
    candidate_schema_version: PHASE1_CANDIDATE_SCHEMA_VERSION,
    repair_feedback: safeRepairFeedback,
    current_time_hkt: fixture.harness_context.current_time_hkt,
    timezone: fixture.harness_context.timezone,
    message_context: {
      thread_id: fixture.thread_id,
      source_message_id: fixture.source_message_id,
    },
    profile: cloneJson(fixture.input.profile),
    message: cloneJson(fixture.input.message),
    historical_items: cloneJson(fixture.harness_context.historical_items),
  };

  if (containsKey(modelInput, "expected")) {
    throw fixtureError("projected model input must not contain expected");
  }
  return modelInput;
}

function projectFixtureHashInput(fixture) {
  return {
    input: {
      profile: cloneJson(fixture.input.profile),
      message: cloneJson(fixture.input.message),
    },
    harness_context: {
      current_time_hkt: fixture.harness_context.current_time_hkt,
      timezone: fixture.harness_context.timezone,
      historical_items: cloneJson(fixture.harness_context.historical_items),
    },
    thread_id: fixture.thread_id,
    source_message_id: fixture.source_message_id,
  };
}
/** Load only base-development.json, select only DEV001, and project it. */
export async function loadDevelopmentFixture({
  caseId,
  readFileImpl = readFile,
  repairFeedback = null,
} = {}) {
  if (caseId !== PHASE1_ALLOWED_CASE_ID) {
    throw new DevelopmentFixtureError(
      "fixture_not_allowed",
      "Phase 1 only allows DEV001",
    );
  }
  if (typeof readFileImpl !== "function") {
    throw new TypeError("readFileImpl must be a function");
  }

  let parsed;
  try {
    const source = await readFileImpl(DEVELOPMENT_FIXTURE_URL, "utf8");
    parsed = JSON.parse(source);
  } catch (error) {
    if (error instanceof DevelopmentFixtureError) {
      throw error;
    }
    throw new DevelopmentFixtureError(
      "fixture_invalid",
      "development fixture could not be read or parsed",
    );
  }

  if (!Array.isArray(parsed)) {
    throw fixtureError("development fixture root must be an array");
  }
  const matches = parsed.filter((fixture) => fixture?.case_id === caseId);
  if (matches.length !== 1) {
    throw fixtureError("DEV001 must appear exactly once");
  }

  const fixture = matches[0];
  assertFixtureShape(fixture);
  return {
    caseId: fixture.case_id,
    datasetSplit: fixture.dataset_split,
    fixtureInput: projectFixtureHashInput(fixture),
    modelInput: projectDevelopmentFixture(fixture, { repairFeedback }),
  };
}
