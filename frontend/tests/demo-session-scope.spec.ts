import { describe, expect, it } from "vitest";
import { createDemoAccessStore } from "../features/invite-access/server/demo-access-store";
import { validatedDemoSessionScopeDigest } from "../features/invite-access/server/demo-session-scope";

describe("Phase 2A-O demo session scope", () => {
  it("derives a stable domain-separated digest without exposing the cookie", () => {
    const token = "fixed-session-token-that-is-longer-than-thirty-two-bytes";
    const store = createDemoAccessStore({
      inviteCode: "PHASE2AO-TEST",
      createToken: () => token,
      now: () => Date.parse("2026-09-01T09:00:00+08:00"),
    });
    const redemption = store.redeemInvite("PHASE2AO-TEST", "client");
    if (!redemption.ok) throw new Error("test invite must redeem");

    const first = validatedDemoSessionScopeDigest(redemption.token, store);
    const second = validatedDemoSessionScopeDigest(redemption.token, store);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect(first).not.toContain(token);
  });

  it("returns null for missing or unknown sessions", () => {
    const store = createDemoAccessStore({ inviteCode: "PHASE2AO-TEST" });
    expect(validatedDemoSessionScopeDigest(undefined, store)).toBeNull();
    expect(
      validatedDemoSessionScopeDigest("x".repeat(48), store),
    ).toBeNull();
  });
});
