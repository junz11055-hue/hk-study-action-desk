import test from "node:test";
import assert from "node:assert/strict";

import { hashCanonicalJson } from "../../src/v2/validation/canonical-json.js";
import {
  CandidateValidationError,
  validateNotificationAnalysisCandidate,
} from "../../src/v2/validation/candidate-validator.js";

const BODY =
  "COMP7101 students must submit Assignment 1 through https://learn.harbour.invalid/comp7101 by 5:00 pm HKT on 31 August 2026. Late submissions receive zero marks unless an approved extension exists.";

function makeModelInput(body = BODY) {
  return {
    task_type: "analyze_school_notification_candidate",
    target_language: "zh-Hans",
    candidate_schema_version: "notification-analysis-candidate-p1-v1",
    repair_feedback: null,
    current_time_hkt: "2026-08-29T12:00:00+08:00",
    timezone: "Asia/Hong_Kong",
    message_context: {
      thread_id: "DEV-THREAD-PAIR-01",
      source_message_id: "DEV-SRC-PAIR-01",
    },
    profile: {
      timezone: {
        profile_field_id: "pf-dev001-timezone",
        value: "Asia/Hong_Kong",
        source: "synthetic_fixture",
        confirmation_status: "confirmed",
        valid_until: "2027-08-31",
      },
      school: {
        profile_field_id: "pf-dev001-school",
        value: "港湾大学",
        source: "synthetic_invite_profile",
        confirmation_status: "confirmed",
        valid_until: "2027-08-31",
      },
      project: {
        profile_field_id: "pf-dev001-project",
        value: "MSc Computing",
        source: "synthetic_user_confirmed",
        confirmation_status: "confirmed",
        valid_until: "2027-08-31",
      },
      cohort: {
        profile_field_id: "pf-dev001-cohort",
        value: "2026",
        source: "synthetic_user_confirmed",
        confirmation_status: "confirmed",
        valid_until: "2027-08-31",
      },
      term: {
        profile_field_id: "pf-dev001-term",
        value: "2026 Fall",
        source: "synthetic_user_confirmed",
        confirmation_status: "confirmed",
        valid_until: "2026-12-31",
      },
      courses: [
        {
          profile_field_id: "pf-dev001-course-comp7101",
          code: "COMP7101",
          name: "Applied Computing",
          aliases: ["AC"],
          status: "confirmed",
          source: "synthetic_user_confirmed",
          confirmation_status: "confirmed",
          valid_until: "2026-12-31",
        },
      ],
    },
    message: {
      notification_id: "DEV-NOTIF-PAIR-01",
      body,
      attachments: [],
    },
    historical_items: [],
  };
}

function courseRef() {
  return {
    profile_field_id: "pf-dev001-course-comp7101",
    value: "COMP7101",
    source: "synthetic_user_confirmed",
    confirmation_status: "confirmed",
    valid_until: "2026-12-31",
    course_status: "confirmed",
  };
}

function makeCandidate(body = BODY) {
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
      profile_field_refs: [courseRef()],
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
          end: body.length,
        },
        quote: body,
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

function assertRejected(mutator, code, input = makeModelInput()) {
  const candidate = makeCandidate(input.message.body);
  mutator(candidate, input);
  const before = structuredClone(candidate);
  assert.throws(
    () => validateNotificationAnalysisCandidate(candidate, input),
    (error) => error instanceof CandidateValidationError && error.code === code,
  );
  assert.deepStrictEqual(candidate, before);
}

test("Validator accepts by identity and leaves Candidate bytes semantically unchanged", () => {
  const input = makeModelInput();
  const candidate = makeCandidate();
  const before = structuredClone(candidate);
  const hashBefore = hashCanonicalJson(candidate);

  const accepted = validateNotificationAnalysisCandidate(candidate, input);

  assert.strictEqual(accepted, candidate);
  assert.deepStrictEqual(candidate, before);
  assert.equal(hashCanonicalJson(candidate), hashBefore);
});

