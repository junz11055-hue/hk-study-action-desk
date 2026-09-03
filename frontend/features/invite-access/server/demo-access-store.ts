import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const demoSessionCookieName = "hkai_demo_session";

const defaultSessionTtlMs = 2 * 60 * 60_000;
const defaultAttemptWindowMs = 5 * 60_000;
const defaultAttemptLimit = 5;
const maximumInviteLength = 128;
const minimumOpaqueTokenLength = 32;
const maximumAttemptRecords = 256;

type InviteFailureReason =
  | "attempt_limited"
  | "expired"
  | "invalid"
  | "unconfigured"
  | "used_up";

type InviteRedemption =
  | Readonly<{
      ok: true;
      token: string;
      expiresAt: number;
    }>
  | Readonly<{
      ok: false;
      reason: InviteFailureReason;
    }>;

export type DemoSession = Readonly<{
  expiresAt: number;
  scope: "synthetic_demo";
}>;

type AttemptRecord = {
  count: number;
  resetAt: number;
};

type DemoAccessStoreOptions = Readonly<{
  inviteCode?: string;
  inviteExpiresAt?: number | null;
  inviteMaxUses?: number;
  sessionTtlMs?: number;
  attemptLimit?: number;
  attemptWindowMs?: number;
  now?: () => number;
  createToken?: () => string;
}>;

export type DemoAccessStore = Readonly<{
  redeemInvite: (inviteCode: string, clientKey: string) => InviteRedemption;
  getSession: (token: string) => DemoSession | null;
  revokeSession: (token: string) => boolean;
}>;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function safeDigestEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? (value as number)
    : fallback;
}

function cleanInviteCode(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim();
  return cleaned.length > 0 && cleaned.length <= maximumInviteLength
    ? cleaned
    : null;
}

export function createDemoAccessStore(
  options: DemoAccessStoreOptions = {},
): DemoAccessStore {
  const now = options.now ?? Date.now;
  const createToken =
    options.createToken ?? (() => randomBytes(32).toString("base64url"));
  const sessionTtlMs = positiveInteger(
    options.sessionTtlMs,
    defaultSessionTtlMs,
  );
  const inviteMaxUses = positiveInteger(options.inviteMaxUses, 25);
  const attemptLimit = positiveInteger(options.attemptLimit, defaultAttemptLimit);
  const attemptWindowMs = positiveInteger(
    options.attemptWindowMs,
    defaultAttemptWindowMs,
  );
  const configuredInvite = cleanInviteCode(options.inviteCode);
  const configuredInviteDigest = sha256(
    configuredInvite ?? "fixed-unconfigured-demo-invite-digest",
  );
  const sessions = new Map<string, DemoSession>();
  const attempts = new Map<string, AttemptRecord>();
  let inviteUses = 0;

  const cleanup = (timestamp: number) => {
    for (const [key, session] of sessions) {
      if (session.expiresAt <= timestamp) {
        sessions.delete(key);
      }
    }

    for (const [key, attempt] of attempts) {
      if (attempt.resetAt <= timestamp) {
        attempts.delete(key);
      }
    }
  };

  const registerFailure = (clientKey: string, timestamp: number) => {
    const current = attempts.get(clientKey);
    if (current === undefined || current.resetAt <= timestamp) {
      if (attempts.size >= maximumAttemptRecords) {
        const oldestKey = attempts.keys().next().value as string | undefined;
        if (oldestKey !== undefined) attempts.delete(oldestKey);
      }
      attempts.set(clientKey, {
        count: 1,
        resetAt: timestamp + attemptWindowMs,
      });
      return;
    }

    current.count += 1;
  };

  const redeemInvite = (
    submittedCode: string,
    clientKey: string,
  ): InviteRedemption => {
    const timestamp = now();
    cleanup(timestamp);

    const attempt = attempts.get(clientKey);
    if (
      attempt !== undefined &&
      attempt.resetAt > timestamp &&
      attempt.count >= attemptLimit
    ) {
      sha256(submittedCode);
      return { ok: false, reason: "attempt_limited" };
    }

    const cleaned = cleanInviteCode(submittedCode);
    const submittedDigest = sha256(
      cleaned ?? "fixed-invalid-demo-invite-digest",
    );
    const matches = safeDigestEqual(submittedDigest, configuredInviteDigest);

    let reason: InviteFailureReason | null = null;
    if (configuredInvite === null) {
      reason = "unconfigured";
    } else if (!matches) {
      reason = "invalid";
    } else if (
      options.inviteExpiresAt !== undefined &&
      options.inviteExpiresAt !== null &&
      options.inviteExpiresAt <= timestamp
    ) {
      reason = "expired";
    } else if (inviteUses >= inviteMaxUses) {
      reason = "used_up";
    }

    if (reason !== null) {
      registerFailure(clientKey, timestamp);
      return { ok: false, reason };
    }

    attempts.delete(clientKey);
    inviteUses += 1;
    const token = createToken();
    if (token.length < minimumOpaqueTokenLength) {
      throw new Error("Demo session token generator returned a short token.");
    }
    const expiresAt = timestamp + sessionTtlMs;
    sessions.set(sha256(token).toString("hex"), {
      expiresAt,
      scope: "synthetic_demo",
    });
    return { ok: true, token, expiresAt };
  };

  const getSession = (token: string): DemoSession | null => {
    const timestamp = now();
    cleanup(timestamp);
    if (
      typeof token !== "string" ||
      token.length < minimumOpaqueTokenLength ||
      token.length > 256
    ) {
      return null;
    }

    return sessions.get(sha256(token).toString("hex")) ?? null;
  };

  const revokeSession = (token: string): boolean => {
    if (
      typeof token !== "string" ||
      token.length < minimumOpaqueTokenLength ||
      token.length > 256
    ) {
      return false;
    }

    return sessions.delete(sha256(token).toString("hex"));
  };

  return Object.freeze({ redeemInvite, getSession, revokeSession });
}

function boundedEnvironmentInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function environmentInviteExpiry(): number | undefined {
  const configured = process.env.DEMO_INVITE_EXPIRES_AT?.trim();
  if (configured === undefined || configured.length === 0) {
    return undefined;
  }

  const timestamp = Date.parse(configured);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

const storeKey = "__aiStudyLocalDemoAccessStore";

type ProcessWithDemoStore = NodeJS.Process & {
  [storeKey]?: DemoAccessStore;
};

export function getDemoAccessStore(): DemoAccessStore {
  const target = process as ProcessWithDemoStore;
  if (target[storeKey] === undefined) {
    const inviteCode = process.env.DEMO_INVITE_CODE;
    const sessionTtlSeconds = boundedEnvironmentInteger(
      "DEMO_SESSION_TTL_SECONDS",
      7_200,
      300,
      86_400,
    );
    const inviteExpiresAt = environmentInviteExpiry();
    target[storeKey] = createDemoAccessStore({
      ...(inviteCode === undefined ? {} : { inviteCode }),
      ...(inviteExpiresAt === undefined ? {} : { inviteExpiresAt }),
      inviteMaxUses: boundedEnvironmentInteger(
        "DEMO_INVITE_MAX_USES",
        25,
        1,
        10_000,
      ),
      sessionTtlMs: sessionTtlSeconds * 1_000,
    });
  }

  return target[storeKey];
}

export function demoSessionTtlSeconds(): number {
  return boundedEnvironmentInteger(
    "DEMO_SESSION_TTL_SECONDS",
    7_200,
    300,
    86_400,
  );
}

export function demoCookieIsSecure(): boolean {
  return process.env.DEMO_COOKIE_SECURE === "true";
}
