import { NextResponse, type NextRequest } from "next/server";
import {
  demoClientAttemptKey,
  demoRequestUrl,
  isSameOriginDemoRequest,
  readDemoInviteBody,
} from "../../../../features/invite-access/server/demo-access-request";
import {
  demoCookieIsSecure,
  demoSessionCookieName,
  demoSessionTtlSeconds,
  getDemoAccessStore,
} from "../../../../features/invite-access/server/demo-access-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function inviteFailureRedirect(request: Request): NextResponse {
  return NextResponse.redirect(
    demoRequestUrl(request, "/invite?reason=invalid"),
    303,
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginDemoRequest(request)) {
    return NextResponse.json(
      { error: "request_rejected" },
      { status: 403 },
    );
  }

  const body = await readDemoInviteBody(request);
  if (!body.ok) return inviteFailureRedirect(request);

  const redemption = getDemoAccessStore().redeemInvite(
    body.inviteCode,
    demoClientAttemptKey(request),
  );
  if (!redemption.ok) {
    return inviteFailureRedirect(request);
  }

  const response = NextResponse.redirect(demoRequestUrl(request, "/workspace"), 303);
  response.cookies.set({
    name: demoSessionCookieName,
    value: redemption.token,
    httpOnly: true,
    sameSite: "lax",
    secure: demoCookieIsSecure(),
    path: "/",
    maxAge: demoSessionTtlSeconds(),
    expires: new Date(redemption.expiresAt),
    priority: "high",
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
