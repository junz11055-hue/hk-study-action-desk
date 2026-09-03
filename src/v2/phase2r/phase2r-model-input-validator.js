import { CORE_CANDIDATE_SCHEMA_VERSION } from "../contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import {
  PHASE2_ALLOWED_MESSAGE_LANGUAGES,
  PHASE2_ALLOWED_PROFILE_FIELD_TYPES,
  PHASE2_TARGET_LANGUAGE,
  PHASE2_TASK_TYPE,
  validatePhase2ModelInput,
} from "../phase2/phase2-model-input-validator.js";
import { canonicalJsonStringify } from "../validation/canonical-json.js";

export const PHASE2R_MODEL_INPUT_VERSION = "phase2r-core-model-input-v2";
export const PHASE2R_MODEL_INPUT_PROJECTION_VERSION =
  "phase2r-core-model-input-projection-v2";
export const PHASE2R_MAX_MODEL_INPUT_UTF8_BYTES = 8_000;

const SECRET_VALUE_PATTERN =
  /(?:\b(?:authorization|api[_ -]?key|cookie|session[_ -]?secret|invite[_ -]?code)\b\s*[:=]|\bbearer\s+[A-Za-z0-9._~-]{8,}|\bsk-[A-Za-z0-9_-]{8,}|\bDEEPSEEK_API_KEY\b)/iu;
const NETWORK_PATTERN =
  /(?:[a-z][a-z0-9+.-]*:)?\/\/|\bwww\.|@|\b(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})\b/iu;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export class Phase2rModelInputValidationError extends Error {
  constructor(code, message, jsonPaths = []) {
    super(message);
    this.name = "Phase2rModelInputValidationError";
    this.code = code;
    this.jsonPaths = Object.freeze([...new Set(jsonPaths)].slice(0, 8));
  }
}

function fail(code, message, jsonPaths = []) {
  throw new Phase2rModelInputValidationError(code, message, jsonPaths);
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

export function toPhase2LegacyModelInput(modelInput) {
  return {
    task_type: modelInput.task_type,
    target_language: modelInput.target_language,
    candidate_schema_version: modelInput.candidate_schema_version,
    message: modelInput.message,
    profile_refs: modelInput.profile_refs,
  };
}

/** Accept the revision Input by identity; never repair or mutate it. */
export function validatePhase2rModelInput(modelInput) {
  let serialized;
  try {
    serialized = canonicalJsonStringify(modelInput);
  } catch {
    fail("phase2r_input_invalid", "Phase 2R Model Input must be JSON-compatible");
  }
  if (Buffer.byteLength(serialized, "utf8") > PHASE2R_MAX_MODEL_INPUT_UTF8_BYTES) {
    fail("phase2r_input_too_large", "Phase 2R Model Input exceeds its byte budget");
  }
  if (
    !hasExactKeys(modelInput, [
      "input_contract_version",
      "task_type",
      "target_language",
      "candidate_schema_version",
      "message",
      "source_context",
      "profile_refs",
    ]) ||
    modelInput.input_contract_version !== PHASE2R_MODEL_INPUT_VERSION ||
    modelInput.task_type !== PHASE2_TASK_TYPE ||
    modelInput.target_language !== PHASE2_TARGET_LANGUAGE ||
    modelInput.candidate_schema_version !== CORE_CANDIDATE_SCHEMA_VERSION ||
    !hasExactKeys(modelInput.source_context, ["sender_school_name"])
  ) {
    fail("phase2r_input_invalid", "Phase 2R Model Input envelope is invalid");
  }

  const senderSchool = modelInput.source_context.sender_school_name;
  if (
    senderSchool !== null &&
    (typeof senderSchool !== "string" ||
      senderSchool.length < 1 ||
      senderSchool.length > 160 ||
      senderSchool !== senderSchool.trim() ||
      CONTROL_CHARACTER_PATTERN.test(senderSchool) ||
      SECRET_VALUE_PATTERN.test(senderSchool) ||
      NETWORK_PATTERN.test(senderSchool))
  ) {
    fail(
      "phase2r_source_context_invalid",
      "Trusted sender school context is invalid",
      ["$.source_context.sender_school_name"],
    );
  }

  try {
    validatePhase2ModelInput(toPhase2LegacyModelInput(modelInput));
  } catch (error) {
    fail(
      error?.code === "phase2_input_secret_detected"
        ? "phase2r_input_secret_detected"
        : "phase2r_input_invalid",
      "The embedded Core Input failed validation",
      error?.jsonPaths,
    );
  }
  const schoolRefs = modelInput.profile_refs.filter(
    ({ field_type }) => field_type === "school",
  );
  if (schoolRefs.length !== 1) {
    fail(
      "phase2r_source_context_invalid",
      "Phase 2R requires exactly one current confirmed school profile ref",
      ["$.profile_refs"],
    );
  }
  return modelInput;
}

export {
  PHASE2_ALLOWED_MESSAGE_LANGUAGES,
  PHASE2_ALLOWED_PROFILE_FIELD_TYPES,
};
