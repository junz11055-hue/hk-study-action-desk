import { describe, expect, it } from "vitest";
import { AppError } from "../lib/errors/app-error";
import { MockActionCardRepository } from "../features/action-center/data/mock-action-card-repository";

describe("MockActionCardRepository", () => {
  it("returns a recursively frozen parsed card", async () => {
    const repository = new MockActionCardRepository();
    const card = await repository.getById("synthetic-notification-001");

    expect(card.contractVersion).toBe("action-card-view-model/v0.1");
    expect(Object.isFrozen(card)).toBe(true);
    expect(Object.isFrozen(card.notification)).toBe(true);
    expect(Object.isFrozen(card.claims)).toBe(true);
    expect(Object.isFrozen(card.claims[0])).toBe(true);
  });

  it("returns four frozen contract-valid cards across all three home sections", async () => {
    const repository = new MockActionCardRepository();
    const cards = await repository.list();

    expect(cards).toHaveLength(4);
    expect(new Set(cards.map((card) => card.homeSection))).toEqual(
      new Set(["action_required", "priority_reading", "other"]),
    );
    expect(cards.every((card) => Object.isFrozen(card))).toBe(true);
    expect(cards.every((card) => card.synthetic)).toBe(true);
    expect(
      cards.every((card) => card.notification.senderAddress.endsWith(".invalid")),
    ).toBe(true);
    expect(
      cards.every((card) => card.capabilities.writeCalendar.state !== "allowed"),
    ).toBe(true);
  });

  it("fails closed when a fixture violates the contract", () => {
    expect(
      () =>
        new MockActionCardRepository([
          {
            contractVersion: "candidate-v2-is-not-a-view-model",
          },
        ]),
    ).toThrowError(AppError);
  });

  it("returns a safe not-found error", async () => {
    const repository = new MockActionCardRepository();

    await expect(repository.getById("missing-notification")).rejects.toMatchObject({
      code: "ACTION_CARD_NOT_FOUND",
      safeMessage: "没有找到这条合成通知。",
      retryable: false,
    });
  });
});
