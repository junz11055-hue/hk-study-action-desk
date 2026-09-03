import { readFile } from "node:fs/promises";

import { hashCanonicalJson, hashUtf8 } from "../validation/canonical-json.js";
import {
  PHASE2_MODEL_INPUT_PROJECTION_VERSION,
  validatePhase2ModelInput,
} from "./phase2-model-input-validator.js";

export { PHASE2_MODEL_INPUT_PROJECTION_VERSION };

export const PHASE2_DATASET_SPLIT = "development";
export const PHASE2_DEVELOPMENT_CASE_IDS = Object.freeze([
  "DEV001",
  "DEV003",
  "DEV004",
  "DEV005",
  "DEV006",
  "DEV007",
  "DEV008",
  "DEV010",
  "DEV017",
  "DEV018",
  "DEV019",
  "DEV020",
  "DEV022",
  "DEV023",
  "DEV024",
  "DEV025",
]);
export const PHASE2_DEVELOPMENT_SNAPSHOT_VERSION =
  "phase2-development-model-input-snapshot-v1";
export const PHASE2_DEVELOPMENT_SNAPSHOT_URL = new URL(
  "../../../docs/fixtures/prd-v0.2/phase2-development-inputs-v1.json",
  import.meta.url,
);

// These two digests are updated only by an explicit snapshot regeneration.
// The content digest protects the parsed contract. The raw-file digest also
// rejects duplicate JSON keys, whitespace changes, and property reordering.
export const PHASE2_DEVELOPMENT_SNAPSHOT_HASH =
  "sha256:23a8e2b1cc68084d9d6e934c041f8390c1339f6e775159e8bc11e165a09c97ff";
export const PHASE2_DEVELOPMENT_SNAPSHOT_FILE_HASH =
  "sha256:5ad5bd493f3910820c62af1ec1bbee04ef77249ebb561a9b91fc3631140813b5";

// Compatibility alias: this now points only at the answer-free snapshot.
export const PHASE2_DEVELOPMENT_FIXTURE_URL =
  PHASE2_DEVELOPMENT_SNAPSHOT_URL;

const ALLOWED_CASE_IDS = new Set(PHASE2_DEVELOPMENT_CASE_IDS);
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const SYNTHETIC_SOURCE_PATTERN = /^synthetic_[a-z0-9_]{1,79}$/u;
const COMMON_EVIDENCE_KEYS = Object.freeze([
  "profile_field_id",
  "field_type",
  "value",
  "source",
  "confirmation_status",
  "valid_until",
]);

export class Phase2DevelopmentInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Phase2DevelopmentInputError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new Phase2DevelopmentInputError(code, message);
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

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function snapshotContent(snapshot) {
  return {
    snapshotVersion: snapshot.snapshotVersion,
    datasetSplit: snapshot.datasetSplit,
    projectionVersion: snapshot.projectionVersion,
    caseIds: snapshot.caseIds,
    cases: snapshot.cases,
  };
}

function assertTrustedProfileEvidence(caseRecord) {
  const { modelInput, trustedProfileEvidence } = caseRecord;
  if (
    !Array.isArray(trustedProfileEvidence) ||
    trustedProfileEvidence.length !== modelInput.profile_refs.length
  ) {
    fail(
      "snapshot_invalid",
      `${caseRecord.caseId} trusted profile evidence must match profile refs`,
    );
  }

  for (let index = 0; index < trustedProfileEvidence.length; index += 1) {
    const evidence = trustedProfileEvidence[index];
    const profileRef = modelInput.profile_refs[index];
    const expectedKeys =
      evidence?.field_type === "course"
        ? [...COMMON_EVIDENCE_KEYS, "course_status"]
        : COMMON_EVIDENCE_KEYS;
    if (!hasExactKeys(evidence, expectedKeys)) {
      fail(
        "snapshot_invalid",
        `${caseRecord.caseId} trusted profile evidence envelope is invalid`,
      );
    }
    if (
      evidence.profile_field_id !== profileRef.profile_field_id ||
      evidence.field_type !== profileRef.field_type ||
      evidence.value !== profileRef.value ||
      !ID_PATTERN.test(evidence.profile_field_id) ||
      !SYNTHETIC_SOURCE_PATTERN.test(evidence.source) ||
      evidence.confirmation_status !== "confirmed" ||
      !isValidDateOnly(evidence.valid_until) ||
      (evidence.field_type === "course" &&
        evidence.course_status !== "confirmed")
    ) {
      fail(
        "snapshot_invalid",
        `${caseRecord.caseId} trusted profile evidence is invalid`,
      );
    }
  }
}

function assertSnapshotCase(caseRecord, caseId) {
  if (
    !hasExactKeys(caseRecord, [
      "caseId",
      "modelInput",
      "trustedProfileEvidence",
      "modelInputHash",
      "caseHash",
    ]) ||
    caseRecord.caseId !== caseId
  ) {
    fail("snapshot_invalid", `${caseId} snapshot case envelope is invalid`);
  }

  try {
    validatePhase2ModelInput(caseRecord.modelInput);
  } catch {
    fail("snapshot_invalid", `${caseId} Model Input is invalid`);
  }

  if (
    !HASH_PATTERN.test(caseRecord.modelInputHash) ||
    caseRecord.modelInputHash !== hashCanonicalJson(caseRecord.modelInput)
  ) {
    fail("snapshot_integrity_error", `${caseId} Model Input hash mismatch`);
  }
  assertTrustedProfileEvidence(caseRecord);

  const expectedCaseHash = hashCanonicalJson({
    caseId: caseRecord.caseId,
    modelInput: caseRecord.modelInput,
    trustedProfileEvidence: caseRecord.trustedProfileEvidence,
    modelInputHash: caseRecord.modelInputHash,
  });
  if (
    !HASH_PATTERN.test(caseRecord.caseHash) ||
    caseRecord.caseHash !== expectedCaseHash
  ) {
    fail("snapshot_integrity_error", `${caseId} snapshot case hash mismatch`);
  }
}

