import { createHash } from "node:crypto";

const maximumFormBytes = 4_096;

export type DemoInviteBody =
  | Readonly<{ ok: true; inviteCode: string }>
  | Readonly<{ ok: false }>;

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

function originsMatch(left: string, right: string): boolean {
  const leftUrl = new URL(left);
  const rightUrl = new URL(right);
  return (
    leftUrl.origin === rightUrl.origin ||
    (leftUrl.protocol === rightUrl.protocol &&
      leftUrl.port === rightUrl.port &&
      isLoopbackHostname(leftUrl.hostname) &&
      isLoopbackHostname(rightUrl.hostname))
  );
}

export function isSameOriginDemoRequest(request: Request): boolean {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin !== null) {
    try {
      if (request.headers.get("sec-fetch-site") === "cross-site") {
        return false;
      }

      const submittedOrigin = new URL(origin).origin;
      const host = request.headers.get("host");
      const hostOrigin =
        host === null
          ? null
          : new URL(`${requestUrl.protocol}//${host}`).origin;
      return (
        originsMatch(submittedOrigin, requestUrl.origin) ||
        (hostOrigin !== null && originsMatch(submittedOrigin, hostOrigin))
      );
    } catch {
      return false;
    }
  }

  return request.headers.get("sec-fetch-site") === "same-origin";
}

export async function readDemoInviteBody(
  request: Request,
): Promise<DemoInviteBody> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    return { ok: false };
  }

  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumFormBytes)
  ) {
    return { ok: false };
  }

  if (request.body === null) {
    return { ok: false };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumFormBytes) {
        await reader.cancel();
        return { ok: false };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false };
  }

  const payload = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let fields: URLSearchParams;
  try {
    fields = new URLSearchParams(
      new TextDecoder("utf-8", { fatal: true }).decode(payload),
    );
  } catch {
    return { ok: false };
  }

  const inviteCodes = fields.getAll("inviteCode");
  return inviteCodes.length === 1 && inviteCodes[0] !== undefined
    ? { ok: true, inviteCode: inviteCodes[0] }
    : { ok: false };
}

export function demoRequestUrl(request: Request, path: string): URL {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin !== null) {
    try {
      return new URL(path, new URL(origin).origin);
    } catch {
      // The same-origin guard rejects malformed origins before this helper runs.
    }
  }

  const host = request.headers.get("host");
  if (host !== null) {
    try {
      return new URL(path, `${requestUrl.protocol}//${host}`);
    } catch {
      // Fall through to the normalized request URL.
    }
  }

  return new URL(path, requestUrl);
}

export function demoClientAttemptKey(request: Request): string {
  const forwardedFor = request.headers
    .get("x-forwarded-for")
    ?.split(",", 1)[0]
    ?.trim();
  const userAgent = request.headers.get("user-agent")?.slice(0, 256);
  return createHash("sha256")
    .update(`${forwardedFor ?? "local"}|${userAgent ?? "unknown"}`, "utf8")
    .digest("hex");
}
