import { readFile } from "node:fs/promises";

import { hashCanonicalJson, hashUtf8 } from "../validation/canonical-json.js";
import { validatePhase2rModelInput } from "../phase2r/phase2r-model-input-validator.js";

export const PHASE2AO_CASE_ID = "DEV001";
export const PHASE2AO_PRODUCT_INPUT_VERSION = "synthetic-product-input-v1";
export const PHASE2AO_PRODUCT_INPUT_HASH =
  "sha256:ee18d0897a63f2f380ccf20df584815b9fa326b1ed3949dad65cbe6212d5405e";
export const PHASE2AO_PRODUCT_INPUT_FILE_HASH =
  "sha256:ac6581a3a4b4183aea38c9797c29dc95118af03876fa42fbc9d630c4d0f4c8df";
export const PHASE2AO_MODEL_INPUT_HASH =
  "sha256:5f7e4d9e243e95a0f11ac7736f330252d6939ff845658cd91b04e88177888b5e";
export const PHASE2AO_PRODUCT_INPUT_URL = new URL(
  "./fixtures/synthetic-product-input-v1.json",
  import.meta.url,
);

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const FORBIDDEN_KEYS = new Set([
  "expected",
  "oracle",
  "locked",
  "answerKey",
  "answer_key",
  "apiKey",
  "api_key",
  "cookie",
  "inviteCode",
  "invite_code",
  "oauthToken",
  "oauth_token",
]);

export class Phase2aoProductInputError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "Phase2aoProductInputError";
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new Phase2aoProductInputError(code, message, {
    ...(cause === undefined ? {} : { cause }),
  });
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

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function scanForbiddenKeys(value) {
  if (Array.isArray(value)) {
    for (const child of value) scanForbiddenKeys(child);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      fail("product_input_forbidden", "The synthetic Product Input contains a forbidden field.");
    }
    scanForbiddenKeys(child);
  }
}

function strictTimestamp(value, suffix = undefined) {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return (
    Number.isFinite(parsed) &&
    (suffix === undefined || value.endsWith(suffix))
  );
}

function assertNotification(notification, modelInput) {
  if (
    !hasExactKeys(notification, [
      "id",
      "schoolName",
      "senderName",
      "senderAddress",
      "subject",
      "sentAt",
      "receivedAt",
      "language",
      "body",
    ]) ||
    notification.id !== "DEV-NOTIF-PAIR-01" ||
    typeof notification.schoolName !== "string" ||
    typeof notification.senderName !== "string" ||
    !/^[^\s@]+@[^\s@]+\.invalid$/u.test(notification.senderAddress ?? "") ||
    notification.subject !== modelInput.message.subject ||
    notification.language !== modelInput.message.language ||
    notification.body !== modelInput.message.body ||
    !strictTimestamp(notification.sentAt, "+08:00") ||
    !strictTimestamp(notification.receivedAt, "+08:00") ||
    Date.parse(notification.receivedAt) < Date.parse(notification.sentAt)
  ) {
    fail("product_input_invalid", "The synthetic notification envelope is invalid.");
  }
}

function assertImportanceSignal(signal, source) {
  return (
    hasExactKeys(signal, ["present", "value", "source"]) &&
    signal.present === true &&
    signal.value === false &&
    signal.source === source
  );
}

function assertTrustedProfileEvidence(snapshot) {
  if (
    !Array.isArray(snapshot.trustedProfileEvidence) ||
    snapshot.trustedProfileEvidence.length !== snapshot.modelInput.profile_refs.length
  ) {
    fail("product_input_invalid", "Trusted profile evidence is incomplete.");
  }
  for (let index = 0; index < snapshot.modelInput.profile_refs.length; index += 1) {
    const reference = snapshot.modelInput.profile_refs[index];
    const evidence = snapshot.trustedProfileEvidence[index];
    const keys =
      reference.field_type === "course"
        ? [
            "profile_field_id",
            "field_type",
            "value",
            "source",
            "confirmation_status",
            "valid_until",
            "course_status",
          ]
        : [
            "profile_field_id",
            "field_type",
            "value",
            "source",
            "confirmation_status",
            "valid_until",
          ];
    if (
      !hasExactKeys(evidence, keys) ||
      evidence.profile_field_id !== reference.profile_field_id ||
      evidence.field_type !== reference.field_type ||
      evidence.value !== reference.value ||
      !/^synthetic_[a-z0-9_]{1,79}$/u.test(evidence.source ?? "") ||
      evidence.confirmation_status !== "confirmed" ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(evidence.valid_until ?? "") ||
      (reference.field_type === "course" &&
        evidence.course_status !== "confirmed")
    ) {
      fail("product_input_invalid", "Trusted profile evidence drifted.");
    }
  }
}

function snapshotContent(snapshot) {
  const { snapshotHash: _snapshotHash, ...content } = snapshot;
  return content;
}