test("Validator rejects schema errors without filling or mapping fields", () => {
  assertRejected((candidate) => delete candidate.summary_zh, "candidate_schema_invalid");
  assertRejected((candidate) => (candidate.claims[0].unexpected = true), "candidate_schema_invalid");
});

test("Validator recursively rejects every Harness-owned key at root and depth", async (t) => {
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

  await t.test("root-level field", () => {
    assertRejected((candidate) => (candidate.home_section = "要处理"), "candidate_forbidden_field");
  });

  for (const key of forbidden) {
    await t.test(key, () => {
      assertRejected((candidate) => (candidate.claims[0][key] = null), "candidate_forbidden_field");
    });
  }
});

test("Validator closes notification, claim, evidence and collection ID references", async (t) => {
  await t.test("notification mismatch", () =>
    assertRejected((candidate) => (candidate.notification_id = "OTHER"), "candidate_reference_invalid"));
  await t.test("dangling title claim", () =>
    assertRejected((candidate) => (candidate.title_claim_refs = ["missing"]), "candidate_reference_invalid"));
  await t.test("duplicate summary refs", () =>
    assertRejected(
      (candidate) => (candidate.summary_claim_refs = ["cl-dev001-1", "cl-dev001-1"]),
      "candidate_reference_invalid",
    ));
  await t.test("dangling topic evidence", () =>
    assertRejected(
      (candidate) => (candidate.topics[0].evidence_ids = ["missing"]),
      "candidate_reference_invalid",
    ));
  await t.test("duplicate evidence ID", () =>
    assertRejected((candidate) => candidate.evidence.push({ ...candidate.evidence[0] }), "candidate_reference_invalid"));
  await t.test("duplicate action ID", () =>
    assertRejected((candidate) => candidate.actions.push({ ...candidate.actions[0] }), "candidate_reference_invalid"));
  await t.test("dangling action claim", () =>
    assertRejected((candidate) => (candidate.actions[0].claim_refs = ["missing"]), "candidate_reference_invalid"));
  await t.test("high-impact claim without evidence", () =>
    assertRejected((candidate) => (candidate.claims[0].evidence_ids = []), "candidate_cross_field_invalid"));
});

test("Validator uses exact JavaScript UTF-16 source slicing, including repeated text and emoji", async (t) => {
  await t.test("wrong start/end", () =>
    assertRejected((candidate) => (candidate.evidence[0].locator.start = 1), "candidate_locator_invalid"));
  await t.test("forged quote", () =>
    assertRejected((candidate) => (candidate.evidence[0].quote = "forged"), "candidate_locator_invalid"));
  await t.test("body locator cannot name an attachment", () =>
    assertRejected(
      (candidate) => (candidate.evidence[0].locator.attachment_id = "ATT-1"),
      "candidate_locator_invalid",
    ));
  await t.test("DEV001 has no attachment evidence", () =>
    assertRejected(
      (candidate) => {
        candidate.evidence[0].source = "attachment";
        candidate.evidence[0].locator.kind = "attachment_page_range";
        candidate.evidence[0].locator.attachment_id = "ATT-1";
        candidate.evidence[0].locator.page_number = 1;
      },
      "candidate_locator_invalid",
    ));
  await t.test("subject cannot be an evidence source", () =>
    assertRejected(
      (candidate) => (candidate.evidence[0].source = "subject"),
      "candidate_schema_invalid",
    ));
  await t.test("repeated quote is located by the supplied range, not first match", () => {
    const input = makeModelInput("same same");
    const candidate = makeCandidate("same same");
    candidate.evidence[0].locator.start = 5;
    candidate.evidence[0].locator.end = 9;
    candidate.evidence[0].quote = "same";
    assert.strictEqual(validateNotificationAnalysisCandidate(candidate, input), candidate);
  });
  await t.test("emoji occupies two UTF-16 code units", () => {
    const input = makeModelInput("A😀B");
    const candidate = makeCandidate("A😀B");
    candidate.evidence[0].locator.start = 1;
    candidate.evidence[0].locator.end = 3;
    candidate.evidence[0].quote = "😀";
    assert.strictEqual(validateNotificationAnalysisCandidate(candidate, input), candidate);
  });
});

