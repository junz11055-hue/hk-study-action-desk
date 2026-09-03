import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
} from "../../src/v2/contracts/notification-analysis-core-candidate-p1-v2.schema.js";
import {
  buildReferenceCoreCandidateForEvaluation,
  projectCoreOverlapOracle,
} from "../../src/v2/phase2/core-overlap-oracle-projector.js";
import {
  loadPhase2rDevelopmentInput,
  loadPhase2rDevelopmentInputs,
} from "../../src/v2/phase2r/phase2r-development-input-loader.js";
import {
  buildPhase2rcRequestDescriptor,
  PHASE2RC_MAX_REQUEST_UTF8_BYTES,
  PHASE2RC_PROMPT_HASH,
  PHASE2RC_SCHEMA_HASH,
} from "../../src/v2/phase2rc/phase2rc-request-contract.js";
import {
  Phase2rcSemanticGateError,
  validatePhase2rcSemanticCandidate,
} from "../../src/v2/phase2rc/phase2rc-semantic-gate.js";
import {
  CORE_PROMPT_REGISTRY_VERSIONS,
  resolveCorePromptContract,
} from "../../src/v2/prompts/core-prompt-registry.js";
import {
  NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V1,
  PHASE2R_CORE_PROMPT_VERSION,
} from "../../src/v2/prompts/notification-analysis-core-p2-v1.js";
import {
  NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V2,
  PHASE2RC_CORE_PROMPT_VERSION,
} from "../../src/v2/prompts/notification-analysis-core-p2-v2.js";
import { hashCanonicalJson, hashUtf8 } from "../../src/v2/validation/canonical-json.js";

const CASE_IDS = Object.freeze([
  "DEV001", "DEV003", "DEV004", "DEV005", "DEV006", "DEV007",
  "DEV008", "DEV010", "DEV017", "DEV018", "DEV019", "DEV020",
  "DEV022", "DEV023", "DEV024", "DEV025",
]);
const sourceUrl = new URL(
  "../../docs/fixtures/prd-v0.2/base-development.json",
  import.meta.url,
);
const sourceCases = JSON.parse(await readFile(sourceUrl, "utf8"));
const sourceById = new Map(sourceCases.map((item) => [item.case_id, item]));

async function fixture(caseId) {
  const developmentCase = sourceById.get(caseId);
  const candidate = buildReferenceCoreCandidateForEvaluation(
    developmentCase,
    projectCoreOverlapOracle(developmentCase),
  );
  const { modelInput } = await loadPhase2rDevelopmentInput({ caseId });
  return { candidate: structuredClone(candidate), modelInput };
}

async function issueCodes(caseId, mutate) {
  const { candidate, modelInput } = await fixture(caseId);
  mutate(candidate, modelInput);
  try {
    validatePhase2rcSemanticCandidate(candidate, modelInput);
  } catch (error) {
    assert.ok(error instanceof Phase2rcSemanticGateError);
    assert.equal(error.code, "candidate_semantic_gate_failed");
    assert.doesNotMatch(JSON.stringify(error), /harbour\.invalid/iu);
    return new Set(error.issues.map((issue) => issue.code));
  }
  throw new Error("mutation unexpectedly passed");
}

test("Phase 2R-C appends p2-v2 without changing either historical prompt", () => {
  assert.equal(
    hashUtf8(NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V1),
    "sha256:dade3413a05f2485f22ea6bd5cff8c0c62ef60c5ce1da4ac325775f9dd22b25d",
  );
  assert.equal(PHASE2RC_CORE_PROMPT_VERSION, "notification-analysis-core-prompt-p2-v2");
  assert.equal(
    hashUtf8(NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V2),
    "sha256:78461050b2a0203bfbbf35cfcfe92d9a555e4b3c8e2ebf36452824ce8699e648",
  );
  assert.equal(PHASE2RC_PROMPT_HASH, hashUtf8(NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V2));
  assert.deepEqual(CORE_PROMPT_REGISTRY_VERSIONS.slice(-2), [
    PHASE2R_CORE_PROMPT_VERSION,
    PHASE2RC_CORE_PROMPT_VERSION,
  ]);
  assert.strictEqual(
    resolveCorePromptContract(PHASE2RC_CORE_PROMPT_VERSION).instructions,
    NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V2,
  );
});

test("p2-v2 encodes every manual-review correction without case answers", () => {
  const prompt = NOTIFICATION_ANALYSIS_CORE_PROMPT_P2_V2;
  assert.ok(Buffer.byteLength(prompt, "utf8") <= 5_200);
  assert.match(prompt, /downstream safety effect/iu);
  assert.match(prompt, /mandatory Action.*action and deadline Claims high_impact=true/iu);
  assert.match(prompt, /audience Claim.*high_impact=true/iu);
  assert.match(prompt, /consequence\.level is medium or high/iu);
  assert.match(prompt, /supports the whole Claim/iu);
  assert.match(prompt, /must not be inserted into a body-evidenced Claim/iu);
  assert.match(prompt, /explicitly says no action is required/iu);
  assert.match(prompt, /consequence\.reason_zh must state only the evidenced effect/iu);
  assert.match(prompt, /induction.*入门培训.*安全培训.*never "导修"/iu);
  assert.doesNotMatch(prompt, /DEV\d{3}|COMP\d{4}|港湾大学|harbour\.invalid/iu);
});

