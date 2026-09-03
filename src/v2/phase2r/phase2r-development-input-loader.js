import { readFile } from "node:fs/promises";

import {
  loadPhase2DevelopmentInputs,
  PHASE2_DEVELOPMENT_CASE_IDS,
} from "../phase2/development-input-loader.js";
import { hashCanonicalJson, hashUtf8 } from "../validation/canonical-json.js";
import {
  PHASE2R_MODEL_INPUT_PROJECTION_VERSION,
  PHASE2R_MODEL_INPUT_VERSION,
  validatePhase2rModelInput,
} from "./phase2r-model-input-validator.js";
import {
  PHASE2R_SENDER_SCHOOL_MAPPING_VERSION,
  PHASE2R_SOURCE_CONTEXT_SNAPSHOT_VERSION,
} from "./phase2r-source-context-contract.js";

export const PHASE2R_SOURCE_CONTEXT_SNAPSHOT_URL = new URL(
  "../../../docs/fixtures/prd-v0.2/phase2r-source-context-v1.json",
  import.meta.url,
);
export const PHASE2R_SOURCE_CONTEXT_SNAPSHOT_HASH =
  "sha256:522a63921129c78f2e797fff6b4f179954707e316cbcbe622d32589de3b77ff6";
export const PHASE2R_SOURCE_CONTEXT_FILE_HASH =
  "sha256:35751cddd57d5c9c836b4c581e9a573f3ec4a98dbd3479e6e831703ff69851c3";
export const PHASE2R_DEVELOPMENT_INPUT_SET_HASH =
  "sha256:10dd08ac3e18631fdb0812194744cd3f13b9e58d8477dbc606ce647aae2d7a80";

const ALLOWED_CASE_IDS = new Set(PHASE2_DEVELOPMENT_CASE_IDS);
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export class Phase2rDevelopmentInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Phase2rDevelopmentInputError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new Phase2rDevelopmentInputError(code, message);
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
    mappingVersion: snapshot.mappingVersion,
    datasetSplit: snapshot.datasetSplit,
    dataClass: snapshot.dataClass,
    caseIds: snapshot.caseIds,
    cases: snapshot.cases,
  };
}

function assertContextSnapshot(snapshot) {
  if (
    !hasExactKeys(snapshot, [
      "snapshotVersion",
      "mappingVersion",
      "datasetSplit",
      "dataClass",
      "caseIds",
      "cases",
      "snapshotHash",
    ]) ||
    snapshot.snapshotVersion !== PHASE2R_SOURCE_CONTEXT_SNAPSHOT_VERSION ||
    snapshot.mappingVersion !== PHASE2R_SENDER_SCHOOL_MAPPING_VERSION ||
    snapshot.datasetSplit !== "development" ||
    snapshot.dataClass !== "fully_synthetic" ||
    !Array.isArray(snapshot.caseIds) ||
    !Array.isArray(snapshot.cases) ||
    snapshot.caseIds.length !== 16 ||
    snapshot.cases.length !== 16 ||
    snapshot.caseIds.some(
      (caseId, index) => caseId !== PHASE2_DEVELOPMENT_CASE_IDS[index],
    ) ||
    snapshot.cases.some(
      (item, index) =>
        !hasExactKeys(item, ["caseId", "sender_school_name", "mapping_id"]) ||
        item.caseId !== PHASE2_DEVELOPMENT_CASE_IDS[index] ||
        (item.sender_school_name !== null &&
          (typeof item.sender_school_name !== "string" ||
            item.sender_school_name.length < 1 ||
            item.sender_school_name.length > 160)) ||
        ((item.sender_school_name === null) !== (item.mapping_id === null)) ||
        (item.mapping_id !== null &&
          !/^synthetic-[a-z0-9-]{1,79}$/u.test(item.mapping_id)),
    ) ||
    !HASH_PATTERN.test(snapshot.snapshotHash) ||
    snapshot.snapshotHash !== hashCanonicalJson(snapshotContent(snapshot)) ||
    snapshot.snapshotHash !== PHASE2R_SOURCE_CONTEXT_SNAPSHOT_HASH
  ) {
    fail("phase2r_context_invalid", "Phase 2R source context snapshot is invalid");
  }
}

