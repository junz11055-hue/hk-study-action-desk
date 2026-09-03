import { z } from "zod";

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/);
const shortTextSchema = z.string().trim().min(1).max(120);
const mediumTextSchema = z.string().trim().min(1).max(500);
const longTextSchema = z.string().trim().min(1).max(1_500);
const rfc3339Schema = z.string().datetime({ offset: true });
const hongKongDateTimeSchema = rfc3339Schema.refine(
  (value) => value.endsWith("+08:00"),
  { message: "Asia/Hong_Kong 日期时间必须使用 +08:00 偏移。" },
);
const claimReferenceListSchema = z.array(identifierSchema).max(64);

function isRealCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function normalizedDateValue(
  normalized:
    | { kind: "date_time"; value: string; timeZone: "Asia/Hong_Kong" }
    | { kind: "all_day"; value: string; timeZone: "Asia/Hong_Kong" },
): number {
  return normalized.kind === "date_time"
    ? Date.parse(normalized.value)
    : Date.parse(`${normalized.value}T00:00:00+08:00`);
}

export const factStateSchema = z.enum([
  "confirmed",
  "possible",
  "unconfirmed",
  "not_applicable",
]);

export const topicSchema = z.enum([
  "academic_course",
  "payment_funding",
  "registration_status",
  "visa_identity",
  "exam_results",
  "account_security",
  "campus_activity",
  "housing_campus_life",
  "other_school_affairs",
]);

const nativeImportanceKindSchema = z.enum([
  "sender_importance",
  "provider_importance",
  "user_star",
]);

const nativeImportanceSignalSchema = z
  .object({
    kind: nativeImportanceKindSchema,
    state: z.enum(["present", "absent", "unknown"]),
    protection: z.enum([
      "active",
      "released_by_user",
      "released_by_approved_rule",
      "not_applicable",
      "unknown",
    ]),
  })
  .strict()
  .superRefine((signal, context) => {
    if (
      signal.state === "present" &&
      ["not_applicable", "unknown"].includes(signal.protection)
    ) {
      context.addIssue({
        code: "custom",
        path: ["protection"],
        message: "存在的原生重要信号必须说明保护状态。",
      });
    }

    if (signal.state === "absent" && signal.protection !== "not_applicable") {
      context.addIssue({
        code: "custom",
        path: ["protection"],
        message: "不存在的原生重要信号不能获得保护状态。",
      });
    }

    if (signal.state === "unknown" && signal.protection !== "unknown") {
      context.addIssue({
        code: "custom",
        path: ["protection"],
        message: "未知的重要信号必须保留未知保护态，不能推成存在或不存在。",
      });
    }

    if (
      signal.kind === "user_star" &&
      signal.state === "present" &&
      signal.protection !== "active"
    ) {
      context.addIssue({
        code: "custom",
        path: ["protection"],
        message: "仍存在的用户星标必须保持保护；取消星标后应改为 absent。",
      });
    }
  });

const relevanceBasisSchema = z
  .object({
    id: identifierSchema,
    kind: z.enum(["profile_field", "mail_audience", "schoolwide"]),
    label: shortTextSchema,
    profileState: z
      .enum(["confirmed", "candidate", "expired", "removed"])
      .optional(),
    claimRefs: claimReferenceListSchema.min(1),
  })
  .strict()
  .superRefine((basis, context) => {
    if (basis.kind === "profile_field" && basis.profileState === undefined) {
      context.addIssue({
        code: "custom",
        path: ["profileState"],
        message: "画像依据必须保留确认状态。",
      });
    }

    if (basis.kind !== "profile_field" && basis.profileState !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["profileState"],
        message: "非画像依据不能伪造画像状态。",
      });
    }
  });

const conditionSchema = z
  .object({
    text: mediumTextSchema,
    status: z.enum(["met", "unmet", "unknown"]),
    claimRefs: claimReferenceListSchema.min(1),
    conditionBasisRefs: z.array(identifierSchema).max(12),
  })
  .strict()
  .superRefine((condition, context) => {
    if (
      condition.status !== "unknown" &&
      condition.conditionBasisRefs.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["conditionBasisRefs"],
        message: "条件已满足或不满足必须有已确认的用户事实依据。",
      });
    }

  });

const mailActionSchema = z
  .object({
    id: identifierSchema,
    origin: z.literal("mail"),
    actor: shortTextSchema,
    action: shortTextSchema,
    object: shortTextSchema,
    displayText: mediumTextSchema,
    obligation: z.enum([
      "mandatory",
      "conditional_mandatory",
      "recommended",
      "optional",
    ]),
    factState: factStateSchema,
    condition: conditionSchema.nullable(),
    claimRefs: claimReferenceListSchema,
  })
  .strict()
  .superRefine((action, context) => {
    if (
      action.obligation === "conditional_mandatory" &&
      action.condition === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["condition"],
        message: "条件强制行动必须保留条件及其状态。",
      });
    }

    if (
      action.obligation !== "conditional_mandatory" &&
      action.condition !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["condition"],
        message: "只有条件强制行动可以携带条件对象。",
      });
    }
  });

