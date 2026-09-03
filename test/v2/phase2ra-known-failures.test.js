import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildReferenceCoreCandidateForEvaluation,
  projectCoreOverlapOracle,
} from "../../src/v2/phase2/core-overlap-oracle-projector.js";
import { evaluateCoreCandidateSemantics } from "../../src/v2/phase2/core-semantic-evaluator.js";
import { projectPhase2DevelopmentInput } from "../../src/v2/phase2/development-input-snapshot-builder.js";
import { NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V1 } from "../../src/v2/prompts/notification-analysis-core-p2-v1.js";

const sourceUrl = new URL(
  "../../docs/fixtures/prd-v0.2/base-development.json",
  import.meta.url,
);
const developmentCases = JSON.parse(await readFile(sourceUrl, "utf8"));
const byId = new Map(developmentCases.map((item) => [item.case_id, item]));

const KNOWN_FAILURE_MATRIX = Object.freeze({
  truncated: Object.freeze(["DEV003", "DEV004", "DEV010"]),
  reference_invalid: Object.freeze(["DEV008", "DEV020", "DEV025"]),
  topic: Object.freeze(["DEV001", "DEV018"]),
  applicability: Object.freeze(["DEV005", "DEV006"]),
  action: Object.freeze(["DEV007", "DEV017"]),
  deadline: Object.freeze(["DEV006", "DEV023", "DEV024"]),
  consequence: Object.freeze(["DEV001", "DEV017", "DEV024"]),
});

function fixture(caseId) {
  const developmentCase = byId.get(caseId);
  const oracle = projectCoreOverlapOracle(developmentCase);
  return {
    oracle,
    modelInput: projectPhase2DevelopmentInput(developmentCase),
    candidate: buildReferenceCoreCandidateForEvaluation(developmentCase, oracle),
  };
}

function errorCodes(caseId, mutate) {
  const { oracle, modelInput, candidate } = fixture(caseId);
  mutate(candidate);
  return evaluateCoreCandidateSemantics({ oracle, modelInput, candidate }).errors.map(
    ({ code }) => code,
  );
}

test("Phase 2R freezes all 14 failed development cases into explicit controls", () => {
  const failedCases = [...new Set(Object.values(KNOWN_FAILURE_MATRIX).flat())].sort();
  assert.deepEqual(failedCases, [
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
    "DEV020",
    "DEV023",
    "DEV024",
    "DEV025",
  ]);
  assert.equal(KNOWN_FAILURE_MATRIX.truncated.length, 3);
  assert.equal(KNOWN_FAILURE_MATRIX.reference_invalid.length, 3);
  assert.deepEqual(
    ["DEV019", "DEV022"].filter((caseId) => failedCases.includes(caseId)),
    [],
  );
});

test("Known semantic failure shapes remain machine-detectable", () => {
  assert.ok(
    errorCodes("DEV001", (candidate) => {
      candidate.topics[0].label = "考试与成绩";
    }).includes("topic_missing"),
  );
  assert.ok(
    errorCodes("DEV018", (candidate) => {
      candidate.topics[0].label = "校园活动";
    }).includes("topic_missing"),
  );
  assert.ok(
    errorCodes("DEV005", (candidate) => {
      candidate.applicability.profile_field_ids = [];
    }).includes("profile_field_id_missing"),
  );
  assert.ok(
    errorCodes("DEV006", (candidate) => {
      candidate.applicability.scope = "all_school";
      candidate.applicability.value = "applies";
    }).includes("applicability_value_mismatch"),
  );
  assert.ok(
    errorCodes("DEV006", (candidate) => {
      candidate.claims[1].evidence_refs.push("DEV006-E3");
      candidate.deadlines.push({
        deadline_id: "regression-deadline",
        original_text: "9 月 8 日前",
        role: "registration_deadline",
        claim_ref: candidate.claims[1].claim_id,
      });
    }).includes("deadline_unexpected"),
  );
  assert.ok(
    errorCodes("DEV007", (candidate) => {
      candidate.actions.push({
        action_id: "regression-action",
        actor_zh: "住户",
        verb_zh: "使用",
        object_zh: "备用厨房",
        obligation: "optional",
        claim_refs: [candidate.claims[0].claim_id],
      });
    }).includes("action_unexpected"),
  );
  assert.ok(
    errorCodes("DEV017", (candidate) => {
      candidate.actions.push({
        action_id: "regression-action",
        actor_zh: "当前学生",
        verb_zh: "签到",
        object_zh: "说明会",
        obligation: "mandatory",
        claim_refs: [candidate.claims[1].claim_id],
      });
    }).includes("action_unexpected"),
  );
  assert.ok(
    errorCodes("DEV017", (candidate) => {
      candidate.consequence.level = "high";
    }).includes("consequence_level_mismatch"),
  );
  assert.ok(
    errorCodes("DEV023", (candidate) => {
      candidate.deadlines[0].role = "response_deadline";
    }).includes("deadline_role_mismatch"),
  );
  assert.ok(
    errorCodes("DEV024", (candidate) => {
      candidate.deadlines[0].role = "submission_deadline";
    }).includes("deadline_role_mismatch"),
  );
  assert.ok(
    errorCodes("DEV024", (candidate) => {
      candidate.consequence.level = "high";
    }).includes("consequence_level_mismatch"),
  );
});

test("Phase 2R Prompt contains one generic control for every semantic failure family", () => {
  const prompt = NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V1;
  const controls = {
    topic: /Topic by academic relation/iu,
    applicability: /stated audience with relevant profile values/iu,
    action: /Create Actions only for explicit requested or invited/iu,
    deadline: /Deadlines are action cutoffs only/iu,
    consequence: /Consequence high only/iu,
  };
  for (const [family, pattern] of Object.entries(controls)) {
    assert.ok(KNOWN_FAILURE_MATRIX[family].length >= 2);
    assert.match(prompt, pattern);
  }
});

test("All 16 complete reference Candidates fit the unchanged compact output contract", () => {
  const sizes = developmentCases
    .filter(({ case_id: caseId }) =>
      new Set([
        "DEV001", "DEV003", "DEV004", "DEV005", "DEV006", "DEV007",
        "DEV008", "DEV010", "DEV017", "DEV018", "DEV019", "DEV020",
        "DEV022", "DEV023", "DEV024", "DEV025",
      ]).has(caseId),
    )
    .map(({ case_id: caseId }) =>
      Buffer.byteLength(JSON.stringify(fixture(caseId).candidate), "utf8"),
    );
  assert.equal(sizes.length, 16);
  assert.ok(Math.max(...sizes) <= 3_000);
});
