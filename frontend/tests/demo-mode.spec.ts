import { afterEach, describe, expect, it } from "vitest";
import { isHostedDemoMode } from "../features/invite-access/server/demo-mode";

const originalDemoMode = process.env.DEMO_MODE;
const originalPublicDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE;

afterEach(() => {
  if (originalDemoMode === undefined) {
    delete process.env.DEMO_MODE;
  } else {
    process.env.DEMO_MODE = originalDemoMode;
  }
  if (originalPublicDemoMode === undefined) {
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
  } else {
    process.env.NEXT_PUBLIC_DEMO_MODE = originalPublicDemoMode;
  }
});

describe("hosted demo mode", () => {
  it("is opt-in and only accepts the exact hosted value", () => {
    delete process.env.DEMO_MODE;
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
    expect(isHostedDemoMode()).toBe(false);

    process.env.DEMO_MODE = "HOSTED";
    expect(isHostedDemoMode()).toBe(false);

    process.env.DEMO_MODE = "hosted";
    expect(isHostedDemoMode()).toBe(true);

    delete process.env.DEMO_MODE;
    process.env.NEXT_PUBLIC_DEMO_MODE = "hosted";
    expect(isHostedDemoMode()).toBe(true);
  });
});
