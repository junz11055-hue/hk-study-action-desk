import test from "node:test";
import assert from "node:assert/strict";

import {
  TEST_INVITE_CODE,
  TEST_PUBLIC_ORIGIN,
  authenticatedClient,
  bootstrap,
  cookieFrom,
  createTestConfig,
  login,
  request,
  responseJson,
  startTestApp,
} from "./http-helpers.js";

test("invite login creates an opaque HttpOnly SameSite session and ignores fixation cookies", async (t) => {
  const { baseUrl } = await startTestApp(t);
  const auth = await login(baseUrl, TEST_INVITE_CODE, {
    cookie: "study_demo_session=attacker-controlled",
  });

  assert.ok([200, 201].includes(auth.response.status));
  assert.match(auth.raw, /HttpOnly/i);
  assert.match(auth.raw, /SameSite=Strict/i);
  assert.match(auth.raw, /Path=\//i);
  assert.doesNotMatch(auth.cookie, /attacker-controlled/);
  assert.doesNotMatch(JSON.stringify(auth.payload), /study_demo_session|TEST-ONLY-SYNTHETIC-INVITE/);

  const boot = await bootstrap(baseUrl, auth.cookie);
  assert.equal(boot.response.status, 200);
  assert.equal(typeof boot.payload.csrfToken, "string");
  assert.ok(boot.payload.csrfToken.length >= 24);
});

test("invalid and exhausted invites use the same external error", async (t) => {
  const config = createTestConfig({ inviteMaxUses: 1 });
  const { baseUrl } = await startTestApp(t, { config });

  const accepted = await login(baseUrl);
  assert.ok([200, 201].includes(accepted.response.status));

  const exhausted = await login(baseUrl);
  const invalid = await login(baseUrl, "definitely-not-a-real-code");
  assert.equal(exhausted.response.status, 401);
  assert.equal(invalid.response.status, 401);
  assert.deepEqual(exhausted.payload, invalid.payload);
  assert.equal(cookieFrom(exhausted.response).cookie, "");
  assert.equal(cookieFrom(invalid.response).cookie, "");
});

test("protected API rejects absent and tampered sessions", async (t) => {
  const { baseUrl } = await startTestApp(t);

  for (const cookie of [undefined, "study_demo_session=tampered-session-token-that-is-long-enough-0000"]) {
    const response = await request(baseUrl, "/api/bootstrap", { cookie });
    assert.equal(response.status, 401);
    const payload = await responseJson(response);
    assert.ok(payload.error);
  }
});

test("state-changing APIs require a CSRF token bound to the current session", async (t) => {
  const clientA = await authenticatedClient(t);
  const authB = await login(clientA.baseUrl);
  assert.ok([200, 201].includes(authB.response.status));
  const bootB = await bootstrap(clientA.baseUrl, authB.cookie);
  assert.equal(bootB.response.status, 200);

  const attempts = [
    {},
    { csrfToken: "wrong-csrf-token" },
    { csrfToken: bootB.payload.csrfToken },
  ];
  for (const extra of attempts) {
    const response = await request(clientA.baseUrl, "/api/messages/deposit-deadline/analyze", {
      method: "POST",
      json: {},
      origin: TEST_PUBLIC_ORIGIN,
      cookie: clientA.cookie,
      ...extra,
    });
    assert.equal(response.status, 403);
  }

  const accepted = await request(clientA.baseUrl, "/api/messages/deposit-deadline/analyze", {
    method: "POST",
    json: {},
    origin: TEST_PUBLIC_ORIGIN,
    cookie: clientA.cookie,
    csrfToken: clientA.csrfToken,
  });
  assert.equal(accepted.status, 200);
});

test("cross-origin state changes are rejected and CORS is not opened", async (t) => {
  const client = await authenticatedClient(t);
  const response = await request(client.baseUrl, "/api/messages/deposit-deadline/analyze", {
    method: "POST",
    json: {},
    origin: "https://evil.invalid",
    cookie: client.cookie,
    csrfToken: client.csrfToken,
  });

  assert.equal(response.status, 403);
  assert.notEqual(response.headers.get("access-control-allow-origin"), "*");
});

test("state changes without an Origin header fail closed", async (t) => {
  const client = await authenticatedClient(t);
  const response = await request(client.baseUrl, "/api/messages/deposit-deadline/analyze", {
    method: "POST",
    json: {},
    cookie: client.cookie,
    csrfToken: client.csrfToken,
  });
  assert.equal(response.status, 403);
});

test("logout revokes the server-side session and clears its Cookie", async (t) => {
  const client = await authenticatedClient(t);
  const response = await request(client.baseUrl, "/api/auth/logout", {
    method: "POST",
    json: {},
    origin: TEST_PUBLIC_ORIGIN,
    cookie: client.cookie,
    csrfToken: client.csrfToken,
  });

  assert.ok([200, 204].includes(response.status));
  const cleared = cookieFrom(response).raw;
  assert.match(cleared, /Max-Age=0/i);

  const after = await request(client.baseUrl, "/api/bootstrap", { cookie: client.cookie });
  assert.equal(after.status, 401);
});

test("an expired session is rejected using the injected clock", async (t) => {
  let timestamp = 1_800_000_000_000;
  const config = createTestConfig({ sessionTtlMs: 1_000 });
  const { baseUrl } = await startTestApp(t, { config, clock: () => timestamp });
  const auth = await login(baseUrl);
  assert.ok([200, 201].includes(auth.response.status));

  timestamp += 1_001;
  const response = await request(baseUrl, "/api/bootstrap", { cookie: auth.cookie });
  assert.equal(response.status, 401);
});

test("HTTPS configuration marks the session Cookie Secure", async (t) => {
  const config = createTestConfig({ publicOrigin: "https://demo.test.local" });
  const { baseUrl } = await startTestApp(t, { config });
  const auth = await login(baseUrl, TEST_INVITE_CODE, { origin: config.publicOrigin });
  assert.ok([200, 201].includes(auth.response.status));
  assert.match(auth.raw, /Secure/i);
});
