import { cookies } from "next/headers";
import {
  demoSessionCookieName,
  getDemoAccessStore,
} from "./demo-access-store";

export type DemoSessionState = "invalid" | "missing" | "valid";

export async function demoSessionState(): Promise<DemoSessionState> {
  const cookieStore = await cookies();
  const token = cookieStore.get(demoSessionCookieName)?.value;
  if (token === undefined || token.length === 0) {
    return "missing";
  }

  return getDemoAccessStore().getSession(token) === null ? "invalid" : "valid";
}
