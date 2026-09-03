import {
  Bot,
  CircleAlert,
  FlaskConical,
  GraduationCap,
  ShieldAlert,
} from "lucide-react";
import type { ReadonlyDeep } from "../../../lib/types/readonly-deep";
import type { ActionCardViewModel } from "../model/action-card-view-model";

const sectionLabels = {
  action_required: "要处理",
  priority_reading: "优先阅读",
  other: "其他通知",
} as const;

const topicLabels = {
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

const provenanceLabels = {
  synthetic_mock: {
    source: "完全合成 / 工程 Mock",
    process: "未调用模型",
  },
  deepseek_verified: {
    source: "完全合成 / DeepSeek 已验证",
    process: "已通过 Harness 校验",
  },
  preset_synthetic_fallback: {
    source: "完全合成 / 预置降级",
    process: "模型结果不可用",
  },
  security_policy: {
    source: "完全合成 / 安全策略",
    process: "由确定性安全规则处理",
  },
} as const;

const suggestionLabels = {
  synthetic_mock: "模拟 AI 管理建议（非模型输出）",
  deepseek_verified: "AI 管理建议（已通过 Harness 校验）",
  preset_synthetic_fallback: "预置管理建议（非模型输出）",
  security_policy: "安全管理建议",
} as const;

const sourceTrustLabels = {
  official_verified: "来源已验证",
  unverified: "来源未验证",
  suspicious: "可疑来源",
  unknown: "来源状态未知",
} as const;

const actionChannelLabels = {
  verified: "行动渠道已验证",
  unverified: "行动渠道未验证",
  suspicious: "行动渠道可疑",
  not_required: "无需外部行动渠道",
  unknown: "行动渠道状态未知",
} as const;

type EngineeringBaselineCardProps = Readonly<{
  card: ReadonlyDeep<ActionCardViewModel>;
}>;

function MailActionCopy({
  actions,
  homeSection,
  hasUnconfirmedAction,
}: Readonly<{
  actions: ReadonlyDeep<ActionCardViewModel["mailActions"]>;
  homeSection: ActionCardViewModel["homeSection"];
  hasUnconfirmedAction: boolean;
}>) {
  const requiredActions = actions.filter(
    (action) =>
      homeSection === "action_required" &&
      action.factState === "confirmed" &&
      (action.obligation === "mandatory" ||
        (action.obligation === "conditional_mandatory" &&
          action.condition?.status === "met")),
  );
  const unresolvedRequiredActions = actions.filter(
    (action) =>
      (action.obligation === "mandatory" ||
        action.obligation === "conditional_mandatory") &&
      action.factState !== "not_applicable" &&
      !(
        action.obligation === "conditional_mandatory" &&
        action.condition?.status === "unmet"
      ) && !requiredActions.includes(action),
  );
  const unmetConditionalActions = actions.filter(
    (action) =>
      action.obligation === "conditional_mandatory" &&
      action.condition?.status === "unmet",
  );
  const confirmedAdvisoryActions = actions.filter(
    (action) =>
      (action.obligation === "recommended" ||
        action.obligation === "optional") &&
      action.factState === "confirmed",
  );
  const uncertainAdvisoryActions = actions.filter(
    (action) =>
      (action.obligation === "recommended" ||
        action.obligation === "optional") &&
      (action.factState === "possible" ||
        action.factState === "unconfirmed"),
  );

  return (
    <div className="space-y-5">
      {requiredActions.length > 0 ? (
        <div className="space-y-2">
        <h3 className="font-semibold">你需要做什么</h3>
        <ul className="list-disc space-y-1 pl-5">
          {requiredActions.map((action) => (
            <li key={action.id}>{action.displayText}</li>
          ))}
        </ul>
        </div>
      ) : null}

      {unresolvedRequiredActions.length > 0 ? (
        <div className="space-y-2">
          <h3 className="font-semibold">尚不能确认你是否需要行动</h3>
          <p className="leading-7 opacity-75">
            邮件写有强制或条件强制要求，但当前适用性、来源或条件尚未全部通过校验。
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {unresolvedRequiredActions.map((action) => (
              <li key={action.id}>{action.displayText}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {unmetConditionalActions.length > 0 ? (
        <div className="space-y-2">
          <h3 className="font-semibold">以下条件强制行动目前不适用于你</h3>
          <ul className="list-disc space-y-1 pl-5">
            {unmetConditionalActions.map((action) => (
              <li key={action.id}>{action.displayText}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {requiredActions.length === 0 &&
      unresolvedRequiredActions.length === 0 &&
      unmetConditionalActions.length === 0 &&
      hasUnconfirmedAction ? (
        <div className="space-y-2">
          <h3 className="font-semibold">尚不能确认是否需要操作</h3>
          <p className="leading-7 opacity-75">
            邮件行动尚未提炼完整，请先查看下方不确定项，不能据此判断“无需操作”。
          </p>
        </div>
      ) : null}

      {requiredActions.length === 0 &&
      unresolvedRequiredActions.length === 0 &&
      unmetConditionalActions.length === 0 &&
      !hasUnconfirmedAction ? (
        <div className="space-y-2">
          <h3 className="font-semibold">
            {confirmedAdvisoryActions.length > 0
              ? "没有学校强制行动"
              : uncertainAdvisoryActions.length > 0
                ? "没有已确认的学校强制行动"
                : "无需操作，仅需知晓"}
          </h3>
          {confirmedAdvisoryActions.length === 0 &&
          uncertainAdvisoryActions.length === 0 ? (
            <p className="leading-7 opacity-75">
              邮件没有要求回复、提交或办理事项。
            </p>
          ) : null}
        </div>
      ) : null}

      {confirmedAdvisoryActions.length > 0 ? (
        <div className="space-y-2">
          <h3 className="font-semibold">邮件建议/可选行动</h3>
          <ul className="list-disc space-y-1 pl-5">
            {confirmedAdvisoryActions.map((action) => (
              <li key={action.id}>{action.displayText}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {uncertainAdvisoryActions.length > 0 ? (
        <div className="space-y-2">
          <h3 className="font-semibold">尚未确认的邮件建议/可选行动</h3>
          <ul className="list-disc space-y-1 pl-5">
            {uncertainAdvisoryActions.map((action) => (
              <li key={action.id}>
                <span className="font-medium">
                  {action.factState === "possible" ? "可能：" : "尚未确认："}
                </span>
                {action.displayText}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function EngineeringBaselineCard({
  card,
}: EngineeringBaselineCardProps) {
  const provenanceLabel = provenanceLabels[card.provenance.sourceMode];
  const hasSecurityAlert =
    card.risks.length > 0 ||
    card.sourceTrust.sourceStatus === "suspicious" ||
    card.sourceTrust.actionChannelStatus === "suspicious";
  const confirmedDateCount = card.dates.filter(
    (date) => date.factState === "confirmed" && date.normalized !== null,
  ).length;
  const dateStatusLabel =
    confirmedDateCount > 0 && confirmedDateCount < card.dates.length
      ? "含已确认与待确认时间"
      : confirmedDateCount > 0
        ? "时间已确认"
        : card.dates.length > 0
          ? "时间待确认"
          : "未写明日期";

  return (
    <article className="space-y-7 border border-current/20 p-5 sm:p-7">
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-current/20 pb-5 text-sm"
        aria-label="数据来源声明"
      >
        <span className="inline-flex items-center gap-2 font-semibold">
          <FlaskConical aria-hidden="true" size={18} />
          {provenanceLabel.source}
        </span>
        <span className="opacity-70">{provenanceLabel.process}</span>
        <span className="opacity-70">未连接邮箱或日历</span>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="border border-current/30 px-2.5 py-1 font-medium">
            {sectionLabels[card.homeSection]}
          </span>
          {card.topics.slice(0, 1).map((topic) => (
            <span className="border border-current/20 px-2.5 py-1" key={topic}>
              {topicLabels[topic]}
            </span>
          ))}
          <span className="border border-current/20 px-2.5 py-1">
            {dateStatusLabel}
          </span>
        </div>

        <div className="space-y-2">
          <p className="text-sm opacity-70">
            {card.notification.schoolName} · {card.notification.senderName}
          </p>
          <h2 className="text-2xl font-semibold tracking-tight">{card.title}</h2>
          <p className="leading-7">{card.summary}</p>
        </div>
      </div>

      <section className="space-y-2" aria-labelledby="placement-heading">
        <h3
          className="inline-flex items-center gap-2 font-semibold"
          id="placement-heading"
        >
          <GraduationCap aria-hidden="true" size={19} />
          为什么放在这里
        </h3>
        <p className="leading-7 opacity-80">{card.homeSectionExplanation}</p>
      </section>

      <section
        className="space-y-3 border border-current/25 p-4"
        aria-labelledby="source-safety-heading"
        {...(hasSecurityAlert ? { role: "alert" as const } : {})}
      >
        <h3
          className="inline-flex items-center gap-2 font-semibold"
          id="source-safety-heading"
        >
          <ShieldAlert aria-hidden="true" size={19} />
          来源与安全
        </h3>
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="border border-current/25 px-2.5 py-1 font-medium">
            {sourceTrustLabels[card.sourceTrust.sourceStatus]}
          </span>
          <span className="border border-current/25 px-2.5 py-1">
            {actionChannelLabels[card.sourceTrust.actionChannelStatus]}
          </span>
        </div>
        <p className="leading-7 opacity-80">{card.sourceTrust.reason}</p>
        {card.risks.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5">
            {card.risks.map((risk) => (
              <li key={risk.id}>{risk.message}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-label="邮件行动">
        <MailActionCopy
          actions={card.mailActions}
          homeSection={card.homeSection}
          hasUnconfirmedAction={
            card.unknowns.some((unknown) => unknown.field === "action") ||
            card.informationCompleteness.gaps.some((gap) =>
              ["attachment_unparsed", "conflict", "evidence_missing"].includes(
                gap,
              ),
            )
          }
        />
      </section>

      {card.managementSuggestions.length > 0 ? (
        <section className="space-y-3" aria-labelledby="suggestion-heading">
          <h3
            className="inline-flex items-center gap-2 font-semibold"
            id="suggestion-heading"
          >
            <Bot aria-hidden="true" size={19} />
            {suggestionLabels[card.provenance.sourceMode]}
          </h3>
          <ul className="space-y-3">
            {card.managementSuggestions.map((suggestion) => (
              <li className="border-l-2 border-current/30 pl-4" key={suggestion.id}>
                <p>{suggestion.text}</p>
                <p className="mt-1 text-sm opacity-70">{suggestion.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {card.unknowns.length > 0 ? (
        <section className="space-y-3" aria-labelledby="unknown-heading">
          <h3
            className="inline-flex items-center gap-2 font-semibold"
            id="unknown-heading"
          >
            <CircleAlert aria-hidden="true" size={19} />
            仍不确定
          </h3>
          <ul className="list-disc space-y-1 pl-5 opacity-80">
            {card.unknowns.map((unknown) => (
              <li key={`${unknown.field}:${unknown.message}`}>{unknown.message}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="border-t border-current/20 pt-5 text-xs leading-5 opacity-65">
        <p>{card.provenance.disclosure}</p>
        <p>
          合同 {card.contractVersion} · 策略 {card.capabilityBinding.harnessPolicyVersion}
        </p>
      </footer>
    </article>
  );
}
