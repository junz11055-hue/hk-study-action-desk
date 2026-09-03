import assert from "node:assert/strict";
import test from "node:test";

import { hashCanonicalJson } from "../../src/v2/validation/canonical-json.js";
import {
  CoreCandidateValidationError,
  deriveCoreValidationEvidence,
  validateCoreModelInput,
  validateCoreCandidate,
} from "../../src/v2/validation/core-candidate-validator.js";
import {
  CORE_BODY,
  makeCoreCandidate,
  makeCoreModelInput,
} from "./core-test-fixtures.js";

function assertRejected(mutator, code, modelInput = makeCoreModelInput()) {
  const candidate = makeCoreCandidate();
  mutator(candidate, modelInput);
  const before = structuredClone(candidate);
  const hashBefore = hashCanonicalJson(candidate);
  assert.throws(
    () => validateCoreCandidate(candidate, modelInput),
    (error) =>
      error instanceof CoreCandidateValidationError && error.code === code,
  );
  assert.deepStrictEqual(candidate, before);
  assert.equal(hashCanonicalJson(candidate), hashBefore);
}

test("Core validator accepts by identity and derives evidence without changing Candidate", () => {
  const candidate = makeCoreCandidate();
  const modelInput = makeCoreModelInput();
  const before = structuredClone(candidate);
  const hashBefore = hashCanonicalJson(candidate);

  const accepted = validateCoreCandidate(candidate, modelInput);
  const validationEvidence = deriveCoreValidationEvidence(candidate, modelInput);

  assert.strictEqual(accepted, candidate);
  assert.deepStrictEqual(candidate, before);
  assert.equal(hashCanonicalJson(candidate), hashBefore);
  assert.ok(Object.isFrozen(validationEvidence));
  assert.deepEqual(validationEvidence.profile_ref_matches, [
    {
      profile_field_id: "pf-dev001-course-comp7101",
      field_type: "course",
      value: "COMP7101 | Applied Computing",
    },
  ]);

  const first = validationEvidence.body_evidence_locations[0];
  assert.deepEqual(first, {
    evidence_id: "ev-dev001-audience",
    source: "body",
    locator: {
      kind: "utf16_range",
      start: 0,
      end: "COMP7101 students must submit Assignment 1".length,
    },
  });
  assert.equal(
    modelInput.message.body.slice(first.locator.start, first.locator.end),
    candidate.evidence[0].quote,
  );
  assert.equal(Object.hasOwn(candidate.evidence[0], "locator"), false);
});

test("Core validator rejects schema defects without filling or mapping fields", () => {
  assertRejected(
    (candidate) => delete candidate.summary_zh,
    "candidate_schema_invalid",
  );
  assertRejected(
    (candidate) => (candidate.claims[0].debug = true),
    "candidate_schema_invalid",
  );
});

test("Core validator recursively rejects every Harness-owned field", async (t) => {
  const forbidden = [
    "incoming_disposition",
    "protection_result",
    "source_truth_id",
    "source_status",
    "action_channel_status",
    "relation_truth_id",
    "home_section",
    "notification_channel",
    "calendar_candidate",
    "calendar_eligible",
    "resulting_item",
    "fact_states",
    "blocked_capabilities",
    "north_star_eligible",
    "north_star_maturity_status",
    "read_status",
    "management_status",
    "item_status",
    "version_status",
    "visibility_status",
    "due_status",
    "source_mode",
    "tool_calls",
    "tools",
  ];

  await t.test("root depth", () =>
    assertRejected(
      (candidate) => (candidate.home_section = "要处理"),
      "candidate_forbidden_field",
    ));
  for (const key of forbidden) {
    await t.test(`nested ${key}`, () =>
      assertRejected(
        (candidate) => (candidate.claims[0][key] = null),
        "candidate_forbidden_field",
      ));
  }
});

test("Core validator recursively rejects secret material and external-action claims", () => {
  assertRejected(
    (candidate) => (candidate.claims[0].api_key = "synthetic-value"),
    "candidate_secret_detected",
  );
  assertRejected(
    (candidate) =>
      (candidate.consequence.reason_zh =
        "Authorization: Bearer synthetic-token-value"),
    "candidate_secret_detected",
  );
  assertRejected(
    (candidate) => (candidate.summary_zh = "系统已经成功为你提交作业。"),
    "candidate_external_action_claim",
  );
});

test("Core validator closes and deduplicates every Candidate reference", async (t) => {
  const cases = [
    [
      "duplicate claim ID",
      (value) => (value.claims[1].claim_id = value.claims[0].claim_id),
    ],
    ["dangling title claim", (value) => (value.title_claim_refs = ["missing"])],
    [
      "duplicate summary claim",
      (value) =>
        (value.summary_claim_refs = [
          "cl-dev001-action",
          "cl-dev001-action",
        ]),
    ],
    ["dangling topic claim", (value) => (value.topics[0].claim_refs = ["missing"])],
    [
      "dangling claim evidence",
      (value) => (value.claims[0].evidence_refs = ["missing"]),
    ],
    [
      "dangling applicability claim",
      (value) => (value.applicability.claim_ref = "missing"),
    ],
    [
      "profile outside allowlist",
      (value) => (value.applicability.profile_field_ids = ["pf-not-projected"]),
    ],
    [
      "duplicate profile ID",
      (value) =>
        (value.applicability.profile_field_ids = [
          "pf-dev001-course-comp7101",
          "pf-dev001-course-comp7101",
        ]),
    ],
    ["dangling action claim", (value) => (value.actions[0].claim_refs = ["missing"])],
    ["dangling deadline claim", (value) => (value.deadlines[0].claim_ref = "missing")],
    [
      "dangling consequence claim",
      (value) => (value.consequence.claim_ref = "missing"),
    ],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, () =>
      assertRejected(mutate, "candidate_reference_invalid"));
  }
});