const managementSuggestionSchema = z
  .object({
    id: identifierSchema,
    origin: z.literal("ai_management_suggestion"),
    safetyClass: z.literal("low_risk_personal_management"),
    text: mediumTextSchema,
    reason: mediumTextSchema,
    claimRefs: claimReferenceListSchema.min(1),
  })
  .strict();

const normalizedDateSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("date_time"),
      value: hongKongDateTimeSchema,
      timeZone: z.literal("Asia/Hong_Kong"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("all_day"),
      value: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .refine(isRealCalendarDate, { message: "全天日期必须真实存在。" }),
      timeZone: z.literal("Asia/Hong_Kong"),
    })
    .strict(),
]);

const calendarEligibilitySchema = z.discriminatedUnion("eligible", [
  z
    .object({
      eligible: z.literal(true),
      blockedReasonCode: z.null(),
    })
    .strict(),
  z
    .object({
      eligible: z.literal(false),
      blockedReasonCode: identifierSchema,
    })
    .strict(),
]);

const dateSchema = z
  .object({
    id: identifierSchema,
    role: z.enum([
      "payment_deadline",
      "registration_deadline",
      "submission_deadline",
      "other_deadline",
      "event_start",
      "event_end",
      "window_start",
      "window_end",
      "effective_at",
    ]),
    originalText: shortTextSchema,
    factState: factStateSchema,
    normalized: normalizedDateSchema.nullable(),
    linkedActionIds: z.array(identifierSchema).max(12),
    claimRefs: claimReferenceListSchema,
    calendarEligibility: calendarEligibilitySchema,
  })
  .strict()
  .superRefine((date, context) => {
    if (date.factState === "confirmed" && date.normalized === null) {
      context.addIssue({
        code: "custom",
        path: ["normalized"],
        message: "已确认日期必须由 Harness 提供规范化值。",
      });
    }

    if (
      date.calendarEligibility.eligible &&
      (date.factState !== "confirmed" ||
        date.normalized === null ||
        date.linkedActionIds.length === 0 ||
        date.claimRefs.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["calendarEligibility"],
        message: "日历资格要求已确认日期、规范化值、行动和声明依据。",
      });
    }
  });

const claimSchema = z
  .object({
    id: identifierSchema,
    kind: z.enum([
      "summary",
      "applicability",
      "action",
      "date",
      "consequence",
      "risk",
      "update",
      "other",
    ]),
    text: longTextSchema,
    highImpact: z.boolean(),
    factState: factStateSchema,
    evidenceIds: z.array(identifierSchema).max(64),
  })
  .strict()
  .superRefine((claim, context) => {
    if (
      (claim.highImpact || claim.factState === "confirmed") &&
      claim.evidenceIds.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidenceIds"],
        message: "高影响或已确认声明必须有逐字证据。",
      });
    }
  });

const evidenceLocationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("subject"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("body"),
      paragraph: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("attachment"),
      attachmentLabel: shortTextSchema,
      page: z.number().int().positive(),
    })
    .strict(),
]);

const evidenceSchema = z
  .object({
    id: identifierSchema,
    quote: longTextSchema,
    location: evidenceLocationSchema,
  })
  .strict();

const riskSchema = z
  .object({
    id: identifierSchema,
    type: z.enum([
      "phishing",
      "credential_request",
      "payment_channel",
      "prompt_injection",
      "source_unverified",
      "attachment",
      "date_conflict",
      "content_conflict",
      "other",
    ]),
    severity: z.enum(["critical", "high", "medium", "low", "info"]),
    message: mediumTextSchema,
    claimRefs: claimReferenceListSchema.min(1),
  })
  .strict();

const actionBlockingRiskTypes = new Set<
  z.infer<typeof riskSchema>["type"]
>([
  "phishing",
  "credential_request",
  "payment_channel",
  "prompt_injection",
  "source_unverified",
  "attachment",
  "date_conflict",
  "content_conflict",
]);

export function isActionBlockingRisk(
  risk: Pick<z.infer<typeof riskSchema>, "severity" | "type">,
): boolean {
  return (
    risk.severity === "critical" ||
    risk.severity === "high" ||
    actionBlockingRiskTypes.has(risk.type)
  );
}

const capabilityKeySchema = z.enum([
  "viewOriginal",
  "viewEvidence",
  "askFixedFollowups",
  "retryAnalysis",
  "openTrustedActionChannel",
  "previewCalendar",
  "writeCalendar",
  "markRead",
  "snooze",
  "markArranged",
  "markCompleted",
  "markIrrelevant",
  "correctClassification",
]);

const unknownSchema = z
  .object({
    field: z.enum([
      "applicability",
      "action",
      "date",
      "source",
      "attachment",
      "evidence",
      "consequence",
      "update_relation",
      "native_importance",
    ]),
    message: mediumTextSchema,
    blockedCapabilities: z.array(capabilityKeySchema).max(7),
  })
  .strict()
  .superRefine((unknown, context) => {
    if (
      new Set(unknown.blockedCapabilities).size !==
      unknown.blockedCapabilities.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["blockedCapabilities"],
        message: "同一不确定项不能重复阻止同一能力。",
      });
    }
  });

const capabilityDecisionSourceSchema = z.enum([
  "harness_policy",
  "phase_boundary",
  "synthetic_fixture",
]);