test("Phase 2R-C keeps Candidate v2 and the answer-free Input set unchanged", async () => {
  assert.equal(
    PHASE2RC_SCHEMA_HASH,
    "sha256:279562aba228dd9c9d9f7356a32233dfc7270c021b16910bf7b4a9007a0ffb06",
  );
  assert.equal(
    hashCanonicalJson(NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA),
    PHASE2RC_SCHEMA_HASH,
  );
  const inputs = await loadPhase2rDevelopmentInputs();
  const descriptors = inputs.map(({ modelInput }) =>
    buildPhase2rcRequestDescriptor(modelInput),
  );
  assert.equal(descriptors.length, 16);
  assert.ok(
    Math.max(...descriptors.map((item) => item.request_utf8_bytes)) <=
      PHASE2RC_MAX_REQUEST_UTF8_BYTES,
  );
  assert.equal(
    descriptors.every(
      (item) =>
        item.prompt_version === PHASE2RC_CORE_PROMPT_VERSION &&
        item.schema_hash === PHASE2RC_SCHEMA_HASH,
    ),
    true,
  );
});

test("all 16 reference Candidates pass the new offline semantic gate", async () => {
  for (const caseId of CASE_IDS) {
    const { candidate, modelInput } = await fixture(caseId);
    assert.strictEqual(
      validatePhase2rcSemanticCandidate(candidate, modelInput),
      candidate,
      caseId,
    );
  }
});

test("high-impact mutations for mandatory duties and consequences are rejected", async () => {
  for (const caseId of ["DEV001", "DEV010"]) {
    const codes = await issueCodes(caseId, (candidate) => {
      candidate.claims.forEach((claim) => {
        claim.high_impact = false;
      });
    });
    assert.equal(codes.has("mandatory_claim_not_high_impact"), true, caseId);
    assert.equal(codes.has("mandatory_audience_not_high_impact"), true, caseId);
    assert.equal(codes.has("consequence_claim_not_high_impact"), true, caseId);
  }
});

test("source context cannot be laundered into a body-evidenced Claim", async () => {
  const codes = await issueCodes("DEV006", (candidate, modelInput) => {
    const claim = candidate.claims.find(
      (item) => item.claim_id === candidate.applicability.claim_ref,
    );
    claim.text_zh = `${modelInput.source_context.sender_school_name}全校学生可参加活动`;
  });
  assert.equal(codes.has("source_context_not_body_evidenced"), true);
});

test("explicit no-action, applicability, and consequence binding mutations are rejected", async () => {
  const missingNoAction = await issueCodes("DEV008", (candidate) => {
    const fallbackEvidence = candidate.claims[0].evidence_refs[0];
    candidate.claims
      .filter((claim) => claim.type === "action" || claim.type === "consequence")
      .forEach((claim) => {
        claim.evidence_refs = [fallbackEvidence];
      });
  });
  assert.equal(missingNoAction.has("explicit_no_action_evidence_missing"), true);

  const wrongApplicability = await issueCodes("DEV008", (candidate) => {
    candidate.applicability.claim_ref = candidate.claims.find(
      (claim) => claim.type === "schedule",
    ).claim_id;
  });
  assert.equal(wrongApplicability.has("audience_claim_type_invalid"), true);

  const wrongConsequence = await issueCodes("DEV008", (candidate) => {
    candidate.consequence.claim_ref = candidate.claims.find(
      (claim) => claim.type === "schedule",
    ).claim_id;
  });
  assert.equal(
    wrongConsequence.has("explicit_no_action_consequence_binding_invalid"),
    true,
  );
});

test("unsupported recovery language and laboratory induction mistranslation are rejected", async () => {
  const recovery = await issueCodes("DEV001", (candidate) => {
    candidate.consequence.reason_zh += "，属于可恢复损失";
  });
  assert.equal(recovery.has("consequence_reason_recovery_unsupported"), true);

  const terminology = await issueCodes("DEV010", (candidate) => {
    candidate.title_zh = "实验室导修登记";
    candidate.summary_zh = candidate.summary_zh.replaceAll("培训", "导修");
    candidate.claims.forEach((claim) => {
      claim.text_zh = claim.text_zh.replaceAll("培训", "导修");
    });
    candidate.actions.forEach((action) => {
      action.object_zh = action.object_zh.replaceAll("培训", "导修");
    });
  });
  assert.equal(terminology.has("laboratory_induction_translation_invalid"), true);
  assert.equal(terminology.has("laboratory_induction_action_object_invalid"), true);
});
