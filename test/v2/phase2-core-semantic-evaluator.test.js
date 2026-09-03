import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PHASE2_CORE_OVERLAP_CASE_IDS,
  buildReferenceCoreCandidateForEvaluation,
  projectCoreOverlapOracle,
} from "../../src/v2/phase2/core-overlap-oracle-projector.js";
import {
  PHASE2_CORE_SEMANTIC_EVALUATOR_VERSION,
  evaluateCoreCandidateSemantics,
} from "../../src/v2/phase2/core-semantic-evaluator.js";
import { projectPhase2DevelopmentInput } from "../../src/v2/phase2/development-input-snapshot-builder.js";
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

function fixture(caseId = "DEV001") {
  const developmentCase = byCaseId.get(caseId);
  const oracle = projectCoreOverlapOracle(developmentCase);
  const candidate = buildReferenceCoreCandidateForEvaluation(
    developmentCase,
    oracle,
  );
  const modelInput = projectPhase2DevelopmentInput(developmentCase);
  return { developmentCase, oracle, candidate, modelInput };
}

function remapIdsAndReverse(candidate) {
  const remapped = structuredClone(candidate);
  const claimIds = new Map(
    remapped.claims.map((claim, index) => [claim.claim_id, `claim-${index + 1}`]),
  );
  const evidenceIds = new Map(
    remapped.evidence.map((item, index) => [
      item.evidence_id,
      `evidence-${index + 1}`,
    ]),
  );
  const mapClaims = (refs) => refs.map((id) => claimIds.get(id));
  const mapEvidence = (refs) => refs.map((id) => evidenceIds.get(id));

  remapped.title_claim_refs = mapClaims(remapped.title_claim_refs);
  remapped.summary_claim_refs = mapClaims(remapped.summary_claim_refs).reverse();
  for (const topic of remapped.topics) {
    topic.claim_refs = mapClaims(topic.claim_refs).reverse();
  }
  remapped.applicability.claim_ref = claimIds.get(
    remapped.applicability.claim_ref,
  );
  remapped.applicability.profile_field_ids.reverse();
  for (const claim of remapped.claims) {
    claim.claim_id = claimIds.get(claim.claim_id);
    claim.evidence_refs = mapEvidence(claim.evidence_refs).reverse();
  }
  for (const item of remapped.evidence) {
    item.evidence_id = evidenceIds.get(item.evidence_id);
  }
  for (let index = 0; index < remapped.actions.length; index += 1) {
    remapped.actions[index].action_id = `action-${index + 1}`;
    remapped.actions[index].claim_refs = mapClaims(
      remapped.actions[index].claim_refs,
    ).reverse();
  }
  for (let index = 0; index < remapped.deadlines.length; index += 1) {
    remapped.deadlines[index].deadline_id = `deadline-${index + 1}`;
    remapped.deadlines[index].claim_ref = claimIds.get(
      remapped.deadlines[index].claim_ref,
    );
  }
  remapped.consequence.claim_ref = claimIds.get(remapped.consequence.claim_ref);

  remapped.topics.reverse();
  remapped.claims.reverse();
  remapped.evidence.reverse();
  remapped.actions.reverse();
  remapped.deadlines.reverse();
  return remapped;
}

test("reference Candidates pass all six automatic dimensions for 16/16 cases", () => {
  for (const caseId of PHASE2_CORE_OVERLAP_CASE_IDS) {
    const { oracle, candidate, modelInput } = fixture(caseId);
    const before = hashCanonicalJson(candidate);
    const result = evaluateCoreCandidateSemantics({
      oracle,
      candidate,
      modelInput,
    });

    assert.equal(result.evaluator_version, PHASE2_CORE_SEMANTIC_EVALUATOR_VERSION);
    assert.equal(result.case_id, caseId);
    assert.equal(result.automatic.passed, true, caseId);
    assert.deepEqual(result.automatic.totals, {
      dimensions_total: 6,
      dimensions_exact: 6,
      tp: result.automatic.totals.tp,
      fp: 0,
      fn: 0,
    });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(
      result.review_queue.map((item) => item.code),
      [
        "title_summary",
        "claim_evidence_semantics",
        "applicability_semantics",
        "action_text_semantics",
        "consequence_reason_semantics",
      ],
    );
    assert.equal(result.review_queue.length, 5);
    assert.equal(
      result.review_queue.every((item) => item.status === "pending"),
      true,
    );
    assert.equal(hashCanonicalJson(candidate), before);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.automatic.dimensions), true);
  }
});