const capabilityReasonCodeSchema = z.enum([
  "mock_only",
  "not_implemented",
  "not_connected",
  "user_confirmation_required",
  "analysis_pending",
  "candidate_invalid",
  "evidence_unconfirmed",
  "applicability_unconfirmed",
  "obligation_unconfirmed",
  "condition_unconfirmed",
  "date_missing",
  "date_unconfirmed",
  "date_conflict",
  "source_unverified",
  "source_suspicious",
  "action_channel_unverified",
  "security_conflict",
  "attachment_unparsed",
  "relation_ambiguous",
  "item_inactive",
  "version_superseded",
  "unsupported_for_item",
]);

const capabilityAllowedSchema = z
  .object({
    state: z.literal("allowed"),
    decisionSource: capabilityDecisionSourceSchema,
    reasonCodes: z.array(capabilityReasonCodeSchema).length(0),
    message: z.null(),
  })
  .strict();

const capabilityUnavailableSchema = z
  .object({
    state: z.enum(["blocked", "not_applicable", "unavailable"]),
    decisionSource: capabilityDecisionSourceSchema,
    reasonCodes: z.array(capabilityReasonCodeSchema).min(1).max(8),
    message: mediumTextSchema,
  })
  .strict();

const capabilitySchema = z.discriminatedUnion("state", [
  capabilityAllowedSchema,
  capabilityUnavailableSchema,
]);

const previewCalendarCapabilitySchema = z.discriminatedUnion("state", [
  capabilityAllowedSchema.extend({
    eligibleDateIds: z.array(identifierSchema).min(1).max(12),
  }),
  capabilityUnavailableSchema.extend({
    eligibleDateIds: z.array(identifierSchema).length(0),
  }),
]);

const provenanceSchema = z
  .object({
    sourceMode: z.enum([
      "synthetic_mock",
      "deepseek_verified",
      "preset_synthetic_fallback",
      "security_policy",
    ]),
    harnessVerified: z.boolean(),
    analyzedAt: rfc3339Schema.nullable(),
    disclosure: mediumTextSchema,
  })
  .strict()
  .superRefine((provenance, context) => {
    if (
      provenance.sourceMode === "synthetic_mock" &&
      (provenance.harnessVerified || provenance.analyzedAt !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "工程 Mock 不能冒充 Harness 或模型验收结果。",
      });
    }

    if (
      provenance.sourceMode === "deepseek_verified" &&
      (!provenance.harnessVerified || provenance.analyzedAt === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "DeepSeek 已验证状态必须带 Harness 裁决和分析时间。",
      });
    }
  });