test("Validator accepts parsed attachment page ranges but rejects mismatched attachment coordinates", async (t) => {
  const input = makeModelInput("body");
  input.message.attachments = [
    {
      attachment_id: "ATT-1",
      parse_status: "parsed",
      pages: [{ page: 1, text: "Page 😀 evidence" }],
    },
  ];
  const candidate = makeCandidate("body");
  candidate.evidence[0] = {
    evidence_id: "ev-dev001-1",
    source: "attachment",
    locator: {
      kind: "attachment_page_range",
      attachment_id: "ATT-1",
      page_number: 1,
      start: 5,
      end: 7,
    },
    quote: "😀",
  };
  assert.strictEqual(validateNotificationAnalysisCandidate(candidate, input), candidate);

  await t.test("wrong page", () => {
    candidate.evidence[0].locator.page_number = 2;
    assert.throws(
      () => validateNotificationAnalysisCandidate(candidate, input),
      (error) => error.code === "candidate_locator_invalid",
    );
  });
});

test("Validator requires exact, closed and current profile references for applied scope", async (t) => {
  await t.test("unknown profile field", () =>
    assertRejected(
      (candidate) => (candidate.applicability.profile_field_refs[0].profile_field_id = "missing"),
      "candidate_reference_invalid",
    ));
  await t.test("copied value mismatch", () =>
    assertRejected(
      (candidate) => (candidate.applicability.profile_field_refs[0].value = "COMP9999"),
      "candidate_reference_invalid",
    ));
  await t.test("required scope without profile", () =>
    assertRejected(
      (candidate) => (candidate.applicability.profile_field_refs = []),
      "candidate_cross_field_invalid",
    ));
  await t.test("applies without claim", () =>
    assertRejected(
      (candidate) => (candidate.applicability.applicability_claim_id = null),
      "candidate_cross_field_invalid",
    ));
  await t.test("possibly applies requires a gap", () =>
    assertRejected(
      (candidate) => {
        candidate.applicability.value = "possibly_applies";
        candidate.applicability.gaps = [];
      },
      "candidate_cross_field_invalid",
    ));
  await t.test("expired applied profile", () => {
    const input = makeModelInput();
    input.profile.courses[0].valid_until = "2026-08-28";
    assertRejected(
      (candidate) => (candidate.applicability.profile_field_refs[0].valid_until = "2026-08-28"),
      "candidate_cross_field_invalid",
      input,
    );
  });
});

test("Validator enforces conditional obligation combinations", async (t) => {
  await t.test("valid met conditional obligation", () => {
    const input = makeModelInput();
    const candidate = makeCandidate();
    Object.assign(candidate.actions[0], {
      obligation: "conditional_mandatory",
      condition: "仅 COMP7101 学生需要提交。",
      condition_status: "met",
      condition_claim_refs: ["cl-dev001-1"],
      condition_basis_refs: [courseRef()],
    });
    assert.strictEqual(validateNotificationAnalysisCandidate(candidate, input), candidate);
  });
  await t.test("conditional obligation lacks condition claim", () =>
    assertRejected(
      (candidate) => {
        candidate.actions[0].obligation = "conditional_mandatory";
        candidate.actions[0].condition = "仅课程学生需要提交。";
        candidate.actions[0].condition_status = "unknown";
      },
      "candidate_cross_field_invalid",
    ));
  await t.test("met conditional lacks basis", () =>
    assertRejected(
      (candidate) => {
        Object.assign(candidate.actions[0], {
          obligation: "conditional_mandatory",
          condition: "仅课程学生需要提交。",
          condition_status: "met",
          condition_claim_refs: ["cl-dev001-1"],
        });
      },
      "candidate_cross_field_invalid",
    ));
  await t.test("non-conditional obligation carries a condition", () =>
    assertRejected(
      (candidate) => (candidate.actions[0].condition = "不应存在"),
      "candidate_cross_field_invalid",
    ));
});

