import test from "node:test";
import assert from "node:assert/strict";

import Ajv2020 from "ajv/dist/2020.js";

import {
  CANDIDATE_SCHEMA_DIALECT,
  CANDIDATE_SCHEMA_NAME,
  CANDIDATE_SCHEMA_VERSION,
  NOTIFICATION_ANALYSIS_CANDIDATE_P1_SCHEMA,
} from "../../src/v2/contracts/notification-analysis-candidate-p1.schema.js";

const BODY =
  "COMP7101 students must submit Assignment 1 through https://learn.harbour.invalid/comp7101 by 5:00 pm HKT on 31 August 2026. Late submissions receive zero marks unless an approved extension exists.";

function makeCandidate() {
  return {
    notification_id: "DEV-NOTIF-PAIR-01",
    source_language: "en",
    title_zh: "COMP7101 作业一截止通知",
    title_claim_refs: ["cl-dev001-1"],
    summary_zh: "课程邮件要求学生在截止时间前提交作业一。",
    summary_claim_refs: ["cl-dev001-1"],
    topics: [{ label: "专业与课程", evidence_ids: ["ev-dev001-1"] }],
    applicability: {
      scope: "confirmed_course",
      value: "applies",
      reason: "邮件明确面向 COMP7101 学生。",
      applicability_claim_id: "cl-dev001-1",
      evidence_ids: ["ev-dev001-1"],
      profile_field_refs: [
        {
          profile_field_id: "pf-dev001-course-comp7101",
          value: "COMP7101",
          source: "synthetic_user_confirmed",
          confirmation_status: "confirmed",
          valid_until: "2026-12-31",
          course_status: "confirmed",
        },
      ],
      gaps: [],
    },
    claims: [
      {
        claim_id: "cl-dev001-1",
        type: "assignment_deadline",
        text: "COMP7101 学生必须在截止时间前提交作业一。",
        high_impact: true,
        evidence_ids: ["ev-dev001-1"],
      },
    ],
    evidence: [
      {
        evidence_id: "ev-dev001-1",
        source: "body",
        locator: {
          kind: "utf16_range",
          attachment_id: null,
          page_number: null,
          start: 0,
          end: BODY.length,
        },
        quote: BODY,
      },
    ],
    actions: [
      {
        action_id: "act-dev001-1",
        actor: "COMP7101 学生",
        verb: "提交",
        object: "作业一",
        condition: null,
        materials: [],
        obligation: "mandatory",
        condition_status: "not_applicable",
        condition_claim_refs: [],
        condition_basis_refs: [],
        claim_refs: ["cl-dev001-1"],
      },
    ],
    management_suggestions: [
      {
        suggestion_id: "sug-dev001-1",
        text: "可在个人待办中记录截止时间。",
        reason: "便于自行管理时间。",
        claim_refs: ["cl-dev001-1"],
      },
    ],
    dates: [
      {
        date_id: "date-dev001-1",
        original_text: "5:00 pm HKT on 31 August 2026",
        role: "submission_deadline",
        normalized: "2026-08-31T17:00:00+08:00",
        timezone: "Asia/Hong_Kong",
        conflict: false,
        claim_id: "cl-dev001-1",
        evidence_ids: ["ev-dev001-1"],
      },
    ],
    key_changes: [],
    consequence: {
      level: "high",
      reason: "逾期提交通常记零分。",
      claim_id: "cl-dev001-1",
      evidence_ids: ["ev-dev001-1"],
    },
    security_risks: [],
    uncertainties: [],
  };
}

