function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const DEV001_SYNTHETIC_MOCK_CANDIDATE = deepFreeze({
  title_zh: "COMP7101 作业一截止通知",
  title_claim_refs: ["cl-dev001-deadline"],
  summary_zh: "COMP7101 学生必须按时提交作业一，迟交且没有获批延期将记零分。",
  summary_claim_refs: [
    "cl-dev001-action",
    "cl-dev001-deadline",
    "cl-dev001-consequence"
  ],
  topics: [
    {
      label: "专业与课程",
      claim_refs: ["cl-dev001-audience", "cl-dev001-action"]
    }
  ],
  applicability: {
    scope: "confirmed_course",
    value: "applies",
    reason_zh: "邮件课程代码与已确认课程 COMP7101 一致。",
    claim_ref: "cl-dev001-audience",
    profile_field_ids: ["pf-dev001-course-comp7101"]
  },
  claims: [
    {
      claim_id: "cl-dev001-audience",
      type: "audience",
      text_zh: "通知面向 COMP7101 学生。",
      high_impact: true,
      evidence_refs: ["ev-dev001-audience"]
    },
    {
      claim_id: "cl-dev001-action",
      type: "action",
      text_zh: "学生必须提交 Assignment 1。",
      high_impact: true,
      evidence_refs: ["ev-dev001-audience"]
    },
    {
      claim_id: "cl-dev001-deadline",
      type: "deadline",
      text_zh: "截止时间为 2026 年 8 月 31 日香港时间下午 5 时。",
      high_impact: true,
      evidence_refs: ["ev-dev001-deadline"]
    },
    {
      claim_id: "cl-dev001-consequence",
      type: "consequence",
      text_zh: "没有获批延期时，迟交记零分。",
      high_impact: true,
      evidence_refs: ["ev-dev001-consequence"]
    }
  ],
  evidence: [
    {
      evidence_id: "ev-dev001-audience",
      quote: "COMP7101 students must submit Assignment 1"
    },
    {
      evidence_id: "ev-dev001-deadline",
      quote: "by 5:00 pm HKT on 31 August 2026"
    },
    {
      evidence_id: "ev-dev001-consequence",
      quote: "Late submissions receive zero marks"
    }
  ],
  actions: [
    {
      action_id: "act-dev001-submit",
      actor_zh: "COMP7101 学生",
      verb_zh: "提交",
      object_zh: "作业一（Assignment 1）",
      obligation: "mandatory",
      claim_refs: ["cl-dev001-action", "cl-dev001-deadline"]
    }
  ],
  deadlines: [
    {
      deadline_id: "deadline-dev001-submit",
      original_text: "5:00 pm HKT on 31 August 2026",
      role: "submission_deadline",
      claim_ref: "cl-dev001-deadline"
    }
  ],
  consequence: {
    level: "medium",
    reason_zh: "没有获批延期时，迟交作业记零分。",
    claim_ref: "cl-dev001-consequence"
  }
});

// Reviewed, fully synthetic DEV001 Candidate captured during the consumed D36
// smoke. Product runtime never reads the private .runtime capture directory.
export const DEV001_CAPTURED_REPLAY_CANDIDATE = deepFreeze({
  actions: [
    {
      action_id: "a1",
      actor_zh: "COMP7101学生",
      claim_refs: ["c1"],
      object_zh: "作业1（Assignment 1）至 https://learn.harbour.invalid/comp7101",
      obligation: "mandatory",
      verb_zh: "提交"
    }
  ],
  applicability: {
    claim_ref: "c1",
    profile_field_ids: ["pf-dev001-course-comp7101"],
    reason_zh: "消息明确面向COMP7101学生，当前用户档案包含该课程（pf-dev001-course-comp7101）。",
    scope: "confirmed_course",
    value: "applies"
  },
  claims: [
    {
      claim_id: "c1",
      evidence_refs: ["e1"],
      high_impact: false,
      text_zh: "COMP7101学生须于2026年8月31日下午5:00（HKT）前通过指定链接提交作业1。",
      type: "assignment_submission"
    },
    {
      claim_id: "c2",
      evidence_refs: ["e2"],
      high_impact: false,
      text_zh: "除非已获批准的延期，迟交作业将得零分。",
      type: "late_penalty"
    }
  ],
  consequence: {
    claim_ref: "c2",
    level: "medium",
    reason_zh: "迟交将导致该次作业得零分，属于单个作业评分的可恢复损失。"
  },
  deadlines: [
    {
      claim_ref: "c1",
      deadline_id: "d1",
      original_text: "5:00 pm HKT on 31 August 2026",
      role: "submission_deadline"
    }
  ],
  evidence: [
    {
      evidence_id: "e1",
      quote: "COMP7101 students must submit Assignment 1 through https://learn.harbour.invalid/comp7101 by 5:00 pm HKT on 31 August 2026"
    },
    {
      evidence_id: "e2",
      quote: "Late submissions receive zero marks unless an approved extension exists."
    }
  ],
  summary_claim_refs: ["c1", "c2"],
  summary_zh: "COMP7101 学生须于2026年8月31日17:00（HKT）前通过指定链接提交作业1；迟交且无获准延期者将得零分。",
  title_claim_refs: ["c1"],
  title_zh: "COMP7101 作业1提交截止提醒",
  topics: [
    {
      claim_refs: ["c1", "c2"],
      label: "专业与课程"
    }
  ]
});

export const DEV001_CAPTURED_REPLAY_CANDIDATE_HASH =
  "sha256:c4d6c1812c15fb996519d499c887da573ca36ac7f152d76042b341c1066eaf3a";
