import { createHash } from "node:crypto";
import {
  demoSessionCookieName,
  getDemoAccessStore,
  type DemoAccessStore,
} from "./demo-access-store";

export { demoSessionCookieName };

const sessionScopeDomain = "phase2ao-session-scope/v1\0";

export function validatedDemoSessionScopeDigest(
  token: string | undefined,
  store: DemoAccessStore = getDemoAccessStore(),
): string | null {
  if (
    token === undefined ||
    store.getSession(token) === null
  ) {
    return null;
  }

  const digest = createHash("sha256")
    .update(sessionScopeDomain, "utf8")
    .update(token, "utf8")
    .digest("hex");
  return `sha256:${digest}`;
}
