import { describe, expect, it } from "vitest";
import { syntheticActionCardFixture } from "../features/action-center/data/synthetic-action-card.fixture";
import {
  actionCardResourceSchema,
  actionCardViewModelSchema,
  type ActionCardViewModelInput,
} from "../features/action-center/model/action-card-view-model";

function cloneFixture(): ActionCardViewModelInput {
  return structuredClone(syntheticActionCardFixture);
}

function releaseCriticalUpdateProtection(
  payload: ActionCardViewModelInput,
): void {
  const updateClaim = payload.claims.find(
    (claim) => claim.id === "claim-update-001",
  );
  if (updateClaim === undefined) {
    throw new Error("Synthetic fixture is missing its update claim.");
  }
  updateClaim.highImpact = false;
}

function createCalendarEligibleFixture(): ActionCardViewModelInput {
  const payload = cloneFixture();
  payload.claims.push({
    id: "claim-action-attend-001",
    kind: "action",
    text: "学生必须参加本次研讨课。",
    highImpact: true,
    factState: "confirmed",
    evidenceIds: ["evidence-body-audience-001"],
  });
  payload.mailActions.push({
    id: "action-attend-001",
    origin: "mail",
    actor: "学生",
    action: "参加",
    object: "本次研讨课",
    displayText: "参加本次研讨课。",
    obligation: "mandatory",
    factState: "confirmed",
    condition: null,
    claimRefs: ["claim-action-attend-001"],
  });
  payload.homeSection = "action_required";
  payload.sourceTrust.sourceStatus = "official_verified";
  payload.dates[0]!.linkedActionIds = ["action-attend-001"];
  payload.dates[0]!.calendarEligibility = {
    eligible: true,
    blockedReasonCode: null,
  };
  payload.capabilities.previewCalendar = {
    state: "allowed",
    decisionSource: "synthetic_fixture",
    reasonCodes: [],
    message: null,
    eligibleDateIds: ["date-event-start-001"],
  };
  return payload;
}

function disableCalendarPreview(payload: ActionCardViewModelInput): void {
  payload.dates[0]!.calendarEligibility = {
    eligible: false,
    blockedReasonCode: "test_preview_disabled",
  };
  payload.capabilities.previewCalendar = {
    state: "not_applicable",
    decisionSource: "synthetic_fixture",
    reasonCodes: ["unsupported_for_item"],
    message: "此测试不验证日历预览。",
    eligibleDateIds: [],
  };
}

