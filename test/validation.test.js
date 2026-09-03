import test from "node:test";
import assert from "node:assert/strict";

import {
  CardValidationError,
  validateActionCard,
  validateFollowUp,
} from "../src/agent/validation.js";
import { DEPOSIT_EMAIL, DEPOSIT_QUOTE, makeValidActionCard } from "./fixtures.js";

function rejectsCard(mutator, pattern) {
  const card = makeValidActionCard();
  mutator(card);
  assert.throws(() => validateActionCard(card, DEPOSIT_EMAIL), CardValidationError);
  if (pattern) assert.throws(() => validateActionCard(card, DEPOSIT_EMAIL), pattern);
}

test("validateActionCard accepts a complete evidenced card and returns a new object", () => {
  const candidate = makeValidActionCard();
  const result = validateActionCard(candidate, DEPOSIT_EMAIL);

  assert.notStrictEqual(result, candidate);
  assert.equal(result.messageId, DEPOSIT_EMAIL.id);
  assert.equal(result.actions[0].dueAt, "2026-09-04T17:00:00+08:00");
  assert.equal(result.evidence[0].quote, DEPOSIT_QUOTE);
  assert.ok(Object.isFrozen(result));
});

test("validateActionCard rejects a result for a different message", () => {
  rejectsCard((card) => {
    card.messageId = "another-message";
  }, /does not match/i);
});

test("validateActionCard rejects non-object and incomplete roots", () => {
  assert.throws(() => validateActionCard([], DEPOSIT_EMAIL), CardValidationError);
  assert.throws(() => validateActionCard({ messageId: DEPOSIT_EMAIL.id }, DEPOSIT_EMAIL), /required/i);
});

test("validateActionCard rejects unexpected capability fields", () => {
  rejectsCard((card) => {
    card.toolCalls = [{ name: "calendar.write" }];
  }, /unsupported fields/i);
});

test("validateActionCard rejects forged evidence not present in the source email", () => {
  rejectsCard((card) => {
    card.evidence[0].quote = "The university guarantees that the payment was completed.";
  }, /not in the synthetic source/i);
});

test("validateActionCard rejects missing and dangling evidence references", async (t) => {
  await t.test("empty action evidence", () => {
    rejectsCard((card) => {
      card.actions[0].evidenceIds = [];
    }, /invalid evidence references/i);
  });

  await t.test("unknown date evidence", () => {
    rejectsCard((card) => {
      card.dates[0].evidenceIds = ["invented-evidence"];
    }, /invalid evidence references/i);
  });
});

test("validateActionCard rejects calendar eligibility without a normalized due date", () => {
  rejectsCard((card) => {
    card.actions[0].dueAt = null;
    card.actions[0].calendarEligible = true;
  }, /cannot be calendar eligible/i);
});

test("validateActionCard fails closed for ambiguous or low-confidence normalized dates", async (t) => {
  await t.test("ambiguous", () => {
    rejectsCard((card) => {
      card.dates[0].status = "ambiguous";
    }, /cannot normalize/i);
  });

  await t.test("low confidence", () => {
    rejectsCard((card) => {
      card.dates[0].confidence = "low";
    }, /cannot normalize/i);
  });
});

test("validateActionCard rejects a well-formed date that contradicts the frozen synthetic facts", () => {
  rejectsCard((card) => {
    card.actions[0].dueAt = "2026-09-05T17:00:00+08:00";
    card.dates[0].normalizedAt = "2026-09-05T17:00:00+08:00";
  }, /trusted synthetic date facts/i);
});

test("validateActionCard rejects invalid enums, duplicate IDs and duplicate risk flags", async (t) => {
  await t.test("invalid importance", () => {
    rejectsCard((card) => {
      card.importance = "super-urgent";
    }, /invalid value/i);
  });

  await t.test("duplicate evidence id", () => {
    const duplicate = { ...makeValidActionCard().evidence[0] };
    rejectsCard((card) => {
      card.evidence.push(duplicate);
    }, /duplicate id/i);
  });

  await t.test("duplicate risk flag", () => {
    rejectsCard((card) => {
      card.riskFlags = ["prompt_injection", "prompt_injection"];
    }, /must be unique/i);
  });
});

test("validateActionCard rejects malformed dates and null bytes", async (t) => {
  await t.test("malformed date", () => {
    rejectsCard((card) => {
      card.actions[0].dueAt = "September forty-eleventh";
    }, /(ISO|RFC 3339) date-time/i);
  });

  await t.test("null byte", () => {
    rejectsCard((card) => {
      card.summaryZh = "安全摘要\u0000隐藏内容";
    }, /null byte/i);
  });
});

test("validateActionCard does not copy prototype-pollution or constructor fields", () => {
  const parsed = JSON.parse(JSON.stringify(makeValidActionCard()));
  Object.defineProperty(parsed, "__proto__", {
    value: { isAdmin: true },
    enumerable: true,
  });

  assert.throws(() => validateActionCard(parsed, DEPOSIT_EMAIL), /unsupported fields/i);
  assert.equal({}.isAdmin, undefined);
});

test("validateFollowUp only accepts evidence copied from the current synthetic email", () => {
  const result = validateFollowUp(
    {
      answerZh: "邮件要求在截止前完成付款。",
      evidenceQuotes: [DEPOSIT_QUOTE],
      uncertainty: null,
    },
    DEPOSIT_EMAIL,
  );
  assert.deepEqual(result.evidenceQuotes, [DEPOSIT_QUOTE]);

  assert.throws(
    () =>
      validateFollowUp(
        {
          answerZh: "已经替你付款。",
          evidenceQuotes: ["Payment has already been made for you."],
          uncertainty: null,
        },
        DEPOSIT_EMAIL,
      ),
    /not in the synthetic source/i,
  );
});
