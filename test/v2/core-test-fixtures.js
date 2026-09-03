export const CORE_BODY =
  "COMP7101 students must submit Assignment 1 through https://learn.harbour.invalid/comp7101 by 5:00 pm HKT on 31 August 2026. Late submissions receive zero marks unless an approved extension exists.";

export function makeCoreModelInput(body = CORE_BODY) {
  return {
    task_type: "analyze_school_notification_core",
    target_language: "zh-Hans",
    candidate_schema_version: "notification-analysis-core-candidate-p1-v2",
    message: {
      subject: "COMP7101 Assignment 1 deadline",
      language: "en",
      body,
    },
    profile_refs: [
      {
        profile_field_id: "pf-dev001-course-comp7101",
        field_type: "course",
        value: "COMP7101 | Applied Computing",
      },
    ],
  };
}

export function makeCoreCandidate() {
  return {
    title_zh: "COMP7101 作业一截止通知",
    title_claim_refs: ["cl-dev001-deadline"],
    summary_zh: "COMP7101 学生必须按时提交作业一，迟交且没有获批延期将记零分。",
    summary_claim_refs: [
      "cl-dev001-action",
      "cl-dev001-deadline",
      "cl-dev001-consequence",
    ],
    topics: [
      {
        label: "专业与课程",
        claim_refs: ["cl-dev001-audience", "cl-dev001-action"],
      },
    ],
    applicability: {
      scope: "confirmed_course",
      value: "applies",
      reason_zh: "邮件课程代码与已确认课程 COMP7101 一致。",
      claim_ref: "cl-dev001-audience",
      profile_field_ids: ["pf-dev001-course-comp7101"],
    },
    claims: [
      {
        claim_id: "cl-dev001-audience",
        type: "audience",
        text_zh: "通知面向 COMP7101 学生。",
        high_impact: true,
        evidence_refs: ["ev-dev001-audience"],
      },
      {
        claim_id: "cl-dev001-action",
        type: "action",
        text_zh: "学生必须提交 Assignment 1。",
        high_impact: true,
        evidence_refs: ["ev-dev001-audience"],
      },
      {
        claim_id: "cl-dev001-deadline",
        type: "deadline",
        text_zh: "截止时间为 2026 年 8 月 31 日香港时间下午 5 时。",
        high_impact: true,
        evidence_refs: ["ev-dev001-deadline"],
      },
      {
        claim_id: "cl-dev001-consequence",
        type: "consequence",
        text_zh: "没有获批延期时，迟交记零分。",
        high_impact: true,
        evidence_refs: ["ev-dev001-consequence"],
      },
    ],
    evidence: [
      {
        evidence_id: "ev-dev001-audience",
        quote: "COMP7101 students must submit Assignment 1",
      },
      {
        evidence_id: "ev-dev001-deadline",
        quote: "by 5:00 pm HKT on 31 August 2026",
      },
      {
        evidence_id: "ev-dev001-consequence",
        quote: "Late submissions receive zero marks",
      },
    ],
    actions: [
      {
        action_id: "act-dev001-submit",
        actor_zh: "COMP7101 学生",
        verb_zh: "提交",
        object_zh: "作业一（Assignment 1）",
        obligation: "mandatory",
        claim_refs: ["cl-dev001-action", "cl-dev001-deadline"],
      },
    ],
    deadlines: [
      {
        deadline_id: "deadline-dev001-submit",
        original_text: "5:00 pm HKT on 31 August 2026",
        role: "submission_deadline",
        claim_ref: "cl-dev001-deadline",
      },
    ],
    consequence: {
      level: "medium",
      reason_zh: "没有获批延期时，迟交作业记零分。",
      claim_ref: "cl-dev001-consequence",
    },
  };
}
