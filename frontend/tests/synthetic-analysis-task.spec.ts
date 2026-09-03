import { describe, expect, it } from "vitest";
import { syntheticAnalysisTaskSchema } from "../features/action-center/model/synthetic-analysis-task";
import { mutableClone, phase2aoTask } from "./phase2ao-test-fixtures";

describe("SyntheticAnalysisTask DTO", () => {
  it.each(["queued", "running", "succeeded", "failed", "stale"] as const)(
    "accepts the strict %s state",
    (status) => {
      expect(syntheticAnalysisTaskSchema.parse(phase2aoTask(status)).status).toBe(
        status,
      );
    },
  );

  it("requires task execution mode to match ActionCard provenance", () => {
    const task = mutableClone(
      phase2aoTask("succeeded", "synthetic_mock"),
    );
    task.executionMode = "captured_replay";
    expect(syntheticAnalysisTaskSchema.safeParse(task).success).toBe(false);
  });

  it("requires the frozen DEV001 notification identity", () => {
    const task = mutableClone(phase2aoTask());
    if (task.resource === null) throw new Error("fixture must succeed");
    task.resource.card.notification.id = "synthetic-notification-001";
    expect(syntheticAnalysisTaskSchema.safeParse(task).success).toBe(false);
  });

  it("keeps Phase 2A-O success complete and rejects an unversioned partial state", () => {
    const task = structuredClone(phase2aoTask()) as unknown as Record<
      string,
      unknown
    >;
    const resource = task.resource as Record<string, unknown>;
    resource.status = "partially_succeeded";

    expect(syntheticAnalysisTaskSchema.safeParse(task).success).toBe(false);
  });

  it("rejects early resources, stale cards, invalid time order and extra fields", () => {
    const queued = structuredClone(phase2aoTask("queued")) as unknown as Record<
      string,
      unknown
    >;
    queued.resource = phase2aoTask().resource;
    expect(syntheticAnalysisTaskSchema.safeParse(queued).success).toBe(false);

    const failed = structuredClone(phase2aoTask("failed")) as unknown as Record<
      string,
      unknown
    >;
    failed.resource = phase2aoTask().resource;
    expect(syntheticAnalysisTaskSchema.safeParse(failed).success).toBe(false);

    const badTime = structuredClone(phase2aoTask()) as unknown as Record<
      string,
      unknown
    >;
    badTime.finishedAt = "2026-09-01T09:00:03+08:00";
    expect(syntheticAnalysisTaskSchema.safeParse(badTime).success).toBe(false);

    const extra = structuredClone(phase2aoTask()) as unknown as Record<
      string,
      unknown
    >;
    extra.candidate = { hidden: true };
    expect(syntheticAnalysisTaskSchema.safeParse(extra).success).toBe(false);
  });
});