test("Evaluator ignores Candidate IDs, reference order, and semantic array order", () => {
  const { oracle, candidate, modelInput } = fixture("DEV003");
  const remapped = remapIdsAndReverse(candidate);

  const baseline = evaluateCoreCandidateSemantics({
    oracle,
    candidate,
    modelInput,
  });
  const changedIdsAndOrder = evaluateCoreCandidateSemantics({
    oracle,
    candidate: remapped,
    modelInput,
  });

  assert.deepEqual(changedIdsAndOrder, baseline);
  assert.equal(hashCanonicalJson(changedIdsAndOrder), hashCanonicalJson(baseline));
});

test("Evaluator detects every frozen single-field mutation with stable diagnostics", async (t) => {
  const mutations = [
    {
      name: "topic FP",
      caseId: "DEV001",
      mutate: (candidate) =>
        candidate.topics.push({
          label: "其他校务资讯",
          claim_refs: [candidate.claims[0].claim_id],
        }),
      code: "topic_unexpected",
      path: "/topics",
      severity: "P1",
    },
    {
      name: "topic FN",
      caseId: "DEV003",
      mutate: (candidate) => candidate.topics.shift(),
      code: "topic_missing",
      path: "/topics",
      severity: "P1",
    },
    {
      name: "applicability reversal",
      caseId: "DEV001",
      mutate: (candidate) => {
        candidate.applicability.value = "not_applicable";
        candidate.applicability.scope = "not_applicable";
      },
      code: "applicability_value_mismatch",
      path: "/applicability/value",
      severity: "P0",
    },
    {
      name: "high-impact not-applicable upgraded to applies",
      caseId: "DEV004",
      mutate: (candidate) => {
        candidate.applicability.value = "applies";
        candidate.applicability.scope = "cohort";
      },
      code: "applicability_value_mismatch",
      path: "/applicability/value",
      severity: "P0",
    },
    {
      name: "low-impact applicability reversal",
      caseId: "DEV005",
      mutate: (candidate) => {
        candidate.applicability.value = "not_applicable";
        candidate.applicability.scope = "not_applicable";
      },
      code: "applicability_value_mismatch",
      path: "/applicability/value",
      severity: "P1",
    },
    {
      name: "profile ref FP",
      caseId: "DEV001",
      mutate: (candidate, modelInput, oracle) => {
        const extra = modelInput.profile_refs.find(
          ({ profile_field_id: profileFieldId }) =>
            !oracle.applicability.profile_field_ids.includes(profileFieldId),
        );
        candidate.applicability.profile_field_ids.push(extra.profile_field_id);
      },
      code: "profile_field_id_unexpected",
      path: "/applicability/profile_field_ids",
      severity: "P0",
    },
    {
      name: "profile ref FN",
      caseId: "DEV003",
      mutate: (candidate) => candidate.applicability.profile_field_ids.pop(),
      code: "profile_field_id_missing",
      path: "/applicability/profile_field_ids",
      severity: "P0",
    },
    {
      name: "low-impact profile ref FP",
      caseId: "DEV005",
      mutate: (candidate, modelInput, oracle) => {
        const extra = modelInput.profile_refs.find(
          ({ profile_field_id: profileFieldId }) =>
            !oracle.applicability.profile_field_ids.includes(profileFieldId),
        );
        candidate.applicability.profile_field_ids.push(extra.profile_field_id);
      },
      code: "profile_field_id_unexpected",
      path: "/applicability/profile_field_ids",
      severity: "P1",
    },
    {
      name: "action add",
      caseId: "DEV005",
      mutate: (candidate) =>
        candidate.actions.push({
          ...structuredClone(candidate.actions[0]),
          action_id: "extra-action",
        }),
      code: "action_unexpected",
      path: "/actions",
      severity: "P1",
    },
    {
      name: "mandatory action remove",
      caseId: "DEV001",
      mutate: (candidate) => candidate.actions.pop(),
      code: "action_missing",
      path: "/actions",
      severity: "P0",
    },
    {
      name: "optional upgraded to mandatory",
      caseId: "DEV005",
      mutate: (candidate) => (candidate.actions[0].obligation = "mandatory"),
      code: "action_obligation_mismatch",
      path: "/actions/*/obligation",
      severity: "P0",
    },
    {
      name: "deadline original text",
      caseId: "DEV001",
      mutate: (candidate) =>
        (candidate.deadlines[0].original_text = "31 August 2026"),
      code: "deadline_original_text_mismatch",
      path: "/deadlines/*/original_text",
      severity: "P0",
    },
    {
      name: "deadline role",
      caseId: "DEV001",
      mutate: (candidate) =>
        (candidate.deadlines[0].role = "payment_deadline"),
      code: "deadline_role_mismatch",
      path: "/deadlines/*/role",
      severity: "P0",
    },
    {
      name: "low-impact deadline original text",
      caseId: "DEV005",
      mutate: (candidate) =>
        (candidate.deadlines[0].original_text = "9 月 8 日"),
      code: "deadline_original_text_mismatch",
      path: "/deadlines/*/original_text",
      severity: "P1",
    },
    {
      name: "consequence level",
      caseId: "DEV001",
      mutate: (candidate) => (candidate.consequence.level = "low"),
      code: "consequence_level_mismatch",
      path: "/consequence/level",
      severity: "P0",
    },
    {
      name: "low-impact consequence level",
      caseId: "DEV005",
      mutate: (candidate) => (candidate.consequence.level = "medium"),
      code: "consequence_level_mismatch",
      path: "/consequence/level",
      severity: "P1",
    },
  ];

  for (const mutation of mutations) {
    await t.test(mutation.name, () => {
      const { oracle, candidate, modelInput } = fixture(mutation.caseId);
      mutation.mutate(candidate, modelInput, oracle);
      const before = hashCanonicalJson(candidate);
      const first = evaluateCoreCandidateSemantics({
        oracle,
        candidate,
        modelInput,
      });
      const second = evaluateCoreCandidateSemantics({
        oracle,
        candidate,
        modelInput,
      });

      assert.equal(first.automatic.passed, false);
      const diagnostic = first.errors.find(
        (item) => item.code === mutation.code,
      );
      assert.ok(diagnostic, JSON.stringify(first.errors));
      assert.equal(diagnostic.path, mutation.path);
      assert.equal(diagnostic.severity, mutation.severity);
      assert.equal(hashCanonicalJson(candidate), before);
      assert.deepEqual(second, first);
      assert.equal(hashCanonicalJson(second), hashCanonicalJson(first));
    });
  }
});