async function readContextSnapshot(readFileImpl) {
  let source;
  try {
    source = await readFileImpl(PHASE2R_SOURCE_CONTEXT_SNAPSHOT_URL, "utf8");
  } catch {
    fail("phase2r_context_invalid", "Phase 2R source context could not be read");
  }
  if (typeof source !== "string" || hashUtf8(source) !== PHASE2R_SOURCE_CONTEXT_FILE_HASH) {
    fail("phase2r_context_integrity_error", "Phase 2R source context file hash mismatch");
  }
  let snapshot;
  try {
    snapshot = JSON.parse(source);
  } catch {
    fail("phase2r_context_invalid", "Phase 2R source context is not valid JSON");
  }
  assertContextSnapshot(snapshot);
  return snapshot;
}

function revisionInput(baseInput, contextCase) {
  const modelInput = {
    input_contract_version: PHASE2R_MODEL_INPUT_VERSION,
    task_type: baseInput.modelInput.task_type,
    target_language: baseInput.modelInput.target_language,
    candidate_schema_version: baseInput.modelInput.candidate_schema_version,
    message: structuredClone(baseInput.modelInput.message),
    source_context: {
      sender_school_name: contextCase.sender_school_name,
    },
    profile_refs: structuredClone(baseInput.modelInput.profile_refs),
  };
  try {
    validatePhase2rModelInput(modelInput);
  } catch {
    fail("phase2r_input_invalid", `${baseInput.caseId} revision Input is invalid`);
  }
  return modelInput;
}

function combinedInputs(baseInputs, contextSnapshot) {
  if (
    !Array.isArray(baseInputs) ||
    baseInputs.length !== 16 ||
    baseInputs.some(
      (item, index) => item.caseId !== PHASE2_DEVELOPMENT_CASE_IDS[index],
    )
  ) {
    fail("phase2r_input_invalid", "The frozen Phase 2 base Input set drifted");
  }
  const results = baseInputs.map((baseInput, index) => {
    const contextCase = contextSnapshot.cases[index];
    const modelInput = revisionInput(baseInput, contextCase);
    return deepFreeze({
      caseId: baseInput.caseId,
      datasetSplit: "development",
      projectionVersion: PHASE2R_MODEL_INPUT_PROJECTION_VERSION,
      fixtureInput: {
        message: structuredClone(modelInput.message),
        source_context: structuredClone(modelInput.source_context),
        profile_refs: structuredClone(modelInput.profile_refs),
      },
      modelInput,
      trustedProfileEvidence: structuredClone(baseInput.trustedProfileEvidence),
      trustedSourceContextEvidence: {
        mapping_version: PHASE2R_SENDER_SCHOOL_MAPPING_VERSION,
        mapping_id: contextCase.mapping_id,
        sender_school_name: contextCase.sender_school_name,
      },
      modelInputHash: hashCanonicalJson(modelInput),
    });
  });
  const setHash = hashCanonicalJson(
    results.map(({ caseId, modelInputHash }) => ({ caseId, modelInputHash })),
  );
  if (setHash !== PHASE2R_DEVELOPMENT_INPUT_SET_HASH) {
    fail("phase2r_input_integrity_error", "Phase 2R combined Input set hash mismatch");
  }
  return Object.freeze(results);
}

export async function loadPhase2rDevelopmentInputs({
  readFileImpl = readFile,
} = {}) {
  if (typeof readFileImpl !== "function") throw new TypeError("readFileImpl must be a function");
  const baseInputs = await loadPhase2DevelopmentInputs({ readFileImpl });
  const contextSnapshot = await readContextSnapshot(readFileImpl);
  return combinedInputs(baseInputs, contextSnapshot);
}

export async function loadPhase2rDevelopmentInput({
  caseId,
  readFileImpl = readFile,
} = {}) {
  if (!ALLOWED_CASE_IDS.has(caseId)) {
    throw new Phase2rDevelopmentInputError(
      "fixture_not_allowed",
      "Phase 2R only allows the frozen 16 development Case IDs",
    );
  }
  const inputs = await loadPhase2rDevelopmentInputs({ readFileImpl });
  return inputs[PHASE2_DEVELOPMENT_CASE_IDS.indexOf(caseId)];
}
