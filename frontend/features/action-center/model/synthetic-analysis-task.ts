import { z } from "zod";
import { actionCardViewModelV02Schema } from "./action-card-view-model-v0.2";

const uuidV4Schema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
const errorCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{0,63}$/);
const safeMessageSchema = z.string().trim().min(1).max(300);
const timestampSchema = z.string().datetime({ offset: true });

export const syntheticAnalysisRequestSchema = z
  .object({
    contractVersion: z.literal("synthetic-analysis-request/v1"),
    caseId: z.literal("DEV001"),
  })
  .strict();

export const syntheticAnalysisExecutionModeSchema = z.enum([
  "synthetic_mock",
  "captured_replay",
  "live_model",
]);

export const syntheticAnalysisServerStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "stale",
]);

export const syntheticAnalysisErrorSchema = z
  .object({
    code: errorCodeSchema,
    message: safeMessageSchema,
    retryable: z.boolean(),
  })
  .strict();

const successfulActionCardResourceV02Schema = z
  .object({
    status: z.literal("succeeded"),
    card: actionCardViewModelV02Schema,
    error: z.null(),
  })
  .strict();

export const syntheticAnalysisTaskSchema = z
  .object({
    contractVersion: z.literal("synthetic-analysis-task/v1"),
    taskId: uuidV4Schema,
    caseId: z.literal("DEV001"),
    executionMode: syntheticAnalysisExecutionModeSchema,
    status: syntheticAnalysisServerStatusSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    finishedAt: timestampSchema.nullable(),
    cached: z.boolean(),
    pollAfterMs: z.number().int().min(50).max(60_000).nullable(),
    resource: successfulActionCardResourceV02Schema.nullable(),
    error: syntheticAnalysisErrorSchema.nullable(),
  })
  .strict()
  .superRefine((task, context) => {
    const active = task.status === "queued" || task.status === "running";
    const succeeded = task.status === "succeeded";
    const failed = task.status === "failed" || task.status === "stale";

    if (active && task.pollAfterMs === null) {
      context.addIssue({
        code: "custom",
        path: ["pollAfterMs"],
        message: "在途任务必须给出下一次查询间隔。",
      });
    }
    if (!active && task.pollAfterMs !== null) {
      context.addIssue({
        code: "custom",
        path: ["pollAfterMs"],
        message: "终态任务不能继续要求轮询。",
      });
    }
    if (active && task.finishedAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "在途任务不能带完成时间。",
      });
    }
    if (!active && task.finishedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "终态任务必须带完成时间。",
      });
    }
    if (succeeded && (task.resource === null || task.error !== null)) {
      context.addIssue({
        code: "custom",
        path: ["resource"],
        message: "成功任务必须且只能携带行动卡资源。",
      });
    }
    if (failed && (task.resource !== null || task.error === null)) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "失败或失效任务必须且只能携带安全错误。",
      });
    }
    if (active && (task.resource !== null || task.error !== null)) {
      context.addIssue({
        code: "custom",
        path: ["resource"],
        message: "在途任务不能提前携带结果或错误。",
      });
    }

    const createdAt = Date.parse(task.createdAt);
    const updatedAt = Date.parse(task.updatedAt);
    const finishedAt =
      task.finishedAt === null ? null : Date.parse(task.finishedAt);
    if (updatedAt < createdAt) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "任务更新时间不能早于创建时间。",
      });
    }
    if (finishedAt !== null && finishedAt < updatedAt) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "任务完成时间不能早于最后更新时间。",
      });
    }
    if (finishedAt !== null && task.finishedAt !== task.updatedAt) {
      context.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "终态任务的完成时间必须等于最后更新时间。",
      });
    }

    if (
      task.resource !== null &&
      task.resource.card.provenance.sourceMode !== task.executionMode
    ) {
      context.addIssue({
        code: "custom",
        path: ["resource", "card", "provenance", "sourceMode"],
        message: "行动卡来源必须与任务执行模式一致。",
      });
    }
    if (
      task.resource !== null &&
      task.resource.card.notification.id !== "DEV-NOTIF-PAIR-01"
    ) {
      context.addIssue({
        code: "custom",
        path: ["resource", "card", "notification", "id"],
        message: "DEV001 必须使用冻结的全新合成通知 ID。",
      });
    }
  });

export const syntheticAnalysisApiErrorEnvelopeSchema = z
  .object({
    contractVersion: z.literal("synthetic-analysis-error/v1"),
    error: syntheticAnalysisErrorSchema,
  })
  .strict();

export const idempotencyKeySchema = uuidV4Schema;
export const syntheticAnalysisTaskIdSchema = uuidV4Schema;

export type SyntheticAnalysisRequest = z.infer<
  typeof syntheticAnalysisRequestSchema
>;
export type SyntheticAnalysisTask = z.infer<
  typeof syntheticAnalysisTaskSchema
>;
export type SyntheticAnalysisApiErrorEnvelope = z.infer<
  typeof syntheticAnalysisApiErrorEnvelopeSchema
>;
export type SyntheticAnalysisExecutionMode = z.infer<
  typeof syntheticAnalysisExecutionModeSchema
>;
export type SyntheticAnalysisServerStatus = z.infer<
  typeof syntheticAnalysisServerStatusSchema
>;
