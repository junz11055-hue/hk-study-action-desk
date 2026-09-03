import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PHASE2_DEVELOPMENT_CASE_IDS,
} from "../../src/v2/phase2/development-input-loader.js";
import { projectPhase2DevelopmentInput } from "../../src/v2/phase2/development-input-snapshot-builder.js";
import {
  buildReferenceCoreCandidateForEvaluation,
  projectCoreOverlapOracle,
} from "../../src/v2/phase2/core-overlap-oracle-projector.js";
import {
  PHASE2_EVALUATION_CANDIDATE_SCHEMA_HASH,
  PHASE2_EVALUATION_CANDIDATE_SCHEMA_VERSION,
  PHASE2_EVALUATION_SOURCE_FILE_HASH,
  PHASE2_EVALUATION_TRUTH_ENTRIES,
  PHASE2_EVALUATION_TRUTH_MANIFEST_HASH,
  PHASE2_EVALUATION_TRUTH_MANIFEST_VERSION,
} from "../../src/v2/phase2/phase2-evaluation-truth-manifest.js";
import {
  hashCanonicalJson,
  hashUtf8,
} from "../../src/v2/validation/canonical-json.js";

const DEVELOPMENT_FIXTURE_URL = new URL(
  "../../docs/fixtures/prd-v0.2/base-development.json",
  import.meta.url,
);

test("evaluation truth manifest pins source, Input, expected, Oracle, and reference Candidate", async () => {
  const source = await readFile(DEVELOPMENT_FIXTURE_URL, "utf8");
  assert.equal(hashUtf8(source), PHASE2_EVALUATION_SOURCE_FILE_HASH);

  assert.deepEqual(
    PHASE2_EVALUATION_TRUTH_ENTRIES.map(({ caseId }) => caseId),
    PHASE2_DEVELOPMENT_CASE_IDS,
  );
  assert.equal(
    hashCanonicalJson({
      manifestVersion: PHASE2_EVALUATION_TRUTH_MANIFEST_VERSION,
      candidateSchemaVersion: PHASE2_EVALUATION_CANDIDATE_SCHEMA_VERSION,
      candidateSchemaHash: PHASE2_EVALUATION_CANDIDATE_SCHEMA_HASH,
      caseIds: [...PHASE2_DEVELOPMENT_CASE_IDS],
      entries: PHASE2_EVALUATION_TRUTH_ENTRIES,
    }),
    PHASE2_EVALUATION_TRUTH_MANIFEST_HASH,
  );

  const fixtures = JSON.parse(source);
  PHASE2_EVALUATION_TRUTH_ENTRIES.forEach((entry) => {
    const matches = fixtures.filter((fixture) => fixture?.case_id === entry.caseId);
    assert.equal(matches.length, 1, entry.caseId);
    const developmentCase = matches[0];
    const oracle = projectCoreOverlapOracle(developmentCase);
    const referenceCandidate = buildReferenceCoreCandidateForEvaluation(
      developmentCase,
      oracle,
    );

    assert.equal(
      hashCanonicalJson(projectPhase2DevelopmentInput(developmentCase)),
      entry.modelInputHash,
      `${entry.caseId} Model Input`,
    );
    assert.equal(
      hashCanonicalJson({
        caseId: developmentCase.case_id,
        datasetSplit: developmentCase.dataset_split,
        expected: developmentCase.expected,
      }),
      entry.expectedHash,
      `${entry.caseId} expected`,
    );
    assert.equal(
      hashCanonicalJson(oracle),
      entry.oracleHash,
      `${entry.caseId} Oracle`,
    );
    assert.equal(
      hashCanonicalJson(referenceCandidate),
      entry.referenceCandidateHash,
      `${entry.caseId} reference Candidate`,
    );
  });
});