test("Candidate contract freezes its identity, dialect and provider-safe core schema", () => {
  assert.equal(CANDIDATE_SCHEMA_DIALECT, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(CANDIDATE_SCHEMA_VERSION, "notification-analysis-candidate-p1-v1");
  assert.equal(CANDIDATE_SCHEMA_NAME, "notification_analysis_candidate_p1_v1");
  assert.equal(Object.hasOwn(NOTIFICATION_ANALYSIS_CANDIDATE_P1_SCHEMA, "$schema"), false);
  assert.ok(Object.isFrozen(NOTIFICATION_ANALYSIS_CANDIDATE_P1_SCHEMA));

  const allowedKeywords = new Set([
    "type",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "enum",
    "pattern",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "minimum",
    "maximum",
  ]);

  function inspect(schema, path = "$schema") {
    for (const key of Object.keys(schema)) {
      assert.ok(allowedKeywords.has(key), `${path} uses unsupported keyword ${key}`);
    }
    if (schema.type === "object") {
      assert.equal(schema.additionalProperties, false, `${path} must fail closed`);
      for (const [name, child] of Object.entries(schema.properties)) {
        inspect(child, `${path}.properties.${name}`);
      }
    }
    if (schema.items) inspect(schema.items, `${path}.items`);
  }

  inspect(NOTIFICATION_ANALYSIS_CANDIDATE_P1_SCHEMA);
});

test("Candidate schema compiles under strict Ajv Draft 2020-12 and accepts its complete shape", () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const validate = ajv.compile(NOTIFICATION_ANALYSIS_CANDIDATE_P1_SCHEMA);
  assert.equal(validate(makeCandidate()), true, JSON.stringify(validate.errors));
});

test("Candidate schema requires every root field and rejects extra fields at every object level", async (t) => {
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(
    NOTIFICATION_ANALYSIS_CANDIDATE_P1_SCHEMA,
  );

  await t.test("missing root field", () => {
    const candidate = makeCandidate();
    delete candidate.uncertainties;
    assert.equal(validate(candidate), false);
    assert.ok(validate.errors.some((error) => error.keyword === "required"));
  });

  await t.test("extra root field", () => {
    const candidate = makeCandidate();
    candidate.home_section = "要处理";
    assert.equal(validate(candidate), false);
    assert.ok(validate.errors.some((error) => error.keyword === "additionalProperties"));
  });

  await t.test("extra nested locator field", () => {
    const candidate = makeCandidate();
    candidate.evidence[0].locator.encoding = "utf8";
    assert.equal(validate(candidate), false);
    assert.ok(validate.errors.some((error) => error.keyword === "additionalProperties"));
  });

  await t.test("extra nested profile field", () => {
    const candidate = makeCandidate();
    candidate.applicability.profile_field_refs[0].trusted = true;
    assert.equal(validate(candidate), false);
    assert.ok(validate.errors.some((error) => error.keyword === "additionalProperties"));
  });
});

test("Candidate schema enforces enum, pattern, null and array boundaries", async (t) => {
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(
    NOTIFICATION_ANALYSIS_CANDIDATE_P1_SCHEMA,
  );

  const rejects = (mutate) => {
    const candidate = makeCandidate();
    mutate(candidate);
    assert.equal(validate(candidate), false);
  };

  await t.test("invalid source language", () => rejects((value) => (value.source_language = "english")));
  await t.test("invalid ID", () => rejects((value) => (value.claims[0].claim_id = "bad id")));
  await t.test("invalid snake case", () => rejects((value) => (value.dates[0].role = "Due Date")));
  await t.test("title too long", () => rejects((value) => (value.title_zh = "字".repeat(101))));
  await t.test("empty title references", () => rejects((value) => (value.title_claim_refs = [])));
  await t.test("too many actions", () =>
    rejects((value) => {
      value.actions = Array.from({ length: 13 }, (_, index) => ({
        ...value.actions[0],
        action_id: `act-${index}`,
      }));
    }));
  await t.test("non-nullable claim", () => rejects((value) => (value.claims[0].text = null)));
  await t.test("nullable date", () => {
    const candidate = makeCandidate();
    candidate.dates[0].normalized = null;
    assert.equal(validate(candidate), true, JSON.stringify(validate.errors));
  });
});
