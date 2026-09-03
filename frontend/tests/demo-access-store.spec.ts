import { describe, expect, it } from "vitest";
import {
  createDemoAccessStore,
  demoSessionCookieName,
} from "../features/invite-access/server/demo-access-store";
import {
  demoRequestUrl,
  isSameOriginDemoRequest,
  readDemoInviteBody,
} from "../features/invite-access/server/demo-access-request";

function token(seed: string): string {
  return `${seed}-${"x".repeat(40)}`;
}

describe("local demo access store", () => {
  it("redeems the configured invite into an opaque in-memory session", () => {
    const configuredCode = "test-only-high-entropy-invite";
    const store = createDemoAccessStore({
      inviteCode: configuredCode,
      createToken: () => token("session-a"),
      sessionTtlMs: 60_000,
    });

    const redemption = store.redeemInvite(configuredCode, "client-a");
    expect(redemption.ok).toBe(true);
    if (!redemption.ok) return;
    expect(redemption).not.toHaveProperty("inviteCode");
    expect(redemption.token).not.toContain(configuredCode);
    expect(store.getSession(redemption.token)).toMatchObject({
      scope: "synthetic_demo",
    });
  });

  it("keeps invalid, expired, used-up and unconfigured invites closed", () => {
    const now = 1_000;
    const expired = createDemoAccessStore({
      inviteCode: "expired-test-invite",
      inviteExpiresAt: now,
      now: () => now,
    });
    const used = createDemoAccessStore({
      inviteCode: "single-use-test-invite",
      inviteMaxUses: 1,
      createToken: () => token("single-use"),
    });
    const unconfigured = createDemoAccessStore();

    expect(expired.redeemInvite("expired-test-invite", "a")).toMatchObject({
      ok: false,
    });
    expect(used.redeemInvite("wrong", "a")).toMatchObject({ ok: false });
    expect(used.redeemInvite("single-use-test-invite", "b")).toMatchObject({
      ok: true,
    });
    expect(used.redeemInvite("single-use-test-invite", "c")).toMatchObject({
      ok: false,
    });
    expect(unconfigured.redeemInvite("anything", "a")).toMatchObject({
      ok: false,
    });
  });

  it("rate-limits repeated failures without blocking a different client", () => {
    const store = createDemoAccessStore({
      inviteCode: "rate-limit-test-invite",
      attemptLimit: 2,
    });

    expect(store.redeemInvite("wrong-one", "client-a")).toMatchObject({
      ok: false,
    });
    expect(store.redeemInvite("wrong-two", "client-a")).toMatchObject({
      ok: false,
    });
    expect(
      store.redeemInvite("rate-limit-test-invite", "client-a"),
    ).toMatchObject({ ok: false });
    expect(
      store.redeemInvite("rate-limit-test-invite", "client-b"),
    ).toMatchObject({ ok: true });
  });

  it("expires, rejects tampering and revokes sessions", () => {
    let timestamp = 10_000;
    let sequence = 0;
    const store = createDemoAccessStore({
      inviteCode: "session-lifecycle-test-invite",
      now: () => timestamp,
      sessionTtlMs: 1_000,
      createToken: () => token(`session-${sequence++}`),
    });

    const first = store.redeemInvite(
      "session-lifecycle-test-invite",
      "client-a",
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(store.getSession(`${first.token}-tampered`)).toBeNull();
    expect(store.revokeSession(first.token)).toBe(true);
    expect(store.getSession(first.token)).toBeNull();

    const second = store.redeemInvite(
      "session-lifecycle-test-invite",
      "client-b",
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    timestamp += 1_001;
    expect(store.getSession(second.token)).toBeNull();
  });

  it("uses a dedicated cookie name without calling it an account token", () => {
    expect(demoSessionCookieName).toBe("hkai_demo_session");
    expect(demoSessionCookieName).not.toMatch(/account|auth/i);
  });
});

describe("demo access request boundary", () => {
  it("accepts same-origin posts and rejects cross-origin posts", () => {
    const sameOrigin = new Request("http://127.0.0.1:3000/api/demo", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3000" },
    });
    const crossOrigin = new Request("http://127.0.0.1:3000/api/demo", {
      method: "POST",
      headers: { origin: "https://attacker.invalid" },
    });
    const canonicalizedDevelopmentUrl = new Request(
      "http://localhost:3000/api/demo",
      {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
        },
      },
    );
    const loopbackAlias = new Request("http://localhost:3000/api/demo", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3000" },
    });

    expect(isSameOriginDemoRequest(sameOrigin)).toBe(true);
    expect(isSameOriginDemoRequest(crossOrigin)).toBe(false);
    expect(isSameOriginDemoRequest(canonicalizedDevelopmentUrl)).toBe(true);
    expect(isSameOriginDemoRequest(loopbackAlias)).toBe(true);
    expect(demoRequestUrl(loopbackAlias, "/workspace").href).toBe(
      "http://127.0.0.1:3000/workspace",
    );
  });

  it("fails closed for malformed origins and explicit cross-site requests", () => {
    const malformed = new Request("http://127.0.0.1:3000/api/demo", {
      method: "POST",
      headers: { origin: "not a url" },
    });
    const crossSite = new Request("http://127.0.0.1:3000/api/demo", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
    });
    const missingMetadata = new Request(
      "http://127.0.0.1:3000/api/demo",
      { method: "POST" },
    );
    const sameOriginMetadata = new Request(
      "http://127.0.0.1:3000/api/demo",
      {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      },
    );

    expect(isSameOriginDemoRequest(malformed)).toBe(false);
    expect(isSameOriginDemoRequest(crossSite)).toBe(false);
    expect(isSameOriginDemoRequest(missingMetadata)).toBe(false);
    expect(isSameOriginDemoRequest(sameOriginMetadata)).toBe(true);
  });

  it("reads one urlencoded invite and enforces the actual body byte limit", async () => {
    const valid = new Request("http://127.0.0.1:3000/api/demo", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ inviteCode: "synthetic-code" }),
    });
    const oversized = new Request("http://127.0.0.1:3000/api/demo", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `inviteCode=${"x".repeat(4_097)}`,
    });
    const duplicate = new Request("http://127.0.0.1:3000/api/demo", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "inviteCode=one&inviteCode=two",
    });

    await expect(readDemoInviteBody(valid)).resolves.toEqual({
      ok: true,
      inviteCode: "synthetic-code",
    });
    await expect(readDemoInviteBody(oversized)).resolves.toEqual({ ok: false });
    await expect(readDemoInviteBody(duplicate)).resolves.toEqual({ ok: false });
  });
});
