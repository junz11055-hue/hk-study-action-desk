import { syntheticActionCardFixture } from "../features/action-center/data/synthetic-action-card.fixture";
import {
  actionCardViewModelV02Schema,
  type ActionCardViewModelV02,
} from "../features/action-center/model/action-card-view-model-v0.2";
import {
  syntheticAnalysisTaskSchema,
  type SyntheticAnalysisExecutionMode,
  type SyntheticAnalysisServerStatus,
  type SyntheticAnalysisTask,
} from "../features/action-center/model/synthetic-analysis-task";

export const phase2aoTaskId = "11111111-1111-4111-8111-111111111111";

export type MutableDeep<T> = T extends readonly (infer Item)[]
  ? MutableDeep<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: MutableDeep<T[Key]> }
    : T;

export function mutableClone<T>(value: T): MutableDeep<T> {
  return structuredClone(value) as MutableDeep<T>;
}

export function phase2aoCard(
  sourceMode: SyntheticAnalysisExecutionMode = "synthetic_mock",
): ActionCardViewModelV02 {
  const card = structuredClone(syntheticActionCardFixture) as unknown as Record<
    string,
    unknown
  >;
  card.contractVersion = "action-card-view-model/v0.2";
  card.notification = {
    ...(card.notification as Record<string, unknown>),
    id: "DEV-NOTIF-PAIR-01",
  };
  card.provenance = {
    sourceMode,
    harnessVerified: true,
    analyzedAt: "2026-09-01T09:00:01+08:00",
    disclosure: "完全合成的 Phase 2A-O 技术验收结果。",
  };
  card.capabilityBinding = {
    ...(card.capabilityBinding as Record<string, unknown>),
    viewModelVersion: "action-card-view-model/v0.2",
    harnessPolicyVersion: "product-harness-policy-v1",
  };
  return actionCardViewModelV02Schema.parse(card);
}

export function phase2aoTask(
  status: SyntheticAnalysisServerStatus = "succeeded",
  mode: SyntheticAnalysisExecutionMode = "synthetic_mock",
): SyntheticAnalysisTask {
  const active = status === "queued" || status === "running";
  const succeeded = status === "succeeded";
  const timestamp = active
    ? "2026-09-01T09:00:00+08:00"
    : "2026-09-01T09:00:02+08:00";
  return syntheticAnalysisTaskSchema.parse({
    contractVersion: "synthetic-analysis-task/v1",
    taskId: phase2aoTaskId,
    caseId: "DEV001",
    executionMode: mode,
    status,
    createdAt: "2026-09-01T09:00:00+08:00",
    updatedAt: timestamp,
    finishedAt: active ? null : timestamp,
    cached: false,
    pollAfterMs: active ? 250 : null,
    resource: succeeded
      ? { status: "succeeded", card: phase2aoCard(mode), error: null }
      : null,
    error:
      status === "failed" || status === "stale"
        ? {
            code: status === "stale" ? "TASK_STALE" : "ANALYSIS_FAILED",
            message:
              status === "stale"
                ? "任务已失去执行租约。"
                : "结果未通过技术校验。",
            retryable: false,
          }
        : null,
  });
}
