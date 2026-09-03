import { z } from "zod";
import type { ReadonlyDeep } from "../../../lib/types/readonly-deep";
import {
  actionCardViewModelSchema,
  type ActionCardViewModel,
} from "./action-card-view-model";

export const actionCardV02SourceModeSchema = z.enum([
  "static_fixture",
  "synthetic_mock",
  "captured_replay",
  "live_model",
]);

const actionCardV02ProvenanceSchema = z
  .object({
    sourceMode: actionCardV02SourceModeSchema,
    harnessVerified: z.boolean(),
    analyzedAt: z.string().datetime({ offset: true }).nullable(),
    disclosure: z.string().trim().min(1).max(500),
  })
  .strict()
  .superRefine((provenance, context) => {
    const isStaticFixture = provenance.sourceMode === "static_fixture";

    if (
      isStaticFixture &&
      (provenance.harnessVerified || provenance.analyzedAt !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "静态工程夹具不能冒充 Harness 分析结果。",
      });
    }

    if (
      !isStaticFixture &&
      (!provenance.harnessVerified || provenance.analyzedAt === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "任务生成的行动卡必须带 Harness 技术校验和分析时间。",
      });
    }
  });

export type ActionCardV02Provenance = z.infer<
  typeof actionCardV02ProvenanceSchema
>;

export type ActionCardViewModelV02 = Omit<
  ActionCardViewModel,
  "capabilityBinding" | "contractVersion" | "provenance"
> &
  Readonly<{
    contractVersion: "action-card-view-model/v0.2";
    provenance: ActionCardV02Provenance;
    capabilityBinding: Readonly<{
      viewModelVersion: "action-card-view-model/v0.2";
      harnessPolicyVersion: string;
      itemVersion: string;
    }>;
  }>;

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/);
const actionCardV02CapabilityBindingSchema = z
  .object({
    viewModelVersion: z.literal("action-card-view-model/v0.2"),
    harnessPolicyVersion: identifierSchema,
    itemVersion: identifierSchema,
  })
  .strict();

function addIssues(
  context: z.RefinementCtx,
  issues: readonly Readonly<{
    path: readonly PropertyKey[];
    message: string;
  }>[],
): void {
  for (const issue of issues) {
    context.addIssue({
      code: "custom",
      path: [...issue.path],
      message: issue.message,
    });
  }
}

/**
 * v0.2 is deliberately additive: the frozen v0.1 schema is used as the
 * structural and semantic validator, while only the version and provenance
 * axes are replaced. No v0.1 enum is widened in place.
 */
export const actionCardViewModelV02Schema = z
  .unknown()
  .transform((value, context): ActionCardViewModelV02 => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      context.addIssue({
        code: "invalid_type",
        expected: "object",
        input: value,
      });
      return z.NEVER;
    }

    const input = value as Record<string, unknown>;
    if (input.contractVersion !== "action-card-view-model/v0.2") {
      context.addIssue({
        code: "invalid_value",
        values: ["action-card-view-model/v0.2"],
        path: ["contractVersion"],
        input: input.contractVersion,
      });
    }

    const provenanceResult = actionCardV02ProvenanceSchema.safeParse(
      input.provenance,
    );
    if (!provenanceResult.success) {
      addIssues(
        context,
        provenanceResult.error.issues.map((issue) => ({
          ...issue,
          path: ["provenance", ...issue.path],
        })),
      );
    }
    const capabilityBindingResult =
      actionCardV02CapabilityBindingSchema.safeParse(input.capabilityBinding);
    if (!capabilityBindingResult.success) {
      addIssues(
        context,
        capabilityBindingResult.error.issues.map((issue) => ({
          ...issue,
          path: ["capabilityBinding", ...issue.path],
        })),
      );
    }

    if (
      input.contractVersion !== "action-card-view-model/v0.2" ||
      !provenanceResult.success ||
      !capabilityBindingResult.success
    ) {
      return z.NEVER;
    }

    const compatibilityProvenance =
      provenanceResult.data.sourceMode === "static_fixture"
        ? {
            sourceMode: "synthetic_mock" as const,
            harnessVerified: false,
            analyzedAt: null,
            disclosure: provenanceResult.data.disclosure,
          }
        : {
            sourceMode: "deepseek_verified" as const,
            harnessVerified: true,
            analyzedAt: provenanceResult.data.analyzedAt,
            disclosure: provenanceResult.data.disclosure,
          };
    const compatibilityResult = actionCardViewModelSchema.safeParse({
      ...input,
      contractVersion: "action-card-view-model/v0.1",
      provenance: compatibilityProvenance,
      capabilityBinding: {
        ...capabilityBindingResult.data,
        viewModelVersion: "action-card-view-model/v0.1",
      },
    });

    if (!compatibilityResult.success) {
      addIssues(context, compatibilityResult.error.issues);
      return z.NEVER;
    }

    return {
      ...compatibilityResult.data,
      contractVersion: "action-card-view-model/v0.2",
      provenance: provenanceResult.data,
      capabilityBinding: capabilityBindingResult.data,
    };
  });

export type ActionCardAnyVersion = ReadonlyDeep<
  ActionCardViewModel | ActionCardViewModelV02
>;
