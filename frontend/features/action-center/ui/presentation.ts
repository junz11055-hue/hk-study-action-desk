import { isActionBlockingRisk } from "../model/action-card-view-model";
import type { ActionCardAnyVersion } from "../model/action-card-view-model-v0.2";

export const sectionLabels = {
  action_required: "要处理",
  priority_reading: "优先阅读",
  other: "其他通知",
} as const;

export const sectionDescriptions = {
  action_required: "已确认、需要你完成的事项",
  priority_reading: "关键变化、专业相关或仍需核验",
  other: "一般活动与校务资讯",
} as const;

export const topicLabels = {
  academic_course: "专业与课程",
  payment_funding: "缴费与资助",
  registration_status: "注册与学籍",
  visa_identity: "签证与身份",
  exam_results: "考试与成绩",
  account_security: "账号安全",
  campus_activity: "校园活动",
  housing_campus_life: "住宿与校园生活",
  other_school_affairs: "其他校务资讯",
} as const;

export const sourceTrustLabels = {
  official_verified: "官方来源已验证",
  unverified: "来源未验证",
  suspicious: "可疑来源",
  unknown: "来源状态未知",
} as const;

export const actionChannelLabels = {
  verified: "行动渠道已验证",
  unverified: "行动渠道未验证",
  suspicious: "行动渠道可疑",
  not_required: "无需外部行动渠道",
  unknown: "行动渠道状态未知",
} as const;

export const provenanceLabels = {
  synthetic_mock: {
    compact: "工程 Mock",
    detail: "完全合成 · 未调用模型",
  },
  deepseek_verified: {
    compact: "DeepSeek 已验证",
    detail: "合成输入 · 已通过 Harness 校验",
  },
  preset_synthetic_fallback: {
    compact: "预置降级",
    detail: "合成输入 · 非模型输出",
  },
  security_policy: {
    compact: "安全策略",
    detail: "合成输入 · 确定性规则处理",
  },
} as const;

const provenanceV02Labels = {
  static_fixture: {
    compact: "固定工程样本",
    detail: "完全合成 · 静态前端夹具 · 未调用模型",
    suggestionHeading: "模拟 AI 管理建议",
  },
  synthetic_mock: {
    compact: "合成 Mock",
    detail: "未调用模型 · Harness 技术校验通过",
    suggestionHeading: "模拟 AI 管理建议",
  },
  captured_replay: {
    compact: "已捕获结果回放",
    detail: "不是本次实时调用 · Harness 技术校验通过",
    suggestionHeading: "AI 管理建议",
  },
  live_model: {
    compact: "本次 DeepSeek 生成",
    detail: "Harness 技术校验通过",
    suggestionHeading: "AI 管理建议",
  },
} as const;

export const nativeImportanceLabels = {
  sender_importance: "发件人标记重要",
  provider_importance: "邮箱标记重要",
  user_star: "你已星标",
} as const;

export const consequenceLabels = {
  high: "高后果",
  medium: "中等后果",
  low: "低后果",
  unknown: "后果未知",
} as const;

export const relevanceScopeLabels = {
  self: "与你本人相关",
  confirmed_course: "与你的已确认课程相关",
  program: "与你的培养项目相关",
  cohort: "与你的届别相关",
  faculty: "与你的院系相关",
  schoolwide: "面向全校",
  undetermined: "适用范围待确认",
  not_applicable: "当前不适用",
} as const;

export const factStateLabels = {
  confirmed: "已确认",
  possible: "可能",
  unconfirmed: "尚未确认",
  not_applicable: "不适用",
} as const;

const dateRoleLabels = {
  payment_deadline: "缴费截止",
  registration_deadline: "注册截止",
  submission_deadline: "提交截止",
  other_deadline: "截止时间",
  event_start: "开始时间",
  event_end: "结束时间",
  window_start: "开放时间",
  window_end: "关闭时间",
  effective_at: "生效时间",
} as const;

export type ActionCard = ActionCardAnyVersion;

export function provenancePresentation(card: ActionCard) {
  if (card.contractVersion === "action-card-view-model/v0.2") {
    return provenanceV02Labels[card.provenance.sourceMode];
  }

  return {
    ...provenanceLabels[card.provenance.sourceMode],
    suggestionHeading: "模拟 AI 管理建议",
  } as const;
}

export function importancePresentationLabels(card: ActionCard): string[] {
  return card.nativeImportanceSignals.flatMap((signal) => {
    if (signal.state === "present") {
      return [nativeImportanceLabels[signal.kind]];
    }
    if (signal.state === "unknown") {
      return [`${nativeImportanceLabels[signal.kind]}状态未知`];
    }
    return [];
  });
}