function validateSnapshot(snapshot) {
  if (
    !hasExactKeys(snapshot, [
      "snapshotVersion",
      "dataClass",
      "datasetSplit",
      "caseId",
      "notification",
      "nativeImportance",
      "securityFacts",
      "harnessContext",
      "modelInput",
      "trustedProfileEvidence",
      "trustedSourceContextEvidence",
      "modelInputHash",
      "snapshotHash",
    ]) ||
    snapshot.snapshotVersion !== PHASE2AO_PRODUCT_INPUT_VERSION ||
    snapshot.dataClass !== "fully_synthetic" ||
    snapshot.datasetSplit !== "development" ||
    snapshot.caseId !== PHASE2AO_CASE_ID
  ) {
    fail("product_input_invalid", "The synthetic Product Input envelope is invalid.");
  }

  scanForbiddenKeys(snapshot);
  try {
    validatePhase2rModelInput(snapshot.modelInput);
  } catch (error) {
    fail("product_input_invalid", "The frozen model Input is invalid.", error);
  }

  if (
    !HASH_PATTERN.test(snapshot.modelInputHash ?? "") ||
    snapshot.modelInputHash !== hashCanonicalJson(snapshot.modelInput) ||
    snapshot.modelInputHash !== PHASE2AO_MODEL_INPUT_HASH ||
    !HASH_PATTERN.test(snapshot.snapshotHash ?? "") ||
    snapshot.snapshotHash !== hashCanonicalJson(snapshotContent(snapshot)) ||
    snapshot.snapshotHash !== PHASE2AO_PRODUCT_INPUT_HASH
  ) {
    fail("product_input_integrity_error", "The synthetic Product Input hash does not match.");
  }

  assertNotification(snapshot.notification, snapshot.modelInput);
  if (
    !hasExactKeys(snapshot.nativeImportance, [
      "senderImportance",
      "providerImportance",
      "userStar",
    ]) ||
    !assertImportanceSignal(
      snapshot.nativeImportance.senderImportance,
      "message_header",
    ) ||
    !assertImportanceSignal(
      snapshot.nativeImportance.providerImportance,
      "mail_provider",
    ) ||
    !assertImportanceSignal(snapshot.nativeImportance.userStar, "user_state")
  ) {
    fail("product_input_invalid", "Native importance facts are invalid.");
  }

  if (
    !hasExactKeys(snapshot.securityFacts, [
      "connectorAuthentication",
      "senderMapping",
      "securityConflict",
      "actionChannel",
    ]) ||
    snapshot.securityFacts.connectorAuthentication !== "passed" ||
    snapshot.securityFacts.senderMapping !== "matched" ||
    snapshot.securityFacts.securityConflict !== false ||
    !hasExactKeys(snapshot.securityFacts.actionChannel, [
      "type",
      "domain",
      "status",
    ]) ||
    snapshot.securityFacts.actionChannel.type !== "web" ||
    snapshot.securityFacts.actionChannel.domain !== "learn.harbour.invalid" ||
    snapshot.securityFacts.actionChannel.status !== "verified"
  ) {
    fail("product_input_invalid", "Synthetic security facts are invalid.");
  }

  if (
    !hasExactKeys(snapshot.harnessContext, [
      "currentTimeHkt",
      "timezone",
      "historicalItems",
    ]) ||
    !strictTimestamp(snapshot.harnessContext.currentTimeHkt, "+08:00") ||
    snapshot.harnessContext.timezone !== "Asia/Hong_Kong" ||
    !Array.isArray(snapshot.harnessContext.historicalItems) ||
    snapshot.harnessContext.historicalItems.length !== 0
  ) {
    fail("product_input_invalid", "The synthetic Harness context is invalid.");
  }

  assertTrustedProfileEvidence(snapshot);
  if (
    !hasExactKeys(snapshot.trustedSourceContextEvidence, [
      "mappingVersion",
      "mappingId",
      "senderSchoolName",
    ]) ||
    snapshot.trustedSourceContextEvidence.mappingVersion !==
      "synthetic-sender-school-map-v1" ||
    snapshot.trustedSourceContextEvidence.mappingId !==
      "synthetic-harbour-university-domain-v1" ||
    snapshot.trustedSourceContextEvidence.senderSchoolName !== "港湾大学" ||
    snapshot.modelInput.source_context.sender_school_name !== "港湾大学"
  ) {
    fail("product_input_invalid", "Trusted source context evidence is invalid.");
  }
  return snapshot;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export async function loadPhase2aoProductInput({
  caseId,
  readFileImpl = readFile,
} = {}) {
  if (caseId !== PHASE2AO_CASE_ID) {
    throw new Phase2aoProductInputError(
      "fixture_not_allowed",
      "Only the approved DEV001 synthetic Product Input is available.",
    );
  }
  if (typeof readFileImpl !== "function") {
    throw new TypeError("readFileImpl must be a function");
  }

  let source;
  try {
    source = await readFileImpl(PHASE2AO_PRODUCT_INPUT_URL, "utf8");
  } catch (error) {
    fail("product_input_unavailable", "The synthetic Product Input could not be read.", error);
  }
  if (
    typeof source !== "string" ||
    hashUtf8(source) !== PHASE2AO_PRODUCT_INPUT_FILE_HASH
  ) {
    fail("product_input_integrity_error", "The Product Input file hash does not match.");
  }

  let snapshot;
  try {
    snapshot = JSON.parse(source);
  } catch (error) {
    fail("product_input_invalid", "The synthetic Product Input is not valid JSON.", error);
  }
  return deepFreeze(validateSnapshot(snapshot));
}
