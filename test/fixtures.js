import { getSyntheticEmail } from "../src/data/synthetic-emails.js";

export const DEPOSIT_EMAIL = getSyntheticEmail("deposit-deadline");

export const DEPOSIT_QUOTE =
  "To keep your place in the MSc programme, please settle the HKD 20,000 tuition deposit by 5:00 p.m. Hong Kong time on 4 September 2026.";

export function makeValidActionCard(overrides = {}) {
  return {
    messageId: DEPOSIT_EMAIL.id,
    isSchoolRelated: true,
    appliesToUser: "yes",
    importance: "critical",
    titleZh: "学费留位费即将截止",
    summaryZh:
      "你需要在 2026 年 9 月 4 日香港时间下午 5 点前缴付 20,000 港元留位费；上传凭证不算完成，须确认门户显示 Paid。",
    language: "english",
    recommendedNotification: "now",
    actions: [
      {
        id: "pay-deposit",
        labelZh: "缴付 20,000 港元留位费",
        kind: "required",
        dueAt: "2026-09-04T17:00:00+08:00",
        calendarEligible: true,
        evidenceIds: ["deposit-deadline-evidence"],
      },
    ],
    dates: [
      {
        id: "deposit-date",
        raw: "5:00 p.m. Hong Kong time on 4 September 2026",
        normalizedAt: "2026-09-04T17:00:00+08:00",
        timezone: "Asia/Hong_Kong",
        confidence: "high",
        status: "confirmed",
        evidenceIds: ["deposit-deadline-evidence"],
      },
    ],
    riskFlags: [],
    uncertainties: [],
    evidence: [
      {
        id: "deposit-deadline-evidence",
        quote: DEPOSIT_QUOTE,
        explanationZh: "邮件明确写出金额、截止日期和香港时间。",
      },
    ],
    ...overrides,
  };
}

export function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function responsesPayload(output) {
  return {
    id: "resp_synthetic_test",
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: JSON.stringify(output) }],
      },
    ],
    usage: { input_tokens: 123, output_tokens: 45 },
  };
}