test("manual-only wording changes stay pending instead of being auto-passed", () => {
  const { oracle, candidate, modelInput } = fixture("DEV001");
  candidate.actions[0].actor_zh = "课程学生本人";
  candidate.actions[0].verb_zh = "递交";
  candidate.applicability.reason_zh = "你不属于该对象，但此句仅供人工发现。";
  candidate.consequence.reason_zh = "需要人工核对的另一种说法。";
  const deadline = candidate.deadlines[0];
  const originalDeadlineClaim = candidate.claims.find(
    ({ claim_id: claimId }) => claimId === deadline.claim_ref,
  );
  const wrongDeadlineClaim = candidate.claims.find(
    ({ claim_id: claimId }) => claimId !== deadline.claim_ref,
  );
  assert.ok(originalDeadlineClaim);
  assert.ok(wrongDeadlineClaim);
  originalDeadlineClaim.type = "other";
  originalDeadlineClaim.high_impact = false;
  wrongDeadlineClaim.evidence_refs.push(...originalDeadlineClaim.evidence_refs);
  deadline.claim_ref = wrongDeadlineClaim.claim_id;

  const result = evaluateCoreCandidateSemantics({
    oracle,
    candidate,
    modelInput,
  });
  assert.equal(result.automatic.passed, true);
  assert.deepEqual(result.errors, []);
  const claimReview = result.review_queue.find(
    (item) => item.code === "claim_evidence_semantics",
  );
  assert.equal(claimReview.status, "pending");
  assert.match(claimReview.instruction, /type/u);
  assert.match(claimReview.instruction, /high_impact/u);
  assert.match(claimReview.instruction, /deadline/u);
  assert.equal(
    result.review_queue.find((item) => item.code === "applicability_semantics")
      .status,
    "pending",
  );
  assert.equal(
    result.review_queue.find((item) => item.code === "action_text_semantics")
      .status,
    "pending",
  );
  assert.equal(
    result.review_queue.find(
      (item) => item.code === "consequence_reason_semantics",
    ).status,
    "pending",
  );
});