export const actionCardViewModelSchema = z
  .object({
    contractVersion: z.literal("action-card-view-model/v0.1"),
    synthetic: z.literal(true),
    notification: z
      .object({
        id: identifierSchema,
        schoolName: shortTextSchema,
        senderName: shortTextSchema,
        senderAddress: z
          .string()
          .email()
          .refine((address) => address.toLowerCase().endsWith(".invalid"), {
            message: "合成数据阶段只允许 .invalid 发件地址。",
          }),
        subject: shortTextSchema,
        sentAt: rfc3339Schema,
        receivedAt: rfc3339Schema,
        language: z.enum(["en", "zh_hant", "zh_hans", "mixed"]),
      })
      .strict(),
    provenance: provenanceSchema,
    homeSection: z.enum(["action_required", "priority_reading", "other"]),
    homeSectionExplanation: mediumTextSchema,
    homeSectionClaimRefs: claimReferenceListSchema.min(1),
    nativeImportanceSignals: z
      .array(nativeImportanceSignalSchema)
      .length(3)
      .superRefine((signals, context) => {
        const kinds = new Set(signals.map((signal) => signal.kind));
        if (kinds.size !== 3) {
          context.addIssue({
            code: "custom",
            message: "三个原生重要信号必须齐全且不能重复。",
          });
        }
      }),
    title: shortTextSchema,
    titleClaimRefs: claimReferenceListSchema.min(1),
    summary: z.string().trim().min(1).max(800),
    summaryClaimRefs: claimReferenceListSchema.min(1),
    topics: z.array(topicSchema).min(1).max(9).superRefine((topics, context) => {
      if (new Set(topics).size !== topics.length) {
        context.addIssue({
          code: "custom",
          message: "主题标签不能重复。",
        });
      }
    }),
    relevance: z
      .object({
        scope: z.enum([
          "self",
          "confirmed_course",
          "program",
          "cohort",
          "faculty",
          "schoolwide",
          "undetermined",
          "not_applicable",
        ]),
        factState: factStateSchema,
        explanation: mediumTextSchema,
        basis: z.array(relevanceBasisSchema).min(1).max(12),
      })
      .strict(),
    sourceTrust: z
      .object({
        sourceStatus: z.enum([
          "official_verified",
          "unverified",
          "suspicious",
          "unknown",
        ]),
        actionChannelStatus: z.enum([
          "verified",
          "unverified",
          "suspicious",
          "not_required",
          "unknown",
        ]),
        reason: mediumTextSchema,
      })
      .strict(),
    informationCompleteness: z
      .object({
        status: z.enum(["complete", "incomplete"]),
        gaps: z.array(
          z.enum([
            "date_unclear",
            "applicability_unclear",
            "attachment_unparsed",
            "conflict",
            "evidence_missing",
          ]),
        ),
      })
      .strict()
      .superRefine((completeness, context) => {
        if (
          (completeness.status === "complete") !==
          (completeness.gaps.length === 0)
        ) {
          context.addIssue({
            code: "custom",
            path: ["gaps"],
            message: "信息完整状态必须与具体缺口一致。",
          });
        }
      }),
    consequence: z
      .object({
        level: z.enum(["high", "medium", "low", "unknown"]),
        factState: factStateSchema,
        reason: mediumTextSchema,
        highConsequenceClue: z.boolean(),
        claimRefs: claimReferenceListSchema,
      })
      .strict(),
    mailActions: z.array(mailActionSchema).max(12),
    managementSuggestions: z.array(managementSuggestionSchema).max(8),
    dates: z.array(dateSchema).max(12),
    claims: z.array(claimSchema).max(64),
    evidence: z.array(evidenceSchema).max(64),
    risks: z.array(riskSchema).max(20),
    unknowns: z.array(unknownSchema).max(20),
    relation: z
      .object({
        disposition: z.enum(["new_item", "update_existing"]),
        matchState: z.enum([
          "not_applicable",
          "confirmed",
          "possible",
          "ambiguous",
        ]),
        relatedItemId: identifierSchema.nullable(),
        explanation: mediumTextSchema,
      })
      .strict(),
    states: z
      .object({
        read: z.enum(["unread", "read"]),
        management: z.enum([
          "active",
          "snoozed",
          "arranged",
          "completed",
          "irrelevant",
        ]),
        item: z.enum(["active", "cancelled", "invalidated"]),
        visibility: z.enum([
          "active",
          "read_folded",
          "user_hidden",
          "merged",
        ]),
        due: z.enum([
          "not_applicable",
          "upcoming",
          "due_soon",
          "overdue",
          "unknown",
        ]),
        version: z.enum(["current", "superseded"]),
        updateKind: z.enum([
          "none",
          "material_update",
          "cancelled",
          "invalidated",
        ]),
        previousVersionId: identifierSchema.nullable(),
        supersededByVersionId: identifierSchema.nullable(),
        mergedIntoId: identifierSchema.nullable(),
      })
      .strict(),
    capabilityBinding: z
      .object({
        viewModelVersion: z.literal("action-card-view-model/v0.1"),
        harnessPolicyVersion: identifierSchema,
        itemVersion: identifierSchema,
      })
      .strict(),
    capabilities: z
      .object({
        viewOriginal: capabilitySchema,
        viewEvidence: capabilitySchema,
        askFixedFollowups: capabilitySchema,
        retryAnalysis: capabilitySchema,
        openTrustedActionChannel: capabilitySchema,
        previewCalendar: previewCalendarCapabilitySchema,
        writeCalendar: capabilitySchema,
        markRead: capabilitySchema,
        snooze: capabilitySchema,
        markArranged: capabilitySchema,
        markCompleted: capabilitySchema,
        markIrrelevant: capabilitySchema,
        correctClassification: capabilitySchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((card, context) => {
    const allIds = [
      ...card.relevance.basis.map(({ id }) => id),
      ...card.mailActions.map(({ id }) => id),
      ...card.managementSuggestions.map(({ id }) => id),
      ...card.dates.map(({ id }) => id),
      ...card.claims.map(({ id }) => id),
      ...card.evidence.map(({ id }) => id),
      ...card.risks.map(({ id }) => id),
    ];
    if (new Set(allIds).size !== allIds.length) {
      context.addIssue({
        code: "custom",
        message: "行动卡内所有实体 ID 必须唯一。",
      });
    }

    const claimById = new Map(card.claims.map((claim) => [claim.id, claim]));
    const evidenceIds = new Set(card.evidence.map(({ id }) => id));
    const actionIds = new Set(card.mailActions.map(({ id }) => id));
    const dateById = new Map(card.dates.map((date) => [date.id, date]));
    const relevanceBasisById = new Map(
      card.relevance.basis.map((basis) => [basis.id, basis]),
    );
    const unknownFields = new Set(card.unknowns.map(({ field }) => field));
    const expectedUnknownFieldByGap: ReadonlyMap<
      string,
      (typeof card.unknowns)[number]["field"]
    > = new Map([
      ["date_unclear", "date"],
      ["applicability_unclear", "applicability"],
      ["attachment_unparsed", "attachment"],
      ["evidence_missing", "evidence"],
    ] as const);

    for (const [gapIndex, gap] of
      card.informationCompleteness.gaps.entries()) {
      const expectedField = expectedUnknownFieldByGap.get(gap);
      if (
        (expectedField !== undefined && !unknownFields.has(expectedField)) ||
        (gap === "conflict" && card.unknowns.length === 0)
      ) {
        context.addIssue({
          code: "custom",
          path: ["informationCompleteness", "gaps", gapIndex],
          message:
            gap === "conflict"
              ? "内容冲突必须有面向用户的具体不确定项。"
              : `完整度缺口 ${gap} 必须有对应的 ${expectedField} 不确定项。`,
        });
      }
    }

    const checkClaimRefs = (refs: readonly string[], path: PropertyKey[]) => {
      for (const ref of refs) {
        if (!claimById.has(ref)) {
          context.addIssue({
            code: "custom",
            path,
            message: `声明引用 ${ref} 不存在。`,
          });
        }
      }
    };

    for (const [index, claim] of card.claims.entries()) {
      for (const evidenceId of claim.evidenceIds) {
        if (!evidenceIds.has(evidenceId)) {
          context.addIssue({
            code: "custom",
            path: ["claims", index, "evidenceIds"],
            message: `证据引用 ${evidenceId} 不存在。`,
          });
        }
      }
    }

    checkClaimRefs(card.titleClaimRefs, ["titleClaimRefs"]);
    checkClaimRefs(card.summaryClaimRefs, ["summaryClaimRefs"]);
    checkClaimRefs(card.homeSectionClaimRefs, ["homeSectionClaimRefs"]);
    for (const [field, refs] of [
      ["titleClaimRefs", card.titleClaimRefs],
      ["summaryClaimRefs", card.summaryClaimRefs],
      ["homeSectionClaimRefs", card.homeSectionClaimRefs],
    ] as const) {
      for (const claimRef of refs) {
        if (claimById.get(claimRef)?.factState !== "confirmed") {
          context.addIssue({
            code: "custom",
            path: [field],
            message: `面向用户的确定文案不能引用未确认声明 ${claimRef}。`,
          });
        }
      }
    }

    for (const [index, action] of card.mailActions.entries()) {
      checkClaimRefs(action.claimRefs, ["mailActions", index, "claimRefs"]);
      for (const claimRef of action.claimRefs) {
        const claim = claimById.get(claimRef);
        if (claim?.kind !== "action") {
          context.addIssue({
            code: "custom",
            path: ["mailActions", index, "claimRefs"],
            message: `邮件行动只能引用 action 声明，收到 ${claimRef}。`,
          });
        }
        if (action.factState === "confirmed" && claim?.factState !== "confirmed") {
          context.addIssue({
            code: "custom",
            path: ["mailActions", index, "claimRefs"],
            message: `已确认行动不能引用未确认声明 ${claimRef}。`,
          });
        }
      }
      if (action.factState === "confirmed" && action.claimRefs.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["mailActions", index, "claimRefs"],
          message: "已确认邮件行动必须引用声明。",
        });
      }
      if (action.condition !== null) {
        checkClaimRefs(action.condition.claimRefs, [
          "mailActions",
          index,
          "condition",
          "claimRefs",
        ]);
        for (const conditionClaimRef of action.condition.claimRefs) {
          const conditionClaim = claimById.get(conditionClaimRef);
          if (
            conditionClaim?.factState !== "confirmed" ||
            !["action", "applicability"].includes(
              conditionClaim?.kind ?? "",
            )
          ) {
            context.addIssue({
              code: "custom",
              path: [
                "mailActions",
                index,
                "condition",
                "claimRefs",
              ],
              message: `邮件条件必须引用已确认的 action/applicability 声明，收到 ${conditionClaimRef}。`,
            });
          }
        }
        for (const basisRef of action.condition.conditionBasisRefs) {
          const basis = relevanceBasisById.get(basisRef);
          if (basis === undefined) {
            context.addIssue({
              code: "custom",
              path: [
                "mailActions",
                index,
                "condition",
                "conditionBasisRefs",
              ],
              message: `条件事实依据 ${basisRef} 不存在。`,
            });
          } else if (basis.kind !== "profile_field") {
            context.addIssue({
              code: "custom",
              path: [
                "mailActions",
                index,
                "condition",
                "conditionBasisRefs",
              ],
              message: `条件状态只能引用用户画像事实，收到 ${basisRef}。`,
            });
          } else if (
            action.condition.status !== "unknown" &&
            basis.profileState !== "confirmed"
          ) {
            context.addIssue({
              code: "custom",
              path: [
                "mailActions",
                index,
                "condition",
                "conditionBasisRefs",
              ],
              message: `条件结论只能引用已确认画像事实，收到 ${basisRef}。`,
            });
          }
        }
      }
    }

    for (const [index, suggestion] of card.managementSuggestions.entries()) {
      checkClaimRefs(suggestion.claimRefs, [
        "managementSuggestions",
        index,
        "claimRefs",
      ]);
      for (const claimRef of suggestion.claimRefs) {
        if (claimById.get(claimRef)?.factState !== "confirmed") {
          context.addIssue({
            code: "custom",
            path: ["managementSuggestions", index, "claimRefs"],
            message: `AI 管理建议只能引用已确认声明，收到 ${claimRef}。`,
          });
        }
      }
    }

    for (const [index, date] of card.dates.entries()) {
      checkClaimRefs(date.claimRefs, ["dates", index, "claimRefs"]);
      for (const claimRef of date.claimRefs) {
        const claim = claimById.get(claimRef);
        if (claim?.kind !== "date") {
          context.addIssue({
            code: "custom",
            path: ["dates", index, "claimRefs"],
            message: `日期只能引用 date 声明，收到 ${claimRef}。`,
          });
        }
        if (date.factState === "confirmed" && claim?.factState !== "confirmed") {
          context.addIssue({
            code: "custom",
            path: ["dates", index, "claimRefs"],
            message: `已确认日期不能引用未确认声明 ${claimRef}。`,
          });
        }
      }
      if (date.factState === "confirmed" && date.claimRefs.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["dates", index, "claimRefs"],
          message: "已确认日期必须引用已确认 date 声明。",
        });
      }
      for (const actionId of date.linkedActionIds) {
        if (!actionIds.has(actionId)) {
          context.addIssue({
            code: "custom",
            path: ["dates", index, "linkedActionIds"],
            message: `行动引用 ${actionId} 不存在。`,
          });
        }
      }
    }

    for (const [index, basis] of card.relevance.basis.entries()) {
      checkClaimRefs(basis.claimRefs, ["relevance", "basis", index, "claimRefs"]);
      for (const claimRef of basis.claimRefs) {
        const claim = claimById.get(claimRef);
        if (claim?.kind !== "applicability") {
          context.addIssue({
            code: "custom",
            path: ["relevance", "basis", index, "claimRefs"],
            message: `适用性依据只能引用 applicability 声明，收到 ${claimRef}。`,
          });
        }
        if (
          card.relevance.factState === "confirmed" &&
          claim?.factState !== "confirmed"
        ) {
          context.addIssue({
            code: "custom",
            path: ["relevance", "basis", index, "claimRefs"],
            message: `已确认适用性不能引用未确认声明 ${claimRef}。`,
          });
        }
      }
    }

    const scopeRequiresConfirmedProfile = [
      "confirmed_course",
      "program",
      "cohort",
      "faculty",
    ].includes(card.relevance.scope);
    const hasConfirmedProfileBasis = card.relevance.basis.some(
      (basis) =>
        basis.kind === "profile_field" && basis.profileState === "confirmed",
    );
    if (
      card.relevance.factState === "confirmed" &&
      scopeRequiresConfirmedProfile &&
      !hasConfirmedProfileBasis
    ) {
      context.addIssue({
        code: "custom",
        path: ["relevance", "basis"],
        message:
          "课程、项目、届别或院系适用性必须由已确认画像支持，候选或过期画像只能表示可能相关。",
      });
    }
    checkClaimRefs(card.consequence.claimRefs, ["consequence", "claimRefs"]);
    for (const claimRef of card.consequence.claimRefs) {
      const claim = claimById.get(claimRef);
      if (claim?.kind !== "consequence") {
        context.addIssue({
          code: "custom",
          path: ["consequence", "claimRefs"],
          message: `后果只能引用 consequence 声明，收到 ${claimRef}。`,
        });
      }
      if (
        card.consequence.factState === "confirmed" &&
        claim?.factState !== "confirmed"
      ) {
        context.addIssue({
          code: "custom",
          path: ["consequence", "claimRefs"],
          message: `已确认后果不能引用未确认声明 ${claimRef}。`,
        });
      }
    }
    if (
      card.consequence.factState === "confirmed" &&
      card.consequence.level !== "unknown" &&
      card.consequence.claimRefs.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["consequence", "claimRefs"],
        message: "已确认的后果等级必须引用 consequence 声明。",
      });
    }
    for (const [index, risk] of card.risks.entries()) {
      checkClaimRefs(risk.claimRefs, ["risks", index, "claimRefs"]);
      for (const claimRef of risk.claimRefs) {
        if (claimById.get(claimRef)?.kind !== "risk") {
          context.addIssue({
            code: "custom",
            path: ["risks", index, "claimRefs"],
            message: `风险只能引用 risk 声明，收到 ${claimRef}。`,
          });
        }
      }
    }

    const hasFailClosedRisk = card.risks.some(isActionBlockingRisk);
    const isCurrentActiveItem =
      card.states.item === "active" &&
      card.states.version === "current" &&
      card.states.visibility !== "merged";
    const actionBlockingCompletenessGaps = new Set([
      "applicability_unclear",
      "attachment_unparsed",
      "conflict",
      "evidence_missing",
    ]);
    const hasActionBlockingCompletenessGap =
      card.informationCompleteness.gaps.some((gap) =>
        actionBlockingCompletenessGaps.has(gap),
      );
    const hasCalendarBlockingCompletenessGap =
      card.informationCompleteness.gaps.length > 0;

    const hasConfirmedRequiredAction = card.mailActions.some(
      (action) =>
        action.factState === "confirmed" &&
        (action.obligation === "mandatory" ||
          (action.obligation === "conditional_mandatory" &&
            action.condition?.status === "met")),
    );
    const hasTrustedApplicabilityBasis =
      card.relevance.basis.some(
        (basis) =>
          basis.kind === "mail_audience" ||
          basis.kind === "schoolwide" ||
          (basis.kind === "profile_field" &&
            basis.profileState === "confirmed"),
      ) && (!scopeRequiresConfirmedProfile || hasConfirmedProfileBasis);
    const qualifiesForActionRequired =
      hasConfirmedRequiredAction &&
      card.relevance.factState === "confirmed" &&
      !["undetermined", "not_applicable"].includes(card.relevance.scope) &&
      hasTrustedApplicabilityBasis &&
      card.sourceTrust.sourceStatus === "official_verified" &&
      ["verified", "not_required"].includes(
        card.sourceTrust.actionChannelStatus,
      ) &&
      !hasFailClosedRisk &&
      !hasActionBlockingCompletenessGap &&
      isCurrentActiveItem;

    if (card.homeSection === "action_required") {
      if (
        !qualifiesForActionRequired
      ) {
        context.addIssue({
          code: "custom",
          path: ["homeSection"],
          message:
            "“要处理”必须通过行动、适用性、来源、渠道、安全、完整度和事项生命周期门。",
        });
      }
    }

    if (
      card.homeSection !== "action_required" &&
      qualifiesForActionRequired
    ) {
      context.addIssue({
        code: "custom",
        path: ["homeSection"],
        message: "已通过全部安全门的当前强制行动不能被降到“优先阅读”或“其他通知”。",
      });
    }

    if (card.homeSection === "other") {
      const hasActiveNativeProtection = card.nativeImportanceSignals.some(
        (signal) =>
          (signal.state === "present" && signal.protection === "active") ||
          signal.state === "unknown",
      );
      const hasConsequenceProtection =
        (["high", "medium"].includes(card.consequence.level) &&
          ["confirmed", "possible", "unconfirmed"].includes(
            card.consequence.factState,
          )) ||
        (card.consequence.level === "unknown" &&
          card.consequence.highConsequenceClue);
      const hasSafetyProtection =
        card.sourceTrust.sourceStatus === "suspicious" ||
        card.sourceTrust.actionChannelStatus === "suspicious" ||
        hasFailClosedRisk;
      const hasAcademicProtection =
        ["confirmed", "possible", "unconfirmed"].includes(
          card.relevance.factState,
        ) &&
        ["self", "confirmed_course", "program", "cohort", "faculty"].includes(
          card.relevance.scope,
        ) &&
        card.topics.includes("academic_course");
      const hasConfirmedCriticalChange = card.claims.some(
        (claim) =>
          claim.kind === "update" &&
          ["confirmed", "possible", "unconfirmed"].includes(
            claim.factState,
          ) &&
          claim.highImpact,
      );
      const hasUnresolvedRequiredAction = card.mailActions.some(
        (action) =>
          ["mandatory", "conditional_mandatory"].includes(
            action.obligation,
          ) &&
          action.factState !== "not_applicable",
      );

      if (
        hasActiveNativeProtection ||
        hasConsequenceProtection ||
        hasSafetyProtection ||
        hasAcademicProtection ||
        hasConfirmedCriticalChange ||
        hasActionBlockingCompletenessGap ||
        hasUnresolvedRequiredAction
      ) {
        context.addIssue({
          code: "custom",
          path: ["homeSection"],
          message: "受原生重要、高后果、安全或专业关键变更保护的通知不能进入“其他通知”。",
        });
      }
    }

    for (const [index, date] of card.dates.entries()) {
      if (!date.calendarEligibility.eligible) {
        continue;
      }

      const linkedActions = date.linkedActionIds
        .map((actionId) => card.mailActions.find(({ id }) => id === actionId))
        .filter((action) => action !== undefined);
      const dateClaimsConfirmed = date.claimRefs.every(
        (claimRef) => claimById.get(claimRef)?.factState === "confirmed",
      );
      const requiredStartRole =
        date.role === "event_end"
          ? "event_start"
          : date.role === "window_end"
            ? "window_start"
            : null;
      const hasValidPairedStart =
        requiredStartRole === null ||
        card.dates.some(
          (candidate) =>
            candidate.id !== date.id &&
            candidate.role === requiredStartRole &&
            candidate.calendarEligibility.eligible &&
            candidate.normalized !== null &&
            date.normalized !== null &&
            candidate.linkedActionIds.some((actionId) =>
              date.linkedActionIds.includes(actionId),
            ) &&
            normalizedDateValue(candidate.normalized) <
              normalizedDateValue(date.normalized),
        );

      if (
        linkedActions.length !== date.linkedActionIds.length ||
        linkedActions.some(
          (action) =>
            action.factState !== "confirmed" ||
            (action.obligation === "conditional_mandatory" &&
              action.condition?.status !== "met"),
        ) ||
        !dateClaimsConfirmed ||
        card.relevance.factState !== "confirmed" ||
        card.sourceTrust.sourceStatus !== "official_verified" ||
        !["verified", "not_required"].includes(
          card.sourceTrust.actionChannelStatus,
        ) ||
        hasFailClosedRisk ||
        hasCalendarBlockingCompletenessGap ||
        !isCurrentActiveItem ||
        !hasValidPairedStart
      ) {
        context.addIssue({
          code: "custom",
          path: ["dates", index, "calendarEligibility"],
          message:
            "日历资格必须通过行动、日期、适用性、来源、渠道、安全、完整度和事项生命周期门。",
        });
      }
    }

    if (card.relation.disposition === "new_item") {
      if (
        card.relation.matchState === "confirmed" ||
        (card.relation.matchState === "not_applicable" &&
          card.relation.relatedItemId !== null) ||
        card.states.previousVersionId !== null ||
        card.states.updateKind !== "none"
      ) {
        context.addIssue({
          code: "custom",
          path: ["relation"],
          message: "新事项不能伪装成已确认旧事项更新或继承旧版本状态。",
        });
      }
    }

    if (
      card.relation.disposition === "update_existing" &&
      (card.relation.matchState !== "confirmed" ||
        card.relation.relatedItemId === null ||
        card.states.previousVersionId === null ||
        card.states.updateKind === "none")
    ) {
      context.addIssue({
        code: "custom",
        path: ["relation"],
        message: "更新旧事项必须有已确认关系、旧事项 ID、旧版本 ID 和更新类型。",
      });
    }

    if (
      (card.states.visibility === "merged") !==
      (card.states.mergedIntoId !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["states", "mergedIntoId"],
        message: "合并可见性必须与目标事项 ID 同时出现。",
      });
    }

    if (
      card.states.version === "current" &&
      card.states.supersededByVersionId !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["states", "supersededByVersionId"],
        message: "当前版本不能声称已被另一个版本替代。",
      });
    }

    if (
      card.states.version === "superseded" &&
      card.states.supersededByVersionId === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["states", "supersededByVersionId"],
        message: "被替代版本必须指向取代它的新版本。",
      });
    }

    if (card.capabilities.writeCalendar.state === "allowed") {
      context.addIssue({
        code: "custom",
        path: ["capabilities", "writeCalendar"],
        message: "合成数据阶段禁止写入任何真实日历。",
      });
    }

    for (const [unknownIndex, unknown] of card.unknowns.entries()) {
      for (const [capabilityIndex, capabilityKey] of
        unknown.blockedCapabilities.entries()) {
        if (card.capabilities[capabilityKey].state === "allowed") {
          context.addIssue({
            code: "custom",
            path: [
              "unknowns",
              unknownIndex,
              "blockedCapabilities",
              capabilityIndex,
            ],
            message: `不确定项已阻止 ${capabilityKey}，对应能力不能为 allowed。`,
          });
        }
      }
    }

    if (
      card.capabilities.openTrustedActionChannel.state === "allowed" &&
      (card.sourceTrust.sourceStatus !== "official_verified" ||
        card.sourceTrust.actionChannelStatus !== "verified" ||
        hasFailClosedRisk ||
        hasActionBlockingCompletenessGap ||
        !isCurrentActiveItem ||
        !card.mailActions.some(
          (action) =>
            action.factState === "confirmed" &&
            (action.obligation !== "conditional_mandatory" ||
              action.condition?.status === "met"),
        ))
    ) {
      context.addIssue({
        code: "custom",
        path: ["capabilities", "openTrustedActionChannel"],
        message:
          "可信行动渠道必须有已确认行动，并通过官方来源、渠道、安全、完整度和事项生命周期门。",
      });
    }

    const calendarEligibleDateIds = card.dates
      .filter((date) => date.calendarEligibility.eligible)
      .map(({ id }) => id)
      .sort();
    const capabilityEligibleDateIds = [
      ...card.capabilities.previewCalendar.eligibleDateIds,
    ].sort();

    for (const dateId of capabilityEligibleDateIds) {
      if (!dateById.get(dateId)?.calendarEligibility.eligible) {
        context.addIssue({
          code: "custom",
          path: ["capabilities", "previewCalendar", "eligibleDateIds"],
          message: `日历能力引用了未获得资格的日期 ${dateId}。`,
        });
      }
    }

    if (
      calendarEligibleDateIds.length !== capabilityEligibleDateIds.length ||
      calendarEligibleDateIds.some(
        (dateId, index) => dateId !== capabilityEligibleDateIds[index],
      ) ||
      (calendarEligibleDateIds.length > 0 &&
        card.capabilities.previewCalendar.state !== "allowed")
    ) {
      context.addIssue({
        code: "custom",
        path: ["capabilities", "previewCalendar"],
        message: "逐日期资格必须与全局日历预览能力双向一致。",
      });
    }
  });

const pendingResourceSchema = z
  .object({
    status: z.enum(["idle", "submitting", "running"]),
    card: z.null(),
    error: z.null(),
  })
  .strict();

const failedResourceSchema = z
  .object({
    status: z.literal("failed"),
    card: z.null(),
    error: z
      .object({
        code: identifierSchema,
        message: mediumTextSchema,
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();

const successfulResourceSchema = z
  .object({
    status: z.enum(["succeeded", "partially_succeeded"]),
    card: actionCardViewModelSchema,
    error: z.null(),
  })
  .strict()
  .superRefine((resource, context) => {
    if (
      resource.status === "partially_succeeded" &&
      resource.card.informationCompleteness.status !== "incomplete" &&
      resource.card.unknowns.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "部分成功必须暴露具体缺口。",
      });
    }
  });

export const actionCardResourceSchema = z.union([
  pendingResourceSchema,
  failedResourceSchema,
  successfulResourceSchema,
]);

export type ActionCardViewModel = z.infer<typeof actionCardViewModelSchema>;
export type ActionCardViewModelInput = z.input<
  typeof actionCardViewModelSchema
>;
export type ActionCardResource = z.infer<typeof actionCardResourceSchema>;