describe("ActionCardViewModel v0.1", () => {
  it("accepts the bounded synthetic fixture", () => {
    const result = actionCardViewModelSchema.safeParse(
      syntheticActionCardFixture,
    );

    expect(result.success).toBe(true);
  });

  it.each([
    [
      "wrong contract version",
      { ...syntheticActionCardFixture, contractVersion: "future-version" },
    ],
    [
      "unknown root field",
      { ...syntheticActionCardFixture, leakedCandidateField: true },
    ],
    [
      "non-synthetic payload",
      { ...syntheticActionCardFixture, synthetic: false },
    ],
    [
      "non-invalid sender address",
      {
        ...syntheticActionCardFixture,
        notification: {
          ...syntheticActionCardFixture.notification,
          senderAddress: "programme-office@example.com",
        },
      },
    ],
  ])("rejects %s", (_name, payload) => {
    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects dangling evidence references", () => {
    const payload = cloneFixture();
    payload.claims[0]!.evidenceIds = ["evidence-missing-001"];

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects a missing title claim reference", () => {
    const payload = cloneFixture();
    payload.titleClaimRefs = ["claim-missing-title-001"];

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("keeps unknown native importance distinct from absent", () => {
    const payload = cloneFixture();
    payload.nativeImportanceSignals[0] = {
      kind: "sender_importance",
      state: "unknown",
      protection: "active",
    };

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("keeps an active user star protected until it is actually removed", () => {
    const payload = cloneFixture();
    payload.nativeImportanceSignals[2] = {
      kind: "user_star",
      state: "present",
      protection: "released_by_user",
    };

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("does not allow protected academic changes in other notifications", () => {
    const payload = cloneFixture();
    payload.homeSection = "other";
    payload.consequence.level = "low";
    releaseCriticalUpdateProtection(payload);

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("does not treat an unknown native importance signal as absent", () => {
    const payload = cloneFixture();
    payload.homeSection = "other";
    payload.topics = ["other_school_affairs"];
    payload.relevance.scope = "schoolwide";
    payload.consequence.level = "low";
    releaseCriticalUpdateProtection(payload);
    payload.nativeImportanceSignals[0] = {
      kind: "sender_importance",
      state: "unknown",
      protection: "unknown",
    };

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("keeps a possibly relevant course notice out of other notifications", () => {
    const payload = cloneFixture();
    payload.homeSection = "other";
    payload.relevance.factState = "possible";
    payload.consequence.level = "low";
    releaseCriticalUpdateProtection(payload);

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("keeps an unconfirmed course notice out of other notifications", () => {
    const payload = cloneFixture();
    payload.homeSection = "other";
    payload.relevance.factState = "unconfirmed";
    payload.consequence.level = "low";
    releaseCriticalUpdateProtection(payload);

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("does not let a confirmed field depend on a possible claim", () => {
    const payload = cloneFixture();
    const applicabilityClaim = payload.claims.find(
      (claim) => claim.id === "claim-applicability-001",
    );
    if (applicabilityClaim === undefined) {
      throw new Error("Synthetic fixture is missing its applicability claim.");
    }
    applicabilityClaim.factState = "possible";

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("does not let title or summary cite a possible claim as settled text", () => {
    const payload = cloneFixture();
    const summaryClaim = payload.claims.find(
      (claim) => claim.id === "claim-summary-001",
    );
    if (summaryClaim === undefined) {
      throw new Error("Synthetic fixture is missing its summary claim.");
    }
    summaryClaim.factState = "possible";

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("does not let an AI management suggestion cite an unconfirmed claim", () => {
    const payload = cloneFixture();
    payload.claims.push({
      id: "claim-possible-management-001",
      kind: "other",
      text: "这是一条未确认的管理依据。",
      highImpact: false,
      factState: "possible",
      evidenceIds: ["evidence-body-audience-001"],
    });
    payload.managementSuggestions[0]!.claimRefs = [
      "claim-possible-management-001",
    ];

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("requires evidence-backed claims for a confirmed consequence", () => {
    const payload = cloneFixture();
    payload.consequence = {
      level: "medium",
      factState: "confirmed",
      reason: "该后果仅用于验证失败关闭。",
      highConsequenceClue: false,
      claimRefs: [],
    };

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects an optional-only card promoted to action required", () => {
    const payload = cloneFixture();
    payload.homeSection = "action_required";
    payload.sourceTrust.sourceStatus = "official_verified";
    payload.claims.push({
      id: "claim-action-optional-001",
      kind: "action",
      text: "学生可以自愿回复邮件。",
      highImpact: false,
      factState: "confirmed",
      evidenceIds: ["evidence-body-audience-001"],
    });
    payload.mailActions.push({
      id: "action-optional-001",
      origin: "mail",
      actor: "学生",
      action: "回复",
      object: "课程办公室",
      displayText: "如有需要，可以自愿回复课程办公室。",
      obligation: "optional",
      factState: "confirmed",
      condition: null,
      claimRefs: ["claim-action-optional-001"],
    });

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects AI-origin content placed in mailActions", () => {
    const payload = cloneFixture() as unknown as Record<string, unknown>;
    payload.mailActions = [
      {
        id: "action-ai-001",
        origin: "ai_management_suggestion",
        actor: "用户",
        action: "记笔记",
        object: "课程地点",
        displayText: "记下课程地点。",
        obligation: "optional",
        factState: "confirmed",
        condition: null,
        claimRefs: ["claim-update-001"],
      },
    ];

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("requires confirmed user facts before a condition can be met", () => {
    const payload = cloneFixture();
    payload.claims.push({
      id: "claim-action-conditional-001",
      kind: "action",
      text: "满足条件的学生必须回复。",
      highImpact: true,
      factState: "confirmed",
      evidenceIds: ["evidence-body-audience-001"],
    });
    payload.mailActions.push({
      id: "action-conditional-001",
      origin: "mail",
      actor: "满足条件的学生",
      action: "回复",
      object: "课程办公室",
      displayText: "满足条件时回复课程办公室。",
      obligation: "conditional_mandatory",
      factState: "confirmed",
      condition: {
        text: "仅适用于指定学生",
        status: "met",
        claimRefs: ["claim-action-conditional-001"],
        conditionBasisRefs: [],
      },
      claimRefs: ["claim-action-conditional-001"],
    });

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it.each(["met", "unmet"] as const)(
    "rejects a %s condition backed by a possible condition claim",
    (conditionStatus) => {
      const payload = cloneFixture();
      payload.claims.push(
        {
          id: "claim-action-conditional-confirmed-001",
          kind: "action",
          text: "满足邮件条件的学生必须回复课程办公室。",
          highImpact: true,
          factState: "confirmed",
          evidenceIds: ["evidence-body-audience-001"],
        },
        {
          id: "claim-condition-possible-001",
          kind: "applicability",
          text: "邮件条件可能适用于该学生。",
          highImpact: true,
          factState: "possible",
          evidenceIds: ["evidence-body-audience-001"],
        },
      );
      payload.mailActions.push({
        id: "action-conditional-possible-001",
        origin: "mail",
        actor: "满足条件的学生",
        action: "回复",
        object: "课程办公室",
        displayText: "满足条件时回复课程办公室。",
        obligation: "conditional_mandatory",
        factState: "confirmed",
        condition: {
          text: "仅适用于满足邮件条件的学生",
          status: conditionStatus,
          claimRefs: ["claim-condition-possible-001"],
          conditionBasisRefs: ["basis-profile-course-001"],
        },
        claimRefs: ["claim-action-conditional-confirmed-001"],
      });

      expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
    },
  );

  it("accepts an unknown conditional action with a candidate profile only in priority reading", () => {
    const payload = cloneFixture();
    payload.claims.push({
      id: "claim-action-conditional-unknown-001",
      kind: "action",
      text: "邮件要求满足指定条件的学生回复课程办公室。",
      highImpact: true,
      factState: "confirmed",
      evidenceIds: ["evidence-body-audience-001"],
    });
    payload.relevance.basis.push({
      id: "basis-profile-condition-candidate-001",
      kind: "profile_field",
      label: "合成画像候选：可能满足邮件条件",
      profileState: "candidate",
      claimRefs: ["claim-applicability-001"],
    });
    payload.mailActions.push({
      id: "action-conditional-unknown-001",
      origin: "mail",
      actor: "满足条件的学生",
      action: "回复",
      object: "课程办公室",
      displayText: "若满足邮件条件，需要回复课程办公室。",
      obligation: "conditional_mandatory",
      factState: "confirmed",
      condition: {
        text: "仅适用于满足指定条件的学生",
        status: "unknown",
        claimRefs: ["claim-action-conditional-unknown-001"],
        conditionBasisRefs: ["basis-profile-condition-candidate-001"],
      },
      claimRefs: ["claim-action-conditional-unknown-001"],
    });

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(true);

    payload.homeSection = "other";
    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);

    payload.homeSection = "action_required";
    payload.sourceTrust.sourceStatus = "official_verified";
    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("requires every applicability basis to carry a supporting claim", () => {
    const payload = cloneFixture();
    payload.relevance.basis[0]!.claimRefs = [];

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects calendar eligibility inferred from a non-action date", () => {
    const payload = cloneFixture();
    payload.dates[0]!.calendarEligibility = {
      eligible: true,
      blockedReasonCode: null,
    };

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("requires every completeness gap to have a user-visible uncertainty", () => {
    const payload = cloneFixture();
    payload.informationCompleteness = {
      status: "incomplete",
      gaps: ["attachment_unparsed"],
    };

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects impossible all-day dates", () => {
    const payload = cloneFixture();
    payload.dates[0]!.normalized = {
      kind: "all_day",
      value: "2026-02-31",
      timeZone: "Asia/Hong_Kong",
    };

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects a Hong Kong date-time carrying a contradictory offset", () => {
    const payload = cloneFixture();
    payload.dates[0]!.normalized = {
      kind: "date_time",
      value: "2026-09-03T18:30:00-05:00",
      timeZone: "Asia/Hong_Kong",
    };

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("requires a confirmed date to cite a date claim", () => {
    const payload = cloneFixture();
    payload.dates[0]!.claimRefs = [];

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects a blocked capability without a controlled reason", () => {
    const payload = cloneFixture() as unknown as Record<string, unknown>;
    const capabilities = structuredClone(
      syntheticActionCardFixture.capabilities,
    ) as unknown as Record<string, unknown>;
    capabilities.writeCalendar = {
      state: "blocked",
      decisionSource: "phase_boundary",
      reasonCodes: [],
      message: "不能写入。",
    };
    payload.capabilities = capabilities;

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("hard-blocks real calendar writes in the synthetic contract", () => {
    const payload = cloneFixture();
    payload.capabilities.writeCalendar = {
      state: "allowed",
      decisionSource: "synthetic_fixture",
      reasonCodes: [],
      message: null,
    };

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("does not open a trusted action channel for an unverified source", () => {
    const payload = cloneFixture();
    payload.capabilities.openTrustedActionChannel = {
      state: "allowed",
      decisionSource: "synthetic_fixture",
      reasonCodes: [],
      message: null,
    };

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("enforces capability blocks declared by an uncertainty", () => {
    const payload = cloneFixture();
    payload.unknowns[0]!.blockedCapabilities = ["viewEvidence"];

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("accepts a fully gated synthetic calendar preview", () => {
    const payload = createCalendarEligibleFixture();

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(true);
  });

  it("does not demote a fully gated mandatory action", () => {
    const payload = createCalendarEligibleFixture();
    payload.homeSection = "priority_reading";

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("does not keep an inactive item in action required", () => {
    const payload = createCalendarEligibleFixture();
    disableCalendarPreview(payload);
    payload.states.item = "cancelled";

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("blocks calendar preview for an inactive item independently of home placement", () => {
    const payload = createCalendarEligibleFixture();
    payload.mailActions[0]!.obligation = "recommended";
    payload.homeSection = "priority_reading";

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(true);

    payload.states.item = "invalidated";
    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("blocks calendar preview for a superseded item version", () => {
    const payload = createCalendarEligibleFixture();
    payload.mailActions[0]!.obligation = "recommended";
    payload.homeSection = "priority_reading";
    payload.states.version = "superseded";
    payload.states.supersededByVersionId = "synthetic-version-002";

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("blocks a trusted action channel after the item becomes inactive", () => {
    const payload = cloneFixture();
    payload.claims.push({
      id: "claim-action-channel-ui-001",
      kind: "action",
      text: "邮件提供一个可选的官方课程页面。",
      highImpact: false,
      factState: "confirmed",
      evidenceIds: ["evidence-body-audience-001"],
    });
    payload.mailActions.push({
      id: "action-channel-ui-001",
      origin: "mail",
      actor: "学生",
      action: "查看",
      object: "官方课程页面",
      displayText: "查看官方课程页面。",
      obligation: "optional",
      factState: "confirmed",
      condition: null,
      claimRefs: ["claim-action-channel-ui-001"],
    });
    payload.sourceTrust.sourceStatus = "official_verified";
    payload.sourceTrust.actionChannelStatus = "verified";
    payload.capabilities.openTrustedActionChannel = {
      state: "allowed",
      decisionSource: "synthetic_fixture",
      reasonCodes: [],
      message: null,
    };

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(true);

    payload.states.item = "cancelled";
    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("keeps an attachment completeness gap out of action required", () => {
    const payload = createCalendarEligibleFixture();
    disableCalendarPreview(payload);
    payload.informationCompleteness = {
      status: "incomplete",
      gaps: ["attachment_unparsed"],
    };
    payload.unknowns.push({
      field: "attachment",
      message: "附件尚未解析，可能包含补充要求。",
      blockedCapabilities: [],
    });

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);

    payload.homeSection = "priority_reading";
    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(true);
  });

  it("blocks calendar preview while any completeness gap remains", () => {
    const payload = createCalendarEligibleFixture();
    payload.mailActions[0]!.obligation = "recommended";
    payload.homeSection = "priority_reading";
    payload.informationCompleteness = {
      status: "incomplete",
      gaps: ["date_unclear"],
    };
    payload.unknowns.push({
      field: "date",
      message: "邮件另有日期表达尚未核清。",
      blockedCapabilities: [],
    });

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("does not treat a candidate course profile as confirmed applicability", () => {
    const payload = createCalendarEligibleFixture();
    const courseBasis = payload.relevance.basis.find(
      (basis) => basis.id === "basis-profile-course-001",
    );
    if (courseBasis === undefined || courseBasis.kind !== "profile_field") {
      throw new Error("Synthetic fixture is missing its course profile basis.");
    }
    courseBasis.profileState = "candidate";

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it.each([
    ["unverified source", "unverified", "unverified"],
    ["unverified action channel", "official_verified", "unverified"],
  ] as const)(
    "keeps a mandatory action with %s out of other notifications",
    (_name, sourceStatus, actionChannelStatus) => {
      const payload = cloneFixture();
      payload.homeSection = "other";
      payload.topics = ["other_school_affairs"];
      payload.relevance = {
        scope: "schoolwide",
        factState: "confirmed",
        explanation: "邮件正文明确面向全校学生。",
        basis: [
          {
            id: "basis-schoolwide-required-001",
            kind: "schoolwide",
            label: "邮件正文明确面向全校学生",
            claimRefs: ["claim-applicability-001"],
          },
        ],
      };
      payload.sourceTrust.sourceStatus = sourceStatus;
      payload.sourceTrust.actionChannelStatus = actionChannelStatus;
      payload.consequence.level = "low";
      releaseCriticalUpdateProtection(payload);
      payload.claims.push({
        id: "claim-action-required-unverified-001",
        kind: "action",
        text: "邮件要求学生回复课程办公室。",
        highImpact: true,
        factState: "confirmed",
        evidenceIds: ["evidence-body-audience-001"],
      });
      payload.mailActions.push({
        id: "action-required-unverified-001",
        origin: "mail",
        actor: "学生",
        action: "回复",
        object: "课程办公室",
        displayText: "回复课程办公室。",
        obligation: "mandatory",
        factState: "confirmed",
        condition: null,
        claimRefs: ["claim-action-required-unverified-001"],
      });

      expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);

      payload.homeSection = "priority_reading";
      expect(actionCardViewModelSchema.safeParse(payload).success).toBe(true);
    },
  );

  it("keeps an unmet conditional requirement out of other notifications", () => {
    const payload = cloneFixture();
    payload.homeSection = "other";
    payload.topics = ["other_school_affairs"];
    payload.consequence.level = "low";
    releaseCriticalUpdateProtection(payload);
    payload.claims.push({
      id: "claim-action-condition-unmet-001",
      kind: "action",
      text: "邮件要求满足条件的学生回复课程办公室。",
      highImpact: true,
      factState: "confirmed",
      evidenceIds: ["evidence-body-audience-001"],
    });
    payload.mailActions.push({
      id: "action-condition-unmet-001",
      origin: "mail",
      actor: "满足条件的学生",
      action: "回复",
      object: "课程办公室",
      displayText: "满足条件时回复课程办公室。",
      obligation: "conditional_mandatory",
      factState: "confirmed",
      condition: {
        text: "仅适用于满足指定条件的学生",
        status: "unmet",
        claimRefs: ["claim-action-condition-unmet-001"],
        conditionBasisRefs: ["basis-profile-course-001"],
      },
      claimRefs: ["claim-action-condition-unmet-001"],
    });

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);

    payload.homeSection = "priority_reading";
    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(true);
  });

  it("does not use an event end as a standalone calendar start", () => {
    const payload = createCalendarEligibleFixture();
    payload.dates[0]!.role = "event_end";

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("does not place an inapplicable user in action required", () => {
    const payload = createCalendarEligibleFixture();
    payload.relevance.scope = "not_applicable";

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("keeps a low-severity prompt injection out of other notifications", () => {
    const payload = cloneFixture();
    payload.homeSection = "other";
    payload.topics = ["other_school_affairs"];
    payload.relevance.scope = "schoolwide";
    payload.consequence.level = "low";
    releaseCriticalUpdateProtection(payload);
    payload.claims.push({
      id: "claim-risk-injection-001",
      kind: "risk",
      text: "正文包含要求模型忽略系统规则的文本。",
      highImpact: true,
      factState: "confirmed",
      evidenceIds: ["evidence-body-audience-001"],
    });
    payload.risks.push({
      id: "risk-injection-001",
      type: "prompt_injection",
      severity: "low",
      message: "检测到提示注入文本。",
      claimRefs: ["claim-risk-injection-001"],
    });

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("keeps a possible high consequence out of other notifications", () => {
    const payload = cloneFixture();
    payload.homeSection = "other";
    payload.topics = ["other_school_affairs"];
    payload.relevance.scope = "schoolwide";
    payload.consequence.level = "high";
    payload.consequence.factState = "possible";
    releaseCriticalUpdateProtection(payload);

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("keeps an unconfirmed high consequence out of other notifications", () => {
    const payload = cloneFixture();
    payload.homeSection = "other";
    payload.topics = ["other_school_affairs"];
    payload.relevance.scope = "schoolwide";
    payload.consequence.level = "high";
    payload.consequence.factState = "unconfirmed";
    releaseCriticalUpdateProtection(payload);

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("blocks calendar preview when any fail-closed risk remains", () => {
    const payload = createCalendarEligibleFixture();
    payload.homeSection = "priority_reading";
    payload.claims.push({
      id: "claim-risk-channel-001",
      kind: "risk",
      text: "行动渠道存在未解决风险。",
      highImpact: true,
      factState: "confirmed",
      evidenceIds: ["evidence-body-audience-001"],
    });
    payload.risks.push({
      id: "risk-channel-001",
      type: "credential_request",
      severity: "medium",
      message: "行动渠道风险尚未解决。",
      claimRefs: ["claim-risk-channel-001"],
    });

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("allows a current update to reference its previous version", () => {
    const payload = cloneFixture();
    payload.relation = {
      disposition: "update_existing",
      matchState: "confirmed",
      relatedItemId: "synthetic-item-000",
      explanation: "Harness 已确认它更新同一个合成事项。",
    };
    payload.states.updateKind = "material_update";
    payload.states.previousVersionId = "synthetic-version-000";

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(true);
  });

  it("requires a superseded version to point to its replacement", () => {
    const payload = cloneFixture();
    payload.states.version = "superseded";

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(false);
  });

  it("keeps overdue and user-completed states orthogonal", () => {
    const payload = cloneFixture();
    payload.states.due = "overdue";
    payload.states.management = "completed";

    expect(actionCardViewModelSchema.safeParse(payload).success).toBe(true);
  });

  it("keeps a running resource from carrying a card", () => {
    expect(
      actionCardResourceSchema.safeParse({
        status: "running",
        card: syntheticActionCardFixture,
        error: null,
      }).success,
    ).toBe(false);
  });
});
