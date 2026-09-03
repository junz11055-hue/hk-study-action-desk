import { NextResponse, type NextRequest } from "next/server";
import {
  demoRequestUrl,
  isSameOriginDemoRequest,
} from "../../../../../features/invite-access/server/demo-access-request";
import {
  demoCookieIsSecure,
  demoSessionCookieName,
  getDemoAccessStore,
} from "../../../../../features/invite-access/server/demo-access-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginDemoRequest(request)) {
    return NextResponse.json(
      { error: "request_rejected" },
      { status: 403 },
    );
  }

  const token = request.cookies.get(demoSessionCookieName)?.value;
  if (token !== undefined) {
    getDemoAccessStore().revokeSession(token);
  }

  const response = NextResponse.redirect(
    demoRequestUrl(request, "/invite?reason=logout"),
    303,
  );
  response.cookies.set({
    name: demoSessionCookieName,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: demoCookieIsSecure(),
    path: "/",
    maxAge: 0,
    expires: new Date(0),
    priority: "high",
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
