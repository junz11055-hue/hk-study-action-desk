import { afterEach, describe, expect, it } from "vitest";
import { isHostedDemoMode } from "../features/invite-access/server/demo-mode";

const originalDemoMode = process.env.DEMO_MODE;

afterEach(() => {
  if (originalDemoMode === undefined) {
    delete process.env.DEMO_MODE;
  } else {
    process.env.DEMO_MODE = originalDemoMode;
  }
});

describe("hosted demo mode", () => {
  it("is opt-in and only accepts the exact hosted value", () => {
    delete process.env.DEMO_MODE;
    expect(isHostedDemoMode()).toBe(false);

    process.env.DEMO_MODE = "HOSTED";
    expect(isHostedDemoMode()).toBe(false);

    process.env.DEMO_MODE = "hosted";
    expect(isHostedDemoMode()).toBe(true);
  });
});
