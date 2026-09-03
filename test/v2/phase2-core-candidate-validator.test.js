import assert from "node:assert/strict";
import test from "node:test";

import { hashCanonicalJson } from "../../src/v2/validation/canonical-json.js";
import {
  derivePhase2CoreValidationEvidence,
  validatePhase2CoreCandidate,
} from "../../src/v2/validation/phase2-core-candidate-validator.js";
import { makeCoreCandidate, makeCoreModelInput } from "./core-test-fixtures.js";

function candidate() {
  return structuredClone(makeCoreCandidate());
}

function input() {
  return structuredClone(makeCoreModelInput());
}

test("Phase 2 Candidate Validator accepts by identity without mutation", () => {
  const value = candidate();
  const modelInput = input();
  const before = hashCanonicalJson(value);

  assert.equal(validatePhase2CoreCandidate(value, modelInput), value);
  assert.equal(hashCanonicalJson(value), before);
});

test("Phase 2 Candidate Validator accepts multiple allowed profile references", () => {
  const value = candidate();
  const modelInput = input();
  modelInput.profile_refs.push({
    profile_field_id: "pf-dev001-school",
    field_type: "school",
    value: "港湾大学",
  });

  assert.equal(validatePhase2CoreCandidate(value, modelInput), value);
});

test("Phase 2 Candidate Validator derives exact UTF-16 locators and profile matches", () => {
  const value = candidate();
  const modelInput = input();
  const derived = derivePhase2CoreValidationEvidence(value, modelInput);
  const firstQuote = value.evidence[0].quote;
  const firstStart = modelInput.message.body.indexOf(firstQuote);

  assert.deepEqual(derived.body_evidence_locations[0], {
    evidence_id: value.evidence[0].evidence_id,
    source: "body",
    locator: {
      kind: "utf16_range",
      start: firstStart,
      end: firstStart + firstQuote.length,
    },
  });
  assert.deepEqual(derived.profile_ref_matches, [modelInput.profile_refs[0]]);
  assert.equal(Object.isFrozen(derived), true);
});

test("Phase 2 Candidate Validator rejects an unprojected profile reference", () => {
  const value = candidate();
  value.applicability.profile_field_ids = ["pf-not-projected"];
  assert.throws(
    () => validatePhase2CoreCandidate(value, input()),
    { code: "candidate_reference_invalid" },
  );
});

test("Phase 2 Candidate Validator rejects a quote absent from the body", () => {
  const value = candidate();
  value.evidence[0].quote = "正文中不存在的逐字证据";
  assert.throws(
    () => validatePhase2CoreCandidate(value, input()),
    { code: "candidate_evidence_invalid" },
  );
});

test("Phase 2 Candidate Validator rejects a quote that is not unique", () => {
  const value = candidate();
  const modelInput = input();
  const quote = value.evidence[0].quote;
  modelInput.message.body = `${modelInput.message.body} ${quote}`;
  assert.throws(
    () => validatePhase2CoreCandidate(value, modelInput),
    { code: "candidate_evidence_invalid" },
  );
});

test("Phase 2 Candidate Validator rejects an unsupported deadline original text", () => {
  const value = candidate();
  value.deadlines[0].original_text = "1 September 2026";
  assert.throws(
    () => validatePhase2CoreCandidate(value, input()),
    { code: "candidate_evidence_invalid" },
  );
});

test("Phase 2 Candidate Validator rejects a known consequence without a Claim", () => {
  const value = candidate();
  value.consequence.claim_ref = null;
  assert.throws(
    () => validatePhase2CoreCandidate(value, input()),
    { code: "candidate_reference_invalid" },
  );
});

test("Phase 2 Candidate Validator preserves Core forbidden-field failures", () => {
  const value = candidate();
  value.home_section = "要处理";
  assert.throws(
    () => validatePhase2CoreCandidate(value, input()),
    { code: "candidate_forbidden_field" },
  );
});

test("Phase 2 Candidate Validator is insensitive to valid array order and IDs", () => {
  const value = candidate();
  value.claims.reverse();
  value.evidence.reverse();
  value.claims.forEach((claim, index) => {
    const oldId = claim.claim_id;
    const newId = `renamed-claim-${index}`;
    claim.claim_id = newId;
    value.title_claim_refs = value.title_claim_refs.map((id) =>
      id === oldId ? newId : id,
    );
    value.summary_claim_refs = value.summary_claim_refs.map((id) =>
      id === oldId ? newId : id,
    );
    value.topics.forEach((topic) => {
      topic.claim_refs = topic.claim_refs.map((id) =>
        id === oldId ? newId : id,
      );
    });
    if (value.applicability.claim_ref === oldId) {
      value.applicability.claim_ref = newId;
    }
    value.actions.forEach((action) => {
      action.claim_refs = action.claim_refs.map((id) =>
        id === oldId ? newId : id,
      );
    });
    value.deadlines.forEach((deadline) => {
      if (deadline.claim_ref === oldId) deadline.claim_ref = newId;
    });
    if (value.consequence.claim_ref === oldId) {
      value.consequence.claim_ref = newId;
    }
  });

  assert.equal(validatePhase2CoreCandidate(value, input()), value);
});