test("Core validator requires each quote to occur in body exactly once", () => {
  assertRejected(
    (candidate) => (candidate.evidence[0].quote = "not present in body"),
    "candidate_evidence_invalid",
  );

  const repeatedBody = `${CORE_BODY} COMP7101 students must submit Assignment 1`;
  assertRejected(
    () => {},
    "candidate_evidence_invalid",
    makeCoreModelInput(repeatedBody),
  );
});

test("Core validator derives JavaScript UTF-16 ranges deterministically", () => {
  const body = `📚 ${CORE_BODY}`;
  const candidate = makeCoreCandidate();
  const evidence = deriveCoreValidationEvidence(
    candidate,
    makeCoreModelInput(body),
  );
  const first = evidence.body_evidence_locations[0];
  assert.equal(first.locator.start, 3);
  assert.equal(
    body.slice(first.locator.start, first.locator.end),
    candidate.evidence[0].quote,
  );
});

test("Core deadline original_text must be supported by its referenced Claim evidence", () => {
  assertRejected(
    (candidate) => (candidate.deadlines[0].original_text = "Assignment 1"),
    "candidate_evidence_invalid",
  );
});

test("Core applicability and consequence require coherent supporting references", () => {
  assertRejected(
    (candidate) => (candidate.applicability.claim_ref = null),
    "candidate_reference_invalid",
  );
  assertRejected(
    (candidate) => (candidate.applicability.profile_field_ids = []),
    "candidate_reference_invalid",
  );
  assertRejected(
    (candidate) => (candidate.applicability.scope = "not_applicable"),
    "candidate_reference_invalid",
  );
  assertRejected(
    (candidate) => (candidate.consequence.claim_ref = null),
    "candidate_reference_invalid",
  );
});

test("Core validator fails closed on expanded or malformed Model Input", () => {
  assertRejected(
    (_candidate, input) => (input.repair_feedback = null),
    "candidate_context_invalid",
  );
  assertRejected(
    (_candidate, input) => delete input.message.subject,
    "candidate_context_invalid",
  );
  const duplicateProfileInput = makeCoreModelInput();
  duplicateProfileInput.profile_refs.push({
    ...duplicateProfileInput.profile_refs[0],
  });
  assertRejected(
    () => {},
    "candidate_context_invalid",
    duplicateProfileInput,
  );
});

test("Core validator rejects cyclic non-JSON Candidates with a controlled error", () => {
  const candidate = makeCoreCandidate();
  candidate.claims[0].cycle = candidate;
  assert.throws(
    () => validateCoreCandidate(candidate, makeCoreModelInput()),
    (error) =>
      error instanceof CoreCandidateValidationError &&
      error.code === "candidate_schema_invalid",
  );
});

test("Core Model Input gate accepts only the fixed bounded DEV001 projection", () => {
  const input = makeCoreModelInput();
  assert.strictEqual(validateCoreModelInput(input), input);

  for (const mutate of [
    (value) => { value.repair_feedback = null; },
    (value) => { value.message.language = "zh-Hant"; },
    (value) => { value.message.body = value.message.body.replace("https://", "http://"); },
    (value) => { value.message.subject = "See www.example.invalid"; },
    (value) => { value.profile_refs[0].field_type = "programme"; },
    (value) => { value.profile_refs[0].value = "x".repeat(201); },
    (value) => { value.profile_refs.push(structuredClone(value.profile_refs[0])); },
  ]) {
    const rejected = makeCoreModelInput();
    mutate(rejected);
    assert.throws(
      () => validateCoreModelInput(rejected),
      (error) =>
        error instanceof CoreCandidateValidationError &&
        error.code === "candidate_context_invalid",
    );
  }
});

test("Core Candidate requires a Han character in every Chinese-owned field", async (t) => {
  const cases = [
    ["title", (value) => { value.title_zh = "Assignment deadline"; }],
    ["summary", (value) => { value.summary_zh = "Submit before the deadline"; }],
    ["applicability", (value) => { value.applicability.reason_zh = "Course match"; }],
    ["claim", (value) => { value.claims[0].text_zh = "Students in COMP7101"; }],
    ["action actor", (value) => { value.actions[0].actor_zh = "COMP7101 students"; }],
    ["action verb", (value) => { value.actions[0].verb_zh = "submit"; }],
    ["action object", (value) => { value.actions[0].object_zh = "Assignment 1"; }],
    ["consequence", (value) => { value.consequence.reason_zh = "Zero marks"; }],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, () =>
      assertRejected(mutate, "candidate_language_invalid"));
  }
});
