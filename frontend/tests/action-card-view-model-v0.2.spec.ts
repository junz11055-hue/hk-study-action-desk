import { describe, expect, it } from "vitest";
import { syntheticActionCardFixture } from "../features/action-center/data/synthetic-action-card.fixture";
import { actionCardViewModelSchema } from "../features/action-center/model/action-card-view-model";
import { actionCardViewModelV02Schema } from "../features/action-center/model/action-card-view-model-v0.2";
import { mutableClone, phase2aoCard } from "./phase2ao-test-fixtures";

describe("ActionCardViewModel v0.2", () => {
  it("adds truthful Harness provenance without changing the frozen v0.1 card", () => {
    const original = actionCardViewModelSchema.parse(syntheticActionCardFixture);
    const dynamic = phase2aoCard("synthetic_mock");

    expect(original.contractVersion).toBe("action-card-view-model/v0.1");
    expect(original.provenance.harnessVerified).toBe(false);
    expect(dynamic.contractVersion).toBe("action-card-view-model/v0.2");
    expect(dynamic.capabilityBinding.viewModelVersion).toBe(
      "action-card-view-model/v0.2",
    );
    expect(dynamic.provenance).toMatchObject({
      sourceMode: "synthetic_mock",
      harnessVerified: true,
    });
  });

  it.each(["synthetic_mock", "captured_replay", "live_model"] as const)(
    "accepts the dynamic %s provenance only with Harness time",
    (sourceMode) => {
      const card = mutableClone(phase2aoCard(sourceMode));
      card.provenance.harnessVerified = false;
      card.provenance.analyzedAt = null;

      expect(actionCardViewModelV02Schema.safeParse(card).success).toBe(false);
    },
  );

  it("accepts an honest static v0.2 fixture but rejects a v0.1 binding", () => {
    const card = mutableClone(phase2aoCard());
    card.provenance = {
      sourceMode: "static_fixture",
      harnessVerified: false,
      analyzedAt: null,
      disclosure: "静态 v0.2 工程夹具。",
    };
    expect(actionCardViewModelV02Schema.safeParse(card).success).toBe(true);

    const badBinding = card as unknown as {
      capabilityBinding: { viewModelVersion: string };
    };
    badBinding.capabilityBinding.viewModelVersion =
      "action-card-view-model/v0.1";
    expect(actionCardViewModelV02Schema.safeParse(badBinding).success).toBe(false);
  });

  it("fails closed on unknown root, provenance and binding fields", () => {
    for (const mutate of [
      (card: Record<string, unknown>) => {
        card.candidate = { hidden: true };
      },
      (card: Record<string, unknown>) => {
        (card.provenance as Record<string, unknown>).providerRaw = "hidden";
      },
      (card: Record<string, unknown>) => {
        (card.capabilityBinding as Record<string, unknown>).hash = "drift";
      },
    ]) {
      const card = structuredClone(phase2aoCard()) as unknown as Record<
        string,
        unknown
      >;
      mutate(card);
      expect(actionCardViewModelV02Schema.safeParse(card).success).toBe(false);
    }
  });
});
