import assert from "node:assert/strict";
import test from "node:test";

import {
  validateActionCardV02,
} from "../../src/v2/product/action-card-v02.js";
import { validatePhase2aoCandidate } from "../../src/v2/product/candidate-validation.js";
import { buildPhase2aoActionCard } from "../../src/v2/product/deterministic-harness.js";
import { createPhase2aoOfflineAnalyzer } from "../../src/v2/product/offline-analyzers.js";
import { loadPhase2aoProductInput } from "../../src/v2/product/product-input-loader.js";

const ANALYZED_AT = "2026-08-29T12:01:00+08:00";

async function prepare(executionMode = "synthetic_mock") {
  const productInput = await loadPhase2aoProductInput({ caseId: "DEV001" });
  const analyzer = createPhase2aoOfflineAnalyzer({ executionMode });
  const analysis = await analyzer.analyze({
    caseId: "DEV001",
    modelInput: productInput.modelInput,
  });
  const gated = validatePhase2aoCandidate(
    analysis.candidate,
    productInput.modelInput,
  );
  return {
    executionMode,
    productInput,
    candidate: gated.candidate,
    validationEvidence: gated.validationEvidence,
  };
}

function build(prepared, overrides = {}) {
  return buildPhase2aoActionCard({
    ...prepared,
    analyzedAt: ANALYZED_AT,
    ...overrides,
  });
}

test("the deterministic Harness projects both approved Candidates to a safe ActionCard v0.2", async (t) => {
  for (const executionMode of ["synthetic_mock", "captured_replay"]) {
    await t.test(executionMode, async () => {
      const card = build(await prepare(executionMode));

      assert.equal(validateActionCardV02(card), card);
      assert.equal(card.contractVersion, "action-card-view-model/v0.2");
      assert.equal(card.notification.id, "DEV-NOTIF-PAIR-01");
      assert.equal(card.provenance.sourceMode, executionMode);
      assert.equal(card.provenance.harnessVerified, true);
      assert.equal(card.provenance.analyzedAt, ANALYZED_AT);
      assert.equal(card.homeSection, "action_required");
      assert.equal(card.dates[0].normalized.value, "2026-08-31T17:00:00+08:00");
      assert.equal(card.dates[0].calendarEligibility.eligible, true);
      assert.equal(card.capabilities.openTrustedActionChannel.state, "allowed");
      assert.equal(card.capabilities.previewCalendar.state, "allowed");
      assert.equal(card.capabilities.writeCalendar.state, "blocked");
      assert.equal(Object.isFrozen(card), true);
      assert.equal(Object.isFrozen(card.capabilities), true);
    });
  }
});

test("native importance is derived only from trusted input facts", async () => {
  const prepared = await prepare();
  const productInput = structuredClone(prepared.productInput);
  productInput.nativeImportance.senderImportance.value = true;
  productInput.nativeImportance.providerImportance.present = false;
  const card = build(prepared, { productInput });
  const byKind = new Map(
    card.nativeImportanceSignals.map((signal) => [signal.kind, signal]),
  );

  assert.deepEqual(byKind.get("sender_importance"), {
    kind: "sender_importance",
    state: "present",
    protection: "active",
  });
  assert.deepEqual(byKind.get("provider_importance"), {
    kind: "provider_importance",
    state: "unknown",
    protection: "unknown",
  });
  assert.deepEqual(byKind.get("user_star"), {
    kind: "user_star",
    state: "absent",
    protection: "not_applicable",
  });
});

test("an untrusted source fails closed to priority reading and blocks action capabilities", async () => {
  const prepared = await prepare();
  const productInput = structuredClone(prepared.productInput);
  productInput.securityFacts.connectorAuthentication = "failed";
  const card = build(prepared, { productInput });

  assert.equal(card.homeSection, "priority_reading");
  assert.equal(card.sourceTrust.sourceStatus, "unverified");
  assert.equal(card.sourceTrust.actionChannelStatus, "unverified");
  assert.equal(card.dates[0].calendarEligibility.eligible, false);
  assert.equal(
    card.dates[0].calendarEligibility.blockedReasonCode,
    "safety_gate_not_passed",
  );
  assert.equal(card.capabilities.openTrustedActionChannel.state, "blocked");
  assert.deepEqual(
    card.capabilities.openTrustedActionChannel.reasonCodes,
    ["source_unverified"],
  );
  assert.equal(card.capabilities.previewCalendar.state, "blocked");
  assert.deepEqual(card.capabilities.previewCalendar.eligibleDateIds, []);
  assert.equal(card.capabilities.writeCalendar.state, "blocked");
  assert.equal(validateActionCardV02(card), card);
});