export function deriveActionPresentation(card: ActionCard) {
  const requiredActions = card.mailActions.filter(
    (action) =>
      card.homeSection === "action_required" &&
      action.factState === "confirmed" &&
      (action.obligation === "mandatory" ||
        (action.obligation === "conditional_mandatory" &&
          action.condition?.status === "met")),
  );
  const unmetConditionalActions = card.mailActions.filter(
    (action) =>
      action.obligation === "conditional_mandatory" &&
      action.factState !== "not_applicable" &&
      action.condition?.status === "unmet",
  );
  const unresolvedRequiredActions = card.mailActions.filter(
    (action) =>
      (action.obligation === "mandatory" ||
        action.obligation === "conditional_mandatory") &&
      action.factState !== "not_applicable" &&
      !unmetConditionalActions.includes(action) &&
      !requiredActions.includes(action),
  );
  const confirmedAdvisoryActions = card.mailActions.filter(
    (action) =>
      (action.obligation === "recommended" ||
        action.obligation === "optional") &&
      action.factState === "confirmed",
  );
  const uncertainAdvisoryActions = card.mailActions.filter(
    (action) =>
      (action.obligation === "recommended" ||
        action.obligation === "optional") &&
      (action.factState === "possible" ||
        action.factState === "unconfirmed"),
  );
  const blockingRisks = card.risks.filter(isActionBlockingRisk);
  const nonBlockingRisks = card.risks.filter(
    (risk) => !isActionBlockingRisk(risk),
  );
  const hasBlockingSafety =
    card.sourceTrust.sourceStatus === "suspicious" ||
    card.sourceTrust.actionChannelStatus === "suspicious" ||
    blockingRisks.length > 0;
  const hasUnconfirmedAction =
    card.unknowns.some((unknown) => unknown.field === "action") ||
    card.informationCompleteness.gaps.some((gap) =>
      ["attachment_unparsed", "conflict", "evidence_missing"].includes(gap),
    );

  return {
    requiredActions,
    unresolvedRequiredActions,
    unmetConditionalActions,
    confirmedAdvisoryActions,
    uncertainAdvisoryActions,
    blockingRisks,
    nonBlockingRisks,
    hasBlockingSafety,
    hasUnconfirmedAction,
  } as const;
}

export function primaryDate(card: ActionCard) {
  const deadlineRoles = new Set([
    "payment_deadline",
    "registration_deadline",
    "submission_deadline",
    "other_deadline",
    "window_end",
  ]);

  return (
    card.dates.find(
      (date) =>
        date.factState === "confirmed" &&
        date.normalized !== null &&
        deadlineRoles.has(date.role),
    ) ??
    card.dates.find(
      (date) => date.factState === "confirmed" && date.normalized !== null,
    ) ??
    card.dates[0] ??
    null
  );
}

export function formatCardDate(
  date: ActionCard["dates"][number] | null,
): Readonly<{ eyebrow: string; value: string; machineValue: string | null }> {
  if (date === null) {
    return { eyebrow: "时间", value: "邮件未写明可靠时间", machineValue: null };
  }

  const eyebrow = dateRoleLabels[date.role];
  if (date.factState !== "confirmed" || date.normalized === null) {
    return { eyebrow, value: "时间仍待确认", machineValue: null };
  }

  const machineValue = date.normalized.value;
  const parsed =
    date.normalized.kind === "date_time"
      ? new Date(machineValue)
      : new Date(`${machineValue}T00:00:00+08:00`);
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Hong_Kong",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    ...(date.normalized.kind === "date_time"
      ? { hour: "2-digit", minute: "2-digit", hour12: false }
      : {}),
  });

  return {
    eyebrow,
    value: `${formatter.format(parsed)} · 香港时间`,
    machineValue,
  };
}

export function actionDecision(card: ActionCard): Readonly<{
  title: string;
  description: string;
  tone: "action" | "safe" | "reading" | "quiet";
}> {
  const presentation = deriveActionPresentation(card);

  if (presentation.hasBlockingSafety) {
    return {
      title: "先不要按邮件操作",
      description: "来源或行动渠道存在安全风险，请先查看安全提醒。",
      tone: "safe",
    };
  }

  if (presentation.requiredActions.length > 0) {
    return {
      title: presentation.requiredActions[0]?.displayText ?? "需要你处理",
      description: "该行动已通过适用性、来源、渠道与证据校验。",
      tone: "action",
    };
  }

  if (presentation.unresolvedRequiredActions.length > 0) {
    return {
      title: "先阅读，行动仍待核验",
      description: "邮件写有强制要求，但还没有通过全部安全门。",
      tone: "reading",
    };
  }

  if (presentation.hasUnconfirmedAction) {
    return {
      title: "是否要做仍待确认",
      description: "邮件正文、附件或证据仍有缺口，不能判断为无需操作。",
      tone: "reading",
    };
  }

  if (presentation.unmetConditionalActions.length > 0) {
    return {
      title: "条件目前不满足，无需执行该行动",
      description: "条件状态已有确认依据；如果个人情况改变，需要重新判断。",
      tone: "quiet",
    };
  }

  if (card.homeSection === "priority_reading") {
    return {
      title: "没有学校强制行动，但需要优先知道",
      description: "这是关键变化、专业相关信息或受保护的重要通知。",
      tone: "reading",
    };
  }

  return {
    title: "无需操作，按需查看",
    description: "这是一条一般资讯，没有已确认的强制行动。",
    tone: "quiet",
  };
}

export function eligibleCalendarDates(card: ActionCard) {
  if (card.capabilities.previewCalendar.state !== "allowed") {
    return [];
  }

  const eligibleIds = new Set(
    card.capabilities.previewCalendar.eligibleDateIds,
  );
  return card.dates.filter(
    (date) => date.calendarEligibility.eligible && eligibleIds.has(date.id),
  );
}

export function evidenceLocationLabel(
  evidence: ActionCard["evidence"][number],
): string {
  if (evidence.location.kind === "subject") {
    return "邮件主题";
  }
  if (evidence.location.kind === "attachment") {
    return `${evidence.location.attachmentLabel} · 第 ${evidence.location.page} 页`;
  }
  return evidence.location.paragraph === undefined
    ? "邮件正文"
    : `邮件正文 · 第 ${evidence.location.paragraph} 段`;
}
