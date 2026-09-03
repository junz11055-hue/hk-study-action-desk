import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  CalendarDays,
  CircleAlert,
  Clock3,
  FileText,
  GraduationCap,
  ListChecks,
  Mail,
  Quote,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import {
  actionChannelLabels,
  actionDecision,
  consequenceLabels,
  deriveActionPresentation,
  eligibleCalendarDates,
  evidenceLocationLabel,
  factStateLabels,
  formatCardDate,
  importancePresentationLabels,
  primaryDate,
  provenancePresentation,
  relevanceScopeLabels,
  sectionLabels,
  sourceTrustLabels,
  topicLabels,
  type ActionCard,
} from "./presentation";
import { workspaceHref } from "../model/workspace-url";
import { EvidenceDisclosureLink } from "./focus-target";
import { ManagedToggle } from "./managed-toggle";

type ActionDetailPanelProps = Readonly<{
  card: ActionCard | null;
  mobileDetailOpen: boolean;
  taskId?: string;
}>;

function ActionTrack({ card }: Readonly<{ card: ActionCard }>) {
  const date = formatCardDate(primaryDate(card));
  const calendarDates = eligibleCalendarDates(card);
  const provenance = provenancePresentation(card);

  const steps = [
    {
      id: "received",
      icon: Mail,
      label: "收到通知",
      detail: new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Hong_Kong",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(card.notification.receivedAt)),
      state: "complete",
    },
    {
      id: "analysis",
      icon: Sparkles,
      label: "AI 梳理",
      detail: provenance.compact,
      state: card.provenance.sourceMode === "synthetic_mock" ? "mock" : "complete",
    },
    {
      id: "decision",
      icon: ListChecks,
      label: "当前分区",
      detail: sectionLabels[card.homeSection],
      state: card.homeSection === "action_required" ? "action" : "current",
    },
    {
      id: "calendar",
      icon: CalendarDays,
      label: "日历状态",
      detail:
        calendarDates.length > 0
          ? "可本地预览"
          : date.machineValue === null
            ? "没有可靠日期"
            : "当前不可生成预览",
      state: calendarDates.length > 0 ? "current" : "muted",
    },
  ] as const;

  return (
    <section className="action-track" aria-labelledby="action-track-heading">
      <div className="section-heading section-heading--compact">
        <span className="section-heading__icon" aria-hidden="true">
          <Sparkles size={17} />
        </span>
        <div>
          <h2 id="action-track-heading">行动轨</h2>
          <p>从收到邮件到可执行下一步</p>
        </div>
      </div>
      <ol className="action-track__list">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <li className="action-track__step" data-state={step.state} key={step.id}>
              <span className="action-track__connector" aria-hidden="true" />
              <span className="action-track__node" aria-hidden="true">
                <Icon size={15} />
              </span>
              <span className="action-track__copy">
                <span>{step.label}</span>
                <strong>{step.detail}</strong>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function SafetyAlert({ card }: Readonly<{ card: ActionCard }>) {
  const presentation = deriveActionPresentation(card);
  if (!presentation.hasBlockingSafety) {
    return null;
  }
  const hasSuspiciousChannel =
    card.sourceTrust.sourceStatus === "suspicious" ||
    card.sourceTrust.actionChannelStatus === "suspicious";

  return (
    <section className="safety-alert" role="alert" aria-labelledby="safety-alert-heading">
      <ShieldAlert aria-hidden="true" size={22} />
      <div>
        <h2 id="safety-alert-heading">先停一下：不要按邮件中的方式操作</h2>
        <ul>
          {hasSuspiciousChannel ? <li>{card.sourceTrust.reason}</li> : null}
          {presentation.blockingRisks.map((risk) => (
            <li key={risk.id}>{risk.message}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function MailActionSection({ card }: Readonly<{ card: ActionCard }>) {
  const presentation = deriveActionPresentation(card);
  const hasKnownRequiredState =
    presentation.requiredActions.length > 0 ||
    presentation.unresolvedRequiredActions.length > 0 ||
    presentation.unmetConditionalActions.length > 0;

  return (
    <section className="detail-section" aria-labelledby="mail-action-heading">
      <div className="section-heading">
        <span className="section-heading__icon" aria-hidden="true">
          <ListChecks size={18} />
        </span>
        <div>
          <h2 id="mail-action-heading">邮件要求</h2>
          <p>只展示邮件事实，不混入 AI 管理建议</p>
        </div>
      </div>

      {presentation.hasBlockingSafety ? (
        <div className="action-copy action-copy--risk">
          <h3>
            {hasKnownRequiredState
              ? "邮件虽然写了强制操作，但当前不能安全执行"
              : "当前不能安全确认是否需要操作"}
          </h3>
          <p>请先通过学校官方入口独立核验，不要使用邮件内的链接或页面。</p>
        </div>
      ) : null}

      {!presentation.hasBlockingSafety &&
      presentation.requiredActions.length > 0 ? (
        <div className="action-copy action-copy--required">
          <h3>你需要做什么</h3>
          <ul>
            {presentation.requiredActions.map((action) => (
              <li key={action.id}>{action.displayText}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!presentation.hasBlockingSafety &&
      presentation.unresolvedRequiredActions.length > 0 ? (
        <div className="action-copy action-copy--uncertain">
          <h3>尚不能确认你是否需要行动</h3>
          <p>邮件写有强制要求，但适用性、来源、条件或证据尚未全部通过校验。</p>
          <ul>
            {presentation.unresolvedRequiredActions.map((action) => (
              <li key={action.id}>{action.displayText}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!presentation.hasBlockingSafety &&
      presentation.unmetConditionalActions.length > 0 ? (
        <div className="action-copy action-copy--quiet">
          <h3>以下条件强制行动目前不适用于你</h3>
          <ul>
            {presentation.unmetConditionalActions.map((action) => (
              <li key={action.id}>{action.displayText}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!presentation.hasBlockingSafety &&
      !hasKnownRequiredState &&
      presentation.hasUnconfirmedAction ? (
        <div className="action-copy action-copy--uncertain">
          <h3>尚不能确认是否需要操作</h3>
          <p>邮件行动尚未提炼完整，请先查看下方不确定项，不能据此判断“无需操作”。</p>
        </div>
      ) : null}

      {!presentation.hasBlockingSafety &&
      !hasKnownRequiredState &&
      !presentation.hasUnconfirmedAction ? (
        <div className="action-copy action-copy--quiet">
          <h3>
            {presentation.confirmedAdvisoryActions.length > 0
              ? "没有学校强制行动"
              : presentation.uncertainAdvisoryActions.length > 0
                ? "没有已确认的学校强制行动"
                : "无需操作，仅需知晓"}
          </h3>
          {presentation.confirmedAdvisoryActions.length === 0 &&
          presentation.uncertainAdvisoryActions.length === 0 ? (
            <p>当前没有已确认、适用于你的学校强制行动。</p>
          ) : null}
        </div>
      ) : null}

      {presentation.confirmedAdvisoryActions.length > 0 ? (
        <div className="advisory-actions">
          <h3>邮件建议/可选行动</h3>
          <ul>
            {presentation.confirmedAdvisoryActions.map((action) => (
              <li key={action.id}>
                {action.displayText}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {presentation.uncertainAdvisoryActions.length > 0 ? (
        <div className="advisory-actions">
          <h3>尚未确认的邮件建议/可选行动</h3>
          <ul>
            {presentation.uncertainAdvisoryActions.map((action) => (
              <li key={action.id}>
                <span>{factStateLabels[action.factState]}</span>
                {action.displayText}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function CalendarPreview({ card }: Readonly<{ card: ActionCard }>) {
  const dates = eligibleCalendarDates(card);
  if (dates.length === 0) {
    return (
      <p className="calendar-unavailable">
        <CalendarDays aria-hidden="true" size={17} />
        {card.capabilities.previewCalendar.message ?? "当前不能生成可靠的日历预览。"}
      </p>
    );
  }

  return (
    <details className="calendar-preview">
      <summary>
        <CalendarDays aria-hidden="true" size={17} />
        预览日历事件
      </summary>
      <div className="calendar-preview__body">
        <p className="calendar-preview__notice">只在本页预览，未写入任何真实日历。</p>
        {dates.map((date) => {
          const formatted = formatCardDate(date);
          return (
            <div className="calendar-preview__event" key={date.id}>
              <span>{formatted.eyebrow}</span>
              <strong>{card.title}</strong>
              {formatted.machineValue === null ? (
                <p>{formatted.value}</p>
              ) : (
                <time dateTime={formatted.machineValue}>{formatted.value}</time>
              )}
              <small>Asia/Hong_Kong</small>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function EvidencePanel({ card }: Readonly<{ card: ActionCard }>) {
  return (
    <section className="detail-section" id="evidence-panel" aria-labelledby="evidence-heading">
      <details className="evidence-details" id="evidence-disclosure">
        <summary>
          <span className="section-heading section-heading--summary">
            <span className="section-heading__icon" aria-hidden="true">
              <Quote size={18} />
            </span>
            <span>
              <h2 id="evidence-heading">查看原文证据</h2>
              <small>{card.evidence.length} 条摘录 · 不是完整邮件原文</small>
            </span>
          </span>
        </summary>
        <ol className="evidence-list">
          {card.claims.map((claim) => {
            const evidenceItems = claim.evidenceIds
              .map((evidenceId) =>
                card.evidence.find((evidence) => evidence.id === evidenceId),
              )
              .filter((evidence) => evidence !== undefined);
            return (
              <li key={claim.id}>
                <div className="evidence-list__claim">
                  <span>{factStateLabels[claim.factState]}</span>
                  <strong>{claim.text}</strong>
                </div>
                {evidenceItems.map((evidence) => (
                  <blockquote key={`${claim.id}:${evidence.id}`}>
                    <p>“{evidence.quote}”</p>
                    <cite>{evidenceLocationLabel(evidence)}</cite>
                  </blockquote>
                ))}
              </li>
            );
          })}
        </ol>
      </details>
    </section>
  );
}

export function ActionDetailPanel({
  card,
  mobileDetailOpen,
  taskId,
}: ActionDetailPanelProps) {
  if (card === null) {
    return (
      <article className="detail-panel detail-panel--empty">
        <FileText aria-hidden="true" size={28} />
        <h2>当前没有合成通知</h2>
        <p>加入通过合同校验的合成 ViewModel 后，通知会显示在这里。</p>
      </article>
    );
  }

  const decision = actionDecision(card);
  const actionPresentation = deriveActionPresentation(card);
  const date = formatCardDate(primaryDate(card));
  const importanceLabels = importancePresentationLabels(card);
  const provenance = provenancePresentation(card);
  const detailHeadingId = `detail-title-${card.notification.id}`;
  const returnHref = workspaceHref({
    focusNotificationId: card.notification.id,
    ...(taskId === undefined ? {} : { taskId }),
  });

  return (
    <article
      aria-labelledby={detailHeadingId}
      className={`detail-panel${mobileDetailOpen ? " detail-panel--mobile-open" : ""}`}
    >
      <Link className="mobile-back-link" href={returnHref}>
        <ArrowLeft aria-hidden="true" size={18} />
        返回通知列表
      </Link>

      <header className="detail-hero">
        <div className="detail-hero__labels">
          <span className={`section-badge section-badge--${card.homeSection}`}>
            {sectionLabels[card.homeSection]}
          </span>
          {card.topics.slice(0, 3).map((topic) => (
            <span className="topic-badge" key={topic}>
              {topicLabels[topic]}
            </span>
          ))}
          {importanceLabels.map((label) => (
            <span className="importance-badge" key={label}>
              {label}
            </span>
          ))}
        </div>
        <p className="detail-hero__sender">
          {card.notification.schoolName} · {card.notification.senderName}
        </p>
        <h1 id={detailHeadingId} tabIndex={-1}>
          {card.title}
        </h1>
        <p className="detail-hero__summary">{card.summary}</p>
      </header>

      <section className="decision-grid" aria-label="30 秒行动判断">
        <div className={`decision-card decision-card--${decision.tone}`}>
          <span>是否要做</span>
          <strong>{decision.title}</strong>
          <p>{decision.description}</p>
        </div>
        <div className="decision-card">
          <span>{date.eyebrow}</span>
          <strong>
            {date.machineValue === null ? (
              date.value
            ) : (
              <time dateTime={date.machineValue}>{date.value}</time>
            )}
          </strong>
          <p>
            {factStateLabels[card.consequence.factState]} · {consequenceLabels[card.consequence.level]}：
            {card.consequence.reason}
          </p>
        </div>
        <div className="decision-card decision-card--relevance">
          <span>为什么与你相关</span>
          <strong>
            {factStateLabels[card.relevance.factState]} · {relevanceScopeLabels[card.relevance.scope]}
          </strong>
          <p>{card.relevance.explanation}</p>
        </div>
      </section>

      <SafetyAlert card={card} />
      <ActionTrack card={card} />

      <div className="detail-actions" role="group" aria-label="可用操作">
        {card.capabilities.viewEvidence.state === "allowed" ? (
          <EvidenceDisclosureLink
            detailsId="evidence-disclosure"
            href="#evidence-panel"
          >
            <FileText aria-hidden="true" size={17} />
            查看证据
          </EvidenceDisclosureLink>
        ) : (
          <span aria-disabled="true">
            <FileText aria-hidden="true" size={17} />
            证据暂不可用
          </span>
        )}
        <CalendarPreview card={card} />
        <ManagedToggle id={card.notification.id} kind="notification" />
      </div>

      <MailActionSection card={card} />

      {card.managementSuggestions.length > 0 ? (
        <section className="ai-suggestion" aria-labelledby="ai-suggestion-heading">
          <div className="section-heading">
            <span className="section-heading__icon" aria-hidden="true">
              <Bot size={18} />
            </span>
            <div>
              <h2 id="ai-suggestion-heading">{provenance.suggestionHeading}</h2>
              <p>{provenance.detail} · 不属于学校要求</p>
            </div>
          </div>
          <ul>
            {card.managementSuggestions.map((suggestion) => (
              <li key={suggestion.id}>
                <strong>{suggestion.text}</strong>
                <span>{suggestion.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="detail-section" aria-labelledby="trust-heading">
        <div className="section-heading">
          <span className="section-heading__icon" aria-hidden="true">
            <GraduationCap size={18} />
          </span>
          <div>
            <h2 id="trust-heading">来源、重要标记与安全</h2>
            <p>三种信号分别展示，不互相冒充</p>
          </div>
        </div>
        <div className="trust-grid">
          <div>
            <span>邮件来源</span>
            <strong>{sourceTrustLabels[card.sourceTrust.sourceStatus]}</strong>
          </div>
          <div>
            <span>行动渠道</span>
            <strong>{actionChannelLabels[card.sourceTrust.actionChannelStatus]}</strong>
          </div>
          <div>
            <span>内容完整度</span>
            <strong>
              {card.informationCompleteness.status === "complete"
                ? "当前内容完整"
                : "内容仍有缺口"}
            </strong>
          </div>
        </div>
        <p className="trust-reason">{card.sourceTrust.reason}</p>
        {actionPresentation.nonBlockingRisks.length > 0 ? (
          <div className="nonblocking-risks">
            <h3>其他风险提示（不等于禁止行动）</h3>
            <ul>
              {actionPresentation.nonBlockingRisks.map((risk) => (
                <li key={risk.id}>{risk.message}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {card.unknowns.length > 0 ? (
        <section className="unknown-panel" aria-labelledby="unknown-heading">
          <div className="section-heading section-heading--compact">
            <span className="section-heading__icon" aria-hidden="true">
              <CircleAlert size={18} />
            </span>
            <div>
              <h2 id="unknown-heading">仍不确定</h2>
              <p>这些缺口没有被 AI 猜成确定事实</p>
            </div>
          </div>
          <ul>
            {card.unknowns.map((unknown) => (
              <li key={`${unknown.field}:${unknown.message}`}>{unknown.message}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {card.capabilities.viewEvidence.state === "allowed" ? (
        <EvidencePanel card={card} />
      ) : null}

      <footer className="detail-footer">
        <div>
          <Clock3 aria-hidden="true" size={15} />
          <span>{card.provenance.disclosure}</span>
        </div>
        <p>
          合同 {card.contractVersion} · 策略 {card.capabilityBinding.harnessPolicyVersion}
        </p>
      </footer>
    </article>
  );
}
