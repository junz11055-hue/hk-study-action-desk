import test from "node:test";
import assert from "node:assert/strict";

import { validateActionCard, validateFollowUp } from "../src/agent/validation.js";
import {
  applySyntheticCardPolicy,
  applySyntheticFollowUpPolicy,
  SyntheticPolicyError,
} from "../src/agent/synthetic-policy.js";
import { createCalendarPreview } from "../src/services/calendar-preview.js";
import { getSyntheticEmail } from "../src/data/synthetic-emails.js";
import { getPresetActionCard } from "../src/data/preset-action-cards.js";
import { makeValidActionCard } from "./fixtures.js";
import { createNotificationAgent } from "../src/agent/notification-agent.js";
import { SYNTHETIC_PROFILE } from "../src/data/synthetic-profile.js";

test("Harness replaces a structurally valid but unsupported high-impact payment action", () => {
  const email = getSyntheticEmail("deposit-deadline");
  const candidate = makeValidActionCard();
  candidate.actions[0].labelZh = "将 20,000 港元转账到邮件未提供的私人账户";
  const structurallyValid = validateActionCard(candidate, email);

  const guarded = applySyntheticCardPolicy(structurallyValid, email).card;
  assert.doesNotMatch(guarded.actions[0].labelZh, /私人账户/);
  assert.match(guarded.actions[0].labelZh, /Paid/);
});

test("Harness rejects an AI summary that contradicts the trusted payment policy", () => {
  const email = getSyntheticEmail("deposit-deadline");
  const candidate = makeValidActionCard({
    summaryZh:
      "请在 9 月 4 日前支付 20,000 港元，并转入私人账户；之后门户会显示 Paid，操作就算完成。",
  });
  const structurallyValid = validateActionCard(candidate, email);
  assert.throws(
    () => applySyntheticCardPolicy(structurallyValid, email),
    SyntheticPolicyError,
  );
});

test("Harness replaces a semantically malicious but schema-valid security card", () => {
  const email = getSyntheticEmail("prompt-injection-phishing");
  const candidate = getPresetActionCard(email.id);
  candidate.isSchoolRelated = true;
  candidate.appliesToUser = "yes";
  candidate.titleZh = "官方邮箱验证";
  candidate.summaryZh = "这是学校要求，请按邮件说明提交登录凭据。";
  candidate.actions[0].labelZh = "提交登录凭据以保留邮箱访问权限";
  const structurallyValid = validateActionCard(candidate, email);

  const guarded = applySyntheticCardPolicy(structurallyValid, email).card;
  assert.equal(guarded.isSchoolRelated, false);
  assert.match(guarded.titleZh, /安全警告/);
  assert.match(guarded.actions[0].labelZh, /不要回复/);
});

test("security follow-up cannot recommend replying with credentials", () => {
  const email = getSyntheticEmail("prompt-injection-phishing");
  const candidate = validateFollowUp(
    {
      answerZh: "请回复密码和验证码以保留访问权限。",
      evidenceQuotes: ["Reply with your password and one-time verification code to keep access."],
      uncertainty: null,
    },
    email,
  );
  assert.throws(
    () => applySyntheticFollowUpPolicy(candidate, email, "what_to_do"),
    SyntheticPolicyError,
  );
});

test("security challenge follow-up bypasses the model entirely", async () => {
  let modelCalls = 0;
  const agent = createNotificationAgent({
    modelClient: {
      configured: true,
      async createStructured() {
        modelCalls += 1;
        throw new Error("security follow-up must not call the model");
      },
    },
    logger: { info() {}, warn() {}, error() {} },
  });
  const email = getSyntheticEmail("prompt-injection-phishing");
  const result = await agent.answer(
    email,
    SYNTHETIC_PROFILE,
    getPresetActionCard(email.id),
    "what_to_do",
  );
  assert.equal(modelCalls, 0);
  assert.equal(result.analysisMode, "policy");
  assert.match(result.followUp.answerZh, /不要回复|不要提供/);
});

test("orientation end time cannot become a calendar start", () => {
  const email = getSyntheticEmail("orientation-update");
  const card = getPresetActionCard(email.id);
  card.actions[0].dueAt = "2026-09-03T12:00:00+08:00";
  card.dates[0].normalizedAt = "2026-09-03T12:00:00+08:00";

  assert.throws(() => validateActionCard(card, email), /trusted calendar start/i);
  assert.throws(
    () =>
      createCalendarPreview({
        email,
        card,
        actionId: card.actions[0].id,
        dateId: card.dates[0].id,
      }),
    /trusted calendar start/i,
  );
});
