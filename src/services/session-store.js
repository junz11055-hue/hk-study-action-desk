import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE = "study_demo_session";
const ATTEMPT_WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS_PER_WINDOW = 5;

export class InviteRejectedError extends Error {
  constructor() {
    super("Invite code is invalid or unavailable");
    this.name = "InviteRejectedError";
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest();
}

function hashKey(value) {
  return sha256(value).toString("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = sha256(left);
  const rightBuffer = Buffer.isBuffer(right) ? right : sha256(right);
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function makeToken(size = 32) {
  return randomBytes(size).toString("base64url");
}

export function parseCookies(header = "") {
  const cookies = Object.create(null);
  for (const pair of String(header).split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const key = pair.slice(0, separator).trim();
    const rawValue = pair.slice(separator + 1).trim();
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      cookies[key] = "";
    }
  }
  return cookies;
}

export function sessionCookie(token, { secure = false, maxAgeSeconds } = {}) {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (secure) attributes.push("Secure");
  if (Number.isInteger(maxAgeSeconds)) attributes.push(`Max-Age=${maxAgeSeconds}`);
  return attributes.join("; ");
}

export function clearSessionCookie({ secure = false } = {}) {
  return sessionCookie("", { secure, maxAgeSeconds: 0 });
}

export function readSessionToken(request) {
  return parseCookies(request.headers.cookie)[SESSION_COOKIE] ?? "";
}

export function createSessionStore({
  inviteCodes = [],
  inviteMaxUses = 25,
  sessionTtlMs = 4 * 60 * 60_000,
  now = () => Date.now(),
} = {}) {
  const inviteRecords = (inviteCodes ?? []).map((code) => ({
    digest: sha256(String(code)),
    uses: 0,
  }));
  const sessions = new Map();
  const attempts = new Map();
  const dummyInviteDigest = sha256("fixed-dummy-invite-value");

  function cleanup(timestamp = now()) {
    for (const [key, session] of sessions) {
      if (session.expiresAt <= timestamp) sessions.delete(key);
    }
    for (const [key, record] of attempts) {
      if (record.windowStartedAt + ATTEMPT_WINDOW_MS <= timestamp) attempts.delete(key);
    }
  }

  function recordFailedAttempt(clientKey, timestamp) {
    const key = String(clientKey || "unknown").slice(0, 200);
    const current = attempts.get(key);
    if (!current || current.windowStartedAt + ATTEMPT_WINDOW_MS <= timestamp) {
      attempts.set(key, { count: 1, windowStartedAt: timestamp });
    } else {
      current.count += 1;
    }
  }

  function isRateLimited(clientKey, timestamp) {
    const record = attempts.get(String(clientKey || "unknown").slice(0, 200));
    return Boolean(
      record &&
        record.windowStartedAt + ATTEMPT_WINDOW_MS > timestamp &&
        record.count >= MAX_ATTEMPTS_PER_WINDOW,
    );
  }

  function redeemInvite(code, clientKey = "unknown") {
    const timestamp = now();
    cleanup(timestamp);
    if (isRateLimited(clientKey, timestamp)) throw new InviteRejectedError();

    const submitted = typeof code === "string" && code.length <= 160 ? code : "";
    let match = null;
    for (const record of inviteRecords) {
      if (safeEqual(submitted, record.digest)) match = record;
    }
    if (inviteRecords.length === 0) safeEqual(submitted, dummyInviteDigest);

    if (!match || match.uses >= inviteMaxUses) {
      recordFailedAttempt(clientKey, timestamp);
      throw new InviteRejectedError();
    }

    match.uses += 1;
    attempts.delete(String(clientKey || "unknown").slice(0, 200));
    const token = makeToken();
    const csrfToken = makeToken(24);
    const session = {
      id: makeToken(18),
      csrfToken,
      createdAt: timestamp,
      expiresAt: timestamp + sessionTtlMs,
      analyses: new Map(),
      inFlightAnalyses: new Map(),
      followUps: new Map(),
      inFlightFollowUps: new Map(),
      modelRequestCount: 0,
    };
    sessions.set(hashKey(token), session);
    return { token, session };
  }

  function getSession(token) {
    if (typeof token !== "string" || token.length < 32 || token.length > 200) return null;
    const key = hashKey(token);
    const session = sessions.get(key);
    if (!session) return null;
    if (session.expiresAt <= now()) {
      sessions.delete(key);
      return null;
    }
    return session;
  }

  function revoke(token) {
    if (typeof token !== "string" || token.length === 0) return false;
    return sessions.delete(hashKey(token));
  }

  return Object.freeze({ redeemInvite, getSession, revoke, cleanup });
}
