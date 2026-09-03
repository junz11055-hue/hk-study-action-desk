import { readFile } from "node:fs/promises";

import { hashCanonicalJson, hashUtf8 } from "../validation/canonical-json.js";
import { PHASE2_DEVELOPMENT_CASE_IDS } from "./development-input-loader.js";
import {
  PHASE2_EVALUATION_CANDIDATE_SCHEMA_HASH,
  PHASE2_EVALUATION_CANDIDATE_SCHEMA_VERSION,
  PHASE2_EVALUATION_SOURCE_FILE_HASH,
  PHASE2_EVALUATION_TRUTH_ENTRIES,
  PHASE2_EVALUATION_TRUTH_MANIFEST_HASH,
  PHASE2_EVALUATION_TRUTH_MANIFEST_VERSION,
} from "./phase2-evaluation-truth-manifest.js";

export const PHASE2_EVALUATION_DEVELOPMENT_SOURCE_URL = new URL(
  "../../../docs/fixtures/prd-v0.2/base-development.json",
  import.meta.url,
);

export class Phase2EvaluationTruthError extends Error {
  constructor() {
    super("The frozen Phase 2 evaluation truth could not be loaded safely.");
    this.name = "Phase2EvaluationTruthError";
    this.code = "phase2_evaluation_truth_invalid";
  }
}

export function assertPhase2EvaluationTruthManifest() {
  const manifestHash = hashCanonicalJson({
    manifestVersion: PHASE2_EVALUATION_TRUTH_MANIFEST_VERSION,
    candidateSchemaVersion: PHASE2_EVALUATION_CANDIDATE_SCHEMA_VERSION,
    candidateSchemaHash: PHASE2_EVALUATION_CANDIDATE_SCHEMA_HASH,
    caseIds: [...PHASE2_DEVELOPMENT_CASE_IDS],
    entries: PHASE2_EVALUATION_TRUTH_ENTRIES,
  });
  if (
    PHASE2_EVALUATION_TRUTH_ENTRIES.length !== 16 ||
    PHASE2_EVALUATION_TRUTH_ENTRIES.some(
      (entry, index) => entry.caseId !== PHASE2_DEVELOPMENT_CASE_IDS[index],
    ) ||
    manifestHash !== PHASE2_EVALUATION_TRUTH_MANIFEST_HASH
  ) {
    throw new Phase2EvaluationTruthError();
  }
}

export async function loadPhase2EvaluationDevelopmentCases({
  readFileImpl = readFile,
} = {}) {
  assertPhase2EvaluationTruthManifest();
  let parsed;
  try {
    const source = await readFileImpl(
      PHASE2_EVALUATION_DEVELOPMENT_SOURCE_URL,
      "utf8",
    );
    if (
      typeof source !== "string" ||
      hashUtf8(source) !== PHASE2_EVALUATION_SOURCE_FILE_HASH
    ) {
      throw new Phase2EvaluationTruthError();
    }
    parsed = JSON.parse(source);
  } catch (error) {
    if (error instanceof Phase2EvaluationTruthError) throw error;
    throw new Phase2EvaluationTruthError();
  }
  if (!Array.isArray(parsed)) throw new Phase2EvaluationTruthError();

  const cases = PHASE2_DEVELOPMENT_CASE_IDS.map((caseId, index) => {
    const matches = parsed.filter((item) => item?.case_id === caseId);
    if (matches.length !== 1) throw new Phase2EvaluationTruthError();
    const developmentCase = matches[0];
    const expectedHash = hashCanonicalJson({
      caseId: developmentCase.case_id,
      datasetSplit: developmentCase.dataset_split,
      expected: developmentCase.expected,
    });
    if (expectedHash !== PHASE2_EVALUATION_TRUTH_ENTRIES[index].expectedHash) {
      throw new Phase2EvaluationTruthError();
    }
    return developmentCase;
  });
  return cases;
}