test("Validator closes date, history, consequence, suggestion and risk boundaries", async (t) => {
  await t.test("invalid calendar date", () =>
    assertRejected(
      (candidate) => (candidate.dates[0].normalized = "2026-02-31T17:00:00+08:00"),
      "candidate_cross_field_invalid",
    ));
  await t.test("wrong Hong Kong offset", () =>
    assertRejected(
      (candidate) => (candidate.dates[0].normalized = "2026-08-31T09:00:00Z"),
      "candidate_cross_field_invalid",
    ));
  await t.test("key change points at absent history", () =>
    assertRejected(
      (candidate) =>
        candidate.key_changes.push({
          change_id: "chg-1",
          field: "deadline",
          old_value: "old",
          new_value: "new",
          related_historical_item_ids: ["missing"],
          claim_id: "cl-dev001-1",
          evidence_ids: ["ev-dev001-1"],
        }),
      "candidate_reference_invalid",
    ));
  await t.test("key change cannot be null to null", () =>
    assertRejected(
      (candidate) =>
        candidate.key_changes.push({
          change_id: "chg-1",
          field: "deadline",
          old_value: null,
          new_value: null,
          related_historical_item_ids: [],
          claim_id: "cl-dev001-1",
          evidence_ids: ["ev-dev001-1"],
        }),
      "candidate_cross_field_invalid",
    ));
  await t.test("known consequence requires claim and evidence", () =>
    assertRejected(
      (candidate) => {
        candidate.consequence.claim_id = null;
        candidate.consequence.evidence_ids = [];
      },
      "candidate_cross_field_invalid",
    ));
  await t.test("management suggestion requires a claim", () =>
    assertRejected(
      (candidate) => (candidate.management_suggestions[0].claim_refs = ["missing"]),
      "candidate_reference_invalid",
    ));
  await t.test("management suggestion cannot direct payment", () =>
    assertRejected(
      (candidate) => (candidate.management_suggestions[0].text = "请立即付款。"),
      "candidate_forbidden_action",
    ));
  await t.test("security risk needs closed claim and evidence", () =>
    assertRejected(
      (candidate) =>
        candidate.security_risks.push({
          risk_id: "risk-1",
          risk_type: "phishing",
          description: "存在风险。",
          claim_id: "missing",
          evidence_ids: ["ev-dev001-1"],
          verification_advice: "请通过学校官网独立核对。",
        }),
      "candidate_reference_invalid",
    ));
  await t.test("security advice cannot request credentials", () =>
    assertRejected(
      (candidate) =>
        candidate.security_risks.push({
          risk_id: "risk-1",
          risk_type: "credential_request",
          description: "邮件索取凭证。",
          claim_id: "cl-dev001-1",
          evidence_ids: ["ev-dev001-1"],
          verification_advice: "回复邮件并提供密码。",
        }),
      "candidate_forbidden_action",
    ));
});

test("Validator fails closed on secret-like material and external-success claims", async (t) => {
  await t.test("secret", () =>
    assertRejected(
      (candidate) => (candidate.summary_zh = "Authorization: Bearer abcdefghijklmnop"),
      "candidate_secret_detected",
    ));
  await t.test("external action success", () =>
    assertRejected(
      (candidate) => (candidate.summary_zh = "已经替用户付款。"),
      "candidate_external_action_claim",
    ));
});

test("Validator reports malformed trusted context as a controlled error", () => {
  const input = makeModelInput();
  input.message.attachments = {};
  assert.throws(
    () => validateNotificationAnalysisCandidate(makeCandidate(), input),
    (error) =>
      error instanceof CandidateValidationError && error.code === "candidate_context_invalid",
  );
});