function assertSnapshot(snapshot) {
  if (
    !hasExactKeys(snapshot, [
      "snapshotVersion",
      "datasetSplit",
      "projectionVersion",
      "caseIds",
      "cases",
      "snapshotHash",
    ]) ||
    snapshot.snapshotVersion !== PHASE2_DEVELOPMENT_SNAPSHOT_VERSION ||
    snapshot.datasetSplit !== PHASE2_DATASET_SPLIT ||
    snapshot.projectionVersion !== PHASE2_MODEL_INPUT_PROJECTION_VERSION
  ) {
    fail("snapshot_invalid", "Phase 2 development snapshot envelope is invalid");
  }

  if (
    !Array.isArray(snapshot.caseIds) ||
    snapshot.caseIds.length !== PHASE2_DEVELOPMENT_CASE_IDS.length ||
    snapshot.caseIds.some(
      (caseId, index) => caseId !== PHASE2_DEVELOPMENT_CASE_IDS[index],
    ) ||
    new Set(snapshot.caseIds).size !== snapshot.caseIds.length
  ) {
    fail("snapshot_invalid", "Phase 2 snapshot Case ID order is invalid");
  }
  if (
    !Array.isArray(snapshot.cases) ||
    snapshot.cases.length !== PHASE2_DEVELOPMENT_CASE_IDS.length
  ) {
    fail("snapshot_invalid", "Phase 2 snapshot must contain exactly 16 cases");
  }

  for (let index = 0; index < PHASE2_DEVELOPMENT_CASE_IDS.length; index += 1) {
    assertSnapshotCase(
      snapshot.cases[index],
      PHASE2_DEVELOPMENT_CASE_IDS[index],
    );
  }
  if (new Set(snapshot.cases.map(({ caseId }) => caseId)).size !== 16) {
    fail("snapshot_invalid", "Phase 2 snapshot contains duplicate cases");
  }

  const computedSnapshotHash = hashCanonicalJson(snapshotContent(snapshot));
  if (
    !HASH_PATTERN.test(snapshot.snapshotHash) ||
    snapshot.snapshotHash !== computedSnapshotHash ||
    snapshot.snapshotHash !== PHASE2_DEVELOPMENT_SNAPSHOT_HASH
  ) {
    fail("snapshot_integrity_error", "Phase 2 snapshot content hash mismatch");
  }
}

async function readSnapshot(readFileImpl) {
  if (typeof readFileImpl !== "function") {
    throw new TypeError("readFileImpl must be a function");
  }

  let source;
  try {
    source = await readFileImpl(PHASE2_DEVELOPMENT_SNAPSHOT_URL, "utf8");
  } catch {
    fail("snapshot_invalid", "Phase 2 development snapshot could not be read");
  }
  if (
    typeof source !== "string" ||
    hashUtf8(source) !== PHASE2_DEVELOPMENT_SNAPSHOT_FILE_HASH
  ) {
    fail("snapshot_integrity_error", "Phase 2 snapshot file hash mismatch");
  }

  let snapshot;
  try {
    snapshot = JSON.parse(source);
  } catch {
    fail("snapshot_invalid", "Phase 2 development snapshot is not valid JSON");
  }
  assertSnapshot(snapshot);
  return snapshot;
}

function toDevelopmentInput(caseRecord) {
  const result = {
    caseId: caseRecord.caseId,
    datasetSplit: PHASE2_DATASET_SPLIT,
    projectionVersion: PHASE2_MODEL_INPUT_PROJECTION_VERSION,
    fixtureInput: {
      message: structuredClone(caseRecord.modelInput.message),
      profile_refs: structuredClone(caseRecord.modelInput.profile_refs),
    },
    modelInput: structuredClone(caseRecord.modelInput),
    trustedProfileEvidence: structuredClone(
      caseRecord.trustedProfileEvidence,
    ),
    modelInputHash: caseRecord.modelInputHash,
  };
  return deepFreeze(result);
}

/** Load one fixed case from the answer-free, integrity-pinned snapshot. */
export async function loadPhase2DevelopmentInput({
  caseId,
  readFileImpl = readFile,
} = {}) {
  if (!ALLOWED_CASE_IDS.has(caseId)) {
    throw new Phase2DevelopmentInputError(
      "fixture_not_allowed",
      "Phase 2 only allows the frozen 16 development Case IDs",
    );
  }
  const snapshot = await readSnapshot(readFileImpl);
  const index = PHASE2_DEVELOPMENT_CASE_IDS.indexOf(caseId);
  return toDevelopmentInput(snapshot.cases[index]);
}

/** Load all 16 fixed cases once, preserving the frozen Case ID order. */
export async function loadPhase2DevelopmentInputs({
  readFileImpl = readFile,
} = {}) {
  const snapshot = await readSnapshot(readFileImpl);
  return Object.freeze(snapshot.cases.map(toDevelopmentInput));
}
