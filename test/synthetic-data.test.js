import test from "node:test";
import assert from "node:assert/strict";

import {
  SYNTHETIC_EMAILS,
  getSyntheticEmail,
  listSyntheticEmailSummaries,
} from "../src/data/synthetic-emails.js";
import { getPresetActionCard } from "../src/data/preset-action-cards.js";
import { validateActionCard } from "../src/agent/validation.js";

test("every bundled message is unmistakably synthetic and uses a non-deliverable sender domain", () => {
  assert.ok(SYNTHETIC_EMAILS.length >= 6);

  for (const email of SYNTHETIC_EMAILS) {
    assert.match(email.school, /合成/);
    assert.match(email.senderEmail, /\.invalid$/);
    assert.match(email.body, /synthetic|合成/i);
    assert.equal(getSyntheticEmail(email.id), email);
  }
});

test("message summaries never expose the source body", () => {
  const summaries = listSyntheticEmailSummaries();
  assert.equal(summaries.length, SYNTHETIC_EMAILS.length);
  for (const summary of summaries) {
    assert.equal("body" in summary, false);
  }
});

test("every bundled preset passes the same validation gate used for model output", () => {
  for (const email of SYNTHETIC_EMAILS) {
    const preset = getPresetActionCard(email.id);
    assert.ok(preset, `missing preset for ${email.id}`);
    assert.doesNotThrow(() => validateActionCard(preset, email), email.id);
  }
});

test("preset access returns defensive clones", () => {
  const first = getPresetActionCard("deposit-deadline");
  first.summaryZh = "mutated";
  first.actions[0].labelZh = "mutated action";

  const second = getPresetActionCard("deposit-deadline");
  assert.notEqual(second.summaryZh, "mutated");
  assert.notEqual(second.actions[0].labelZh, "mutated action");
});

test("the Prompt Injection challenge is blocked from calendar eligibility", () => {
  const card = getPresetActionCard("prompt-injection-phishing");
  assert.deepEqual(
    new Set(card.riskFlags),
    new Set(["prompt_injection", "phishing", "sensitive_data_request"]),
  );
  assert.equal(card.isSchoolRelated, false);
  assert.ok(card.actions.every((action) => action.calendarEligible === false));
  assert.ok(card.actions.every((action) => action.dueAt === null));
  assert.equal(card.dates.length, 0);
});

test("the validation gate rejects model output that hides or follows the synthetic attack", () => {
  const email = getSyntheticEmail("prompt-injection-phishing");

  const hiddenRisk = getPresetActionCard(email.id);
  hiddenRisk.riskFlags = ["phishing", "sensitive_data_request"];
  assert.throws(() => validateActionCard(hiddenRisk, email), /must flag prompt injection/i);

  const unsafeAction = getPresetActionCard(email.id);
  unsafeAction.actions[0].labelZh = "回复密码和验证码以保留邮箱访问权限";
  assert.throws(() => validateActionCard(unsafeAction, email), /cannot recommend sharing/i);
});
