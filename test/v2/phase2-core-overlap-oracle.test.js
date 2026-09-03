import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import { NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA } from "../../src/v2/contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import {
  PHASE2_CORE_OVERLAP_CASE_IDS,
  PHASE2_CORE_OVERLAP_ORACLE_VERSION,
  buildReferenceCoreCandidateForEvaluation,
  projectCoreOverlapOracle,
} from "../../src/v2/phase2/core-overlap-oracle-projector.js";
import { hashCanonicalJson } from "../../src/v2/validation/canonical-json.js";

const DEVELOPMENT_FIXTURE_URL = new URL(
  "../../docs/fixtures/prd-v0.2/base-development.json",
  import.meta.url,
);
const developmentCases = JSON.parse(
  await readFile(DEVELOPMENT_FIXTURE_URL, "utf8"),
);
const byCaseId = new Map(
  developmentCases.map((developmentCase) => [
    developmentCase.case_id,
    developmentCase,
  ]),
);
const selectedCases = PHASE2_CORE_OVERLAP_CASE_IDS.map((caseId) =>
  byCaseId.get(caseId),
);

function assertDeepFrozen(value) {
  if (value === null || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

test("Core-overlap Oracle freezes exactly the 16 approved development cases", () => {
  assert.deepEqual(PHASE2_CORE_OVERLAP_CASE_IDS, [
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
  assert.equal(selectedCases.every(Boolean), true);

  for (const developmentCase of selectedCases) {
    const before = hashCanonicalJson(developmentCase);
    const oracle = projectCoreOverlapOracle(developmentCase);

    assert.equal(oracle.oracle_version, PHASE2_CORE_OVERLAP_ORACLE_VERSION);
    assert.equal(oracle.case_id, developmentCase.case_id);
    assert.equal(oracle.split, "development");
    assert.ok(oracle.excluded_fields.length > 0);
    assertDeepFrozen(oracle);
    assert.equal(hashCanonicalJson(developmentCase), before);
  }

  assert.throws(
    () => projectCoreOverlapOracle(byCaseId.get("DEV002")),
    /outside the frozen Phase 2 allowlist/u,
  );
});

test("Oracle maps action obligations and Core deadline roles by the frozen rules", () => {
  const expectedDeadlines = {
    DEV001: [["5:00 pm HKT on 31 August 2026", "submission_deadline"]],
    DEV003: [["2026 年 9 月 3 日下午 5 時前", "payment_deadline"]],
    DEV004: [["2026 年 9 月 3 日下午 5 時前", "payment_deadline"]],
    DEV005: [["9 月 8 日前", "registration_deadline"]],
    DEV006: [],
    DEV007: [],
    DEV008: [],
    DEV010: [["12:00 noon HKT on 1 September 2026", "registration_deadline"]],
    DEV017: [["10:00 am HKT on 30 August 2026", "other_deadline"]],
    DEV018: [],
    DEV019: [["2026 年 9 月 2 日下午 4 時前", "submission_deadline"]],
    DEV020: [["6:00 pm HKT on 30 August 2026", "submission_deadline"]],
    DEV022: [],
    DEV023: [["5:00 pm HKT on 2 September 2026", "other_deadline"]],
    DEV024: [["3:00 pm HKT on 2 September 2026", "other_deadline"]],
    DEV025: [],
  };

  for (const developmentCase of selectedCases) {
    const oracle = projectCoreOverlapOracle(developmentCase);
    assert.deepEqual(
      oracle.deadlines.map((deadline) => [deadline.original_text, deadline.role]),
      expectedDeadlines[developmentCase.case_id],
      developmentCase.case_id,
    );
  }

  assert.deepEqual(projectCoreOverlapOracle(byCaseId.get("DEV001")).actions, [
    { obligation: "mandatory", high_impact: true },
  ]);
  assert.deepEqual(projectCoreOverlapOracle(byCaseId.get("DEV004")).actions, [
    { obligation: "mandatory", high_impact: true },
  ]);
  assert.deepEqual(projectCoreOverlapOracle(byCaseId.get("DEV005")).actions, [
    { obligation: "optional", high_impact: false },
  ]);

  const highImpact = projectCoreOverlapOracle(byCaseId.get("DEV004"));
  assert.equal(highImpact.applicability.high_impact, true);
  assert.equal(highImpact.deadlines[0].high_impact, true);
  assert.equal(highImpact.consequence.high_impact, true);

  const lowImpact = projectCoreOverlapOracle(byCaseId.get("DEV005"));
  assert.equal(lowImpact.applicability.high_impact, false);
  assert.equal(lowImpact.deadlines[0].high_impact, false);
  assert.equal(lowImpact.consequence.high_impact, false);
});

test("Oracle explicitly records every out-of-scope family and excluded event date", () => {
  const oracle = projectCoreOverlapOracle(byCaseId.get("DEV005"));
  const paths = new Set(oracle.excluded_fields.map((item) => item.path));

  for (const path of [
    "/expected/protection_result",
    "/expected/source_status",
    "/expected/resulting_item",
    "/expected/notification_channel",
    "/expected/claims",
    "/expected/actions/*/condition_status",
    "/expected/dates/role=event_start",
    "/expected/consequence/reason",
  ]) {
    assert.equal(paths.has(path), true, path);
  }
  assert.equal(
    oracle.excluded_fields.find(
      (item) => item.path === "/expected/dates/role=event_start",
    ).reason_code,
    "not_a_core_deadline",
  );
});

test("Oracle is insensitive to source array order and source object identity", () => {
  const original = byCaseId.get("DEV005");
  const reordered = structuredClone(original);
  reordered.expected.topics.reverse();
  reordered.expected.actions.reverse();
  reordered.expected.dates.reverse();

  const first = projectCoreOverlapOracle(original);
  const second = projectCoreOverlapOracle(reordered);
  assert.notStrictEqual(first, second);
  assert.deepEqual(second, first);
});

test("Oracle fails closed on uncovered fields and duplicate scored atoms", () => {
  const unknownRoot = structuredClone(byCaseId.get("DEV001"));
  unknownRoot.expected.future_uncovered_field = true;
  assert.throws(
    () => projectCoreOverlapOracle(unknownRoot),
    /unknown, missing, or uncovered field/u,
  );

  const unknownNested = structuredClone(byCaseId.get("DEV001"));
  unknownNested.expected.topics[0].future_uncovered_field = true;
  assert.throws(
    () => projectCoreOverlapOracle(unknownNested),
    /unknown, missing, or uncovered field/u,
  );

  const duplicateTopic = structuredClone(byCaseId.get("DEV001"));
  duplicateTopic.expected.topics.push(
    structuredClone(duplicateTopic.expected.topics[0]),
  );
  assert.throws(
    () => projectCoreOverlapOracle(duplicateTopic),
    /duplicate labels/u,
  );

  const duplicateProfileRef = structuredClone(byCaseId.get("DEV001"));
  duplicateProfileRef.expected.applicability.profile_field_refs.push(
    duplicateProfileRef.expected.applicability.profile_field_refs[0],
  );
  assert.throws(
    () => projectCoreOverlapOracle(duplicateProfileRef),
    /profile_field_refs contains duplicates/u,
  );
});

test("evaluation-only reference builder emits schema-valid, closed Candidates for 16/16", () => {
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(
    NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
  );

  for (const developmentCase of selectedCases) {
    const before = hashCanonicalJson(developmentCase);
    const oracle = projectCoreOverlapOracle(developmentCase);
    const candidate = buildReferenceCoreCandidateForEvaluation(
      developmentCase,
      oracle,
    );

    assert.equal(
      validate(candidate),
      true,
      `${developmentCase.case_id}: ${JSON.stringify(validate.errors)}`,
    );
    assert.equal(hashCanonicalJson(developmentCase), before);

    const claimIds = new Set(candidate.claims.map((claim) => claim.claim_id));
    const evidenceIds = new Set(
      candidate.evidence.map((item) => item.evidence_id),
    );
    for (const claim of candidate.claims) {
      assert.equal(
        claim.evidence_refs.every((id) => evidenceIds.has(id)),
        true,
      );
    }
    for (const refs of [
      candidate.title_claim_refs,
      candidate.summary_claim_refs,
      ...candidate.topics.map((topic) => topic.claim_refs),
      ...candidate.actions.map((action) => action.claim_refs),
      ...candidate.deadlines.map((deadline) => [deadline.claim_ref]),
      [candidate.applicability.claim_ref],
      [candidate.consequence.claim_ref],
    ]) {
      assert.equal(refs.every((id) => claimIds.has(id)), true);
    }
  }
});

test("DEV008 receives a stable evaluation-only consequence claim instead of known+null", () => {
  const developmentCase = byCaseId.get("DEV008");
  const first = buildReferenceCoreCandidateForEvaluation(developmentCase);
  const second = buildReferenceCoreCandidateForEvaluation(
    structuredClone(developmentCase),
  );

  assert.equal(first.consequence.level, "low");
  assert.equal(first.consequence.claim_ref, "ref-dev008-consequence");
  assert.equal(
    first.claims.some(
      (claim) => claim.claim_id === first.consequence.claim_ref,
    ),
    true,
  );
  assert.deepEqual(second, first);
});

test("reference Candidate builder fails closed instead of truncating or inventing support", () => {
  const oversizedTitle = structuredClone(byCaseId.get("DEV001"));
  oversizedTitle.input.message.subject = "A".repeat(101);
  assert.throws(
    () => buildReferenceCoreCandidateForEvaluation(oversizedTitle),
    /exceeds the Core bound/u,
  );

  const unsupportedTopic = structuredClone(byCaseId.get("DEV001"));
  unsupportedTopic.expected.topics[0].evidence_ids = ["unknown-evidence"];
  assert.throws(
    () => buildReferenceCoreCandidateForEvaluation(unsupportedTopic),
    /no evidence-backed Claim/u,
  );

  const unsupportedConsequence = structuredClone(byCaseId.get("DEV008"));
  unsupportedConsequence.expected.consequence.evidence_ids = [];
  assert.throws(
    () => buildReferenceCoreCandidateForEvaluation(unsupportedConsequence),
    /requires bounded source evidence/u,
  );
});
