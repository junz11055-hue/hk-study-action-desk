import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPendingSyntheticAnalysisSubmit,
  PENDING_SYNTHETIC_ANALYSIS_SUBMIT_KEY_V1,
  readPendingSyntheticAnalysisSubmit,
  rememberPendingSyntheticAnalysisSubmit,
} from "../features/action-center/data/pending-synthetic-analysis-submit";

const validKey = "55555555-5555-4555-8555-555555555555";

describe("pending synthetic analysis submit storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("stores only the versioned pending Idempotency-Key in sessionStorage", () => {
    expect(rememberPendingSyntheticAnalysisSubmit(validKey)).toBe(true);

    expect(window.sessionStorage).toHaveLength(1);
    expect(window.sessionStorage.getItem(
      PENDING_SYNTHETIC_ANALYSIS_SUBMIT_KEY_V1,
    )).toBe(validKey);
    expect(window.localStorage).toHaveLength(0);
    expect(readPendingSyntheticAnalysisSubmit()).toBe(validKey);

    clearPendingSyntheticAnalysisSubmit();
    expect(window.sessionStorage).toHaveLength(0);
  });

  it("rejects and removes malformed pending identities", () => {
    window.sessionStorage.setItem(
      PENDING_SYNTHETIC_ANALYSIS_SUBMIT_KEY_V1,
      JSON.stringify({ taskId: validKey, body: "forbidden" }),
    );

    expect(readPendingSyntheticAnalysisSubmit()).toBeNull();
    expect(window.sessionStorage).toHaveLength(0);
  });
});
