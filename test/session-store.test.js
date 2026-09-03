import test from "node:test";
import assert from "node:assert/strict";

import {
  InviteRejectedError,
  clearSessionCookie,
  createSessionStore,
  parseCookies,
  sessionCookie,
} from "../src/services/session-store.js";

function makeStore(overrides = {}) {
  return createSessionStore({
    inviteCodes: ["session-test-invite"],
    inviteMaxUses: 2,
    sessionTtlMs: 60_000,
    ...overrides,
  });
}

test("redeeming an invite creates distinct opaque sessions and enforces its use limit", () => {
  const store = makeStore();
  const first = store.redeemInvite("session-test-invite", "client-a");
  const second = store.redeemInvite("session-test-invite", "client-b");

  assert.notEqual(first.token, second.token);
  assert.ok(first.token.length >= 40);
  assert.ok(first.session.csrfToken.length >= 24);
  assert.strictEqual(store.getSession(first.token), first.session);
  assert.strictEqual(store.getSession(second.token), second.session);
  assert.throws(
    () => store.redeemInvite("session-test-invite", "client-c"),
    InviteRejectedError,
  );
});

test("sessions expire according to the injected clock and can be explicitly revoked", () => {
  let timestamp = 1_700_000_000_000;
  const store = makeStore({ now: () => timestamp, sessionTtlMs: 1_000 });
  const first = store.redeemInvite("session-test-invite", "client-a");
  assert.ok(store.getSession(first.token));

  timestamp += 1_001;
  assert.equal(store.getSession(first.token), null);

  const second = store.redeemInvite("session-test-invite", "client-b");
  assert.equal(store.revoke(second.token), true);
  assert.equal(store.getSession(second.token), null);
  assert.equal(store.revoke(second.token), false);
});

test("five failed invite attempts rate-limit the client without revealing code state", () => {
  const store = makeStore();
  for (let index = 0; index < 5; index += 1) {
    assert.throws(() => store.redeemInvite(`wrong-${index}`, "same-client"), InviteRejectedError);
  }
  assert.throws(
    () => store.redeemInvite("session-test-invite", "same-client"),
    InviteRejectedError,
  );

  assert.doesNotThrow(() => store.redeemInvite("session-test-invite", "different-client"));
});

test("session Cookie helpers apply browser security attributes", () => {
  const local = sessionCookie("opaque token", { maxAgeSeconds: 3_600 });
  assert.match(local, /^study_demo_session=opaque%20token;/);
  assert.match(local, /Path=\//);
  assert.match(local, /HttpOnly/);
  assert.match(local, /SameSite=Strict/);
  assert.match(local, /Max-Age=3600/);
  assert.doesNotMatch(local, /Secure/);

  const secure = sessionCookie("opaque-token", { secure: true });
  assert.match(secure, /Secure/);

  const cleared = clearSessionCookie({ secure: true });
  assert.match(cleared, /Max-Age=0/);
  assert.match(cleared, /Secure/);
});

test("Cookie parsing fails closed for malformed encodings", () => {
  const parsed = parseCookies("first=one; study_demo_session=abc%20123; malformed=%E0%A4%A");
  assert.equal(parsed.first, "one");
  assert.equal(parsed.study_demo_session, "abc 123");
  assert.equal(parsed.malformed, "");
  assert.equal(Object.getPrototypeOf(parsed), null);
});