test("an invalid date mutation is rejected instead of guessed or normalized", async () => {
  const prepared = await prepare();
  prepared.candidate.deadlines[0].original_text =
    "5:00 pm HKT on 31 February 2026";

  assert.throws(() => build(prepared), {
    name: "Phase2aoHarnessError",
    code: "harness_projection_failed",
  });
});

test("expired trusted profile evidence fails closed and produces no Action Card", async () => {
  const prepared = await prepare();
  const productInput = structuredClone(prepared.productInput);
  const courseEvidence = productInput.trustedProfileEvidence.find(
    (item) => item.profile_field_id === "pf-dev001-course-comp7101",
  );
  courseEvidence.valid_until = "2026-08-28";

  assert.throws(() => build(prepared, { productInput }), {
    name: "Phase2aoHarnessError",
    code: "harness_projection_failed",
  });
});

test("ActionCard capability validation rejects post-Harness privilege escalation", async (t) => {
  const card = build(await prepare());

  await t.test("real calendar write", () => {
    const mutated = structuredClone(card);
    mutated.capabilities.writeCalendar = {
      state: "allowed",
      decisionSource: "harness_policy",
      reasonCodes: [],
      message: null,
    };
    assert.throws(() => validateActionCardV02(mutated), {
      code: "action_card_contract_invalid",
    });
  });

  await t.test("unverified calendar preview date", () => {
    const mutated = structuredClone(card);
    mutated.capabilities.previewCalendar.eligibleDateIds = ["unknown-date"];
    assert.throws(() => validateActionCardV02(mutated), {
      code: "action_card_contract_invalid",
    });
  });
});

test("ActionCard backend validation stays inside the frontend v0.2 wire contract", async (t) => {
  const card = build(await prepare());
  const cases = [
    {
      name: "unknown capability reason code",
      mutate(value) {
        value.capabilities.writeCalendar.reasonCodes = ["future_reason"];
      },
    },
    {
      name: "legacy-mismatched capability decision source",
      mutate(value) {
        value.capabilities.viewEvidence.decisionSource = "static_fixture";
      },
    },
    {
      name: "allowed calendar preview without an eligible date",
      mutate(value) {
        value.dates[0].calendarEligibility = {
          eligible: false,
          blockedReasonCode: "safety_gate_not_passed",
        };
        value.capabilities.previewCalendar.eligibleDateIds = [];
      },
    },
    {
      name: "cross-collection entity ID collision",
      mutate(value) {
        value.managementSuggestions[0].id = value.dates[0].id;
      },
    },
    {
      name: "released protection on a present user star",
      mutate(value) {
        const star = value.nativeImportanceSignals.find(
          (signal) => signal.kind === "user_star",
        );
        star.state = "present";
        star.protection = "released_by_user";
      },
    },
    {
      name: "frontend-invalid synthetic email accepted by the old loose regex",
      mutate(value) {
        value.notification.senderAddress = "a..b@harbour.invalid";
      },
    },
    {
      name: "calendar eligibility after source trust fails",
      mutate(value) {
        value.sourceTrust.sourceStatus = "unverified";
        value.sourceTrust.actionChannelStatus = "unverified";
        value.homeSection = "priority_reading";
        value.capabilities.openTrustedActionChannel = {
          state: "blocked",
          decisionSource: "harness_policy",
          reasonCodes: ["source_unverified"],
          message: "来源未通过安全门。",
        };
      },
    },
    {
      name: "evidence collection beyond the frontend bound",
      mutate(value) {
        while (value.evidence.length <= 64) {
          const index = value.evidence.length;
          value.evidence.push({
            id: `extra-evidence-${index}`,
            quote: `Synthetic evidence ${index}`,
            location: { kind: "body" },
          });
        }
      },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const mutated = structuredClone(card);
      scenario.mutate(mutated);
      assert.throws(() => validateActionCardV02(mutated), {
        code: "action_card_contract_invalid",
      });
    });
  }
});
