import Link from "next/link";
import type { ReactNode } from "react";
import {
  CircleAlert,
  Flag,
  Inbox,
  ShieldAlert,
} from "lucide-react";
import {
  formatCardDate,
  importancePresentationLabels,
  primaryDate,
  sectionDescriptions,
  sectionLabels,
  sourceTrustLabels,
  topicLabels,
  type ActionCard,
} from "./presentation";
import { workspaceHref } from "../model/workspace-url";

const sectionOrder = [
  "action_required",
  "priority_reading",
  "other",
] as const;

type NotificationRailProps = Readonly<{
  cards: readonly ActionCard[];
  selectedId: string | null;
  currentId: string | null;
  mobileDetailOpen: boolean;
  analysisResultId?: string;
  analysisSlot?: ReactNode;
  staticDemoOnly?: boolean;
  taskId?: string;
}>;

function NotificationItem({
  card,
  current,
  isAnalysisResult,
  selected,
  taskId,
}: Readonly<{
  card: ActionCard;
  current: boolean;
  isAnalysisResult: boolean;
  selected: boolean;
  taskId?: string;
}>) {
  const date = formatCardDate(primaryDate(card));
  const importance = importancePresentationLabels(card);
  const hasSafetyRisk =
    card.risks.length > 0 ||
    card.sourceTrust.sourceStatus === "suspicious" ||
    card.sourceTrust.actionChannelStatus === "suspicious";

  return (
    <li>
      <Link
        aria-current={current ? "page" : undefined}
        className={`notification-item notification-item--${card.homeSection}`}
        data-selected={selected ? "true" : undefined}
        href={workspaceHref({
          notificationId: card.notification.id,
          ...(taskId === undefined ? {} : { taskId }),
        })}
        id={`notification-${card.notification.id}`}
      >
        <span className="notification-route" aria-hidden="true">
          <span className="notification-route__node" />
        </span>
        <span className="notification-item__content">
          <span className="notification-item__meta">
            <span>{topicLabels[card.topics[0] ?? "other_school_affairs"]}</span>
            {isAnalysisResult ? (
              <span className="analysis-result-label">本次联调结果</span>
            ) : null}
            {card.states.read === "unread" ? (
              <span className="unread-label">
                <span className="unread-label__dot" aria-hidden="true" />
                未读
              </span>
            ) : (
              <span>已读</span>
            )}
          </span>
          <span className="notification-item__title">{card.title}</span>
          <span className="notification-item__summary">{card.summary}</span>
          <span className="notification-item__time">
            {date.machineValue === null ? (
              date.value
            ) : (
              <time dateTime={date.machineValue}>{date.value}</time>
            )}
          </span>
          <span className="notification-item__signals">
            {hasSafetyRisk ? (
              <span className="signal-label signal-label--risk">
                <ShieldAlert aria-hidden="true" size={14} />
                安全提醒
              </span>
            ) : null}
            {importance.slice(0, 1).map((label) => (
              <span className="signal-label" key={label}>
                <Flag aria-hidden="true" size={14} />
                {label}
              </span>
            ))}
            {card.sourceTrust.sourceStatus === "unverified" ? (
              <span className="signal-label signal-label--unknown">
                <CircleAlert aria-hidden="true" size={14} />
                {sourceTrustLabels.unverified}
              </span>
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function NotificationRail({
  cards,
  currentId,
  selectedId,
  mobileDetailOpen,
  analysisResultId,
  analysisSlot,
  staticDemoOnly = false,
  taskId,
}: NotificationRailProps) {
  const priorityCount = cards.filter(
    (card) => card.homeSection !== "other",
  ).length;
  const analysisCard =
    analysisResultId === undefined
      ? undefined
      : cards.find((card) => card.notification.id === analysisResultId);
  const fixtureCards =
    analysisResultId === undefined
      ? cards
      : cards.filter((card) => card.notification.id !== analysisResultId);

  return (
    <section
      aria-labelledby="notification-heading"
      className={`notification-panel${mobileDetailOpen ? " notification-panel--mobile-hidden" : ""}`}
    >
      <header className="notification-panel__header">
        <div className="notification-panel__eyebrow">
          <Inbox aria-hidden="true" size={17} />
          通知中心
        </div>
        <h1 id="notification-heading">今天先看 {priorityCount} 件事</h1>
        <p>按行动与风险分区，不使用不透明 AI 总分。</p>
      </header>

      <div className="synthetic-strip" role="note">
        <span>完全合成数据</span>
        <span aria-hidden="true">·</span>
        <span>未接邮箱</span>
        <span aria-hidden="true">·</span>
        <span>未接日历</span>
      </div>

      {analysisSlot}

      {analysisCard === undefined ? null : (
        <section
          aria-labelledby="analysis-result-heading"
          className="analysis-result-group"
        >
          <header className="notification-group__header">
            <div>
              <h2 id="analysis-result-heading">本次联调结果</h2>
              <p>
                {sectionLabels[analysisCard.homeSection]} · 由当前任务生成，非固定样本
              </p>
            </div>
            <span aria-label="1 条联调结果">1</span>
          </header>
          <ul className="notification-list">
            <NotificationItem
              card={analysisCard}
              current={analysisCard.notification.id === currentId}
              isAnalysisResult
              selected={analysisCard.notification.id === selectedId}
              {...(taskId === undefined ? {} : { taskId })}
            />
          </ul>
        </section>
      )}

      <div className="fixture-heading">
        <h2>{staticDemoOnly ? "演示通知" : "固定演示样本"}</h2>
        <p>
          {staticDemoOnly
            ? "四张合成卡覆盖缴费、课程、安全与校园生活"
            : "四张静态合成卡不会替代 DEV001 联调结果"}
        </p>
      </div>

      <div className="notification-groups">
        {sectionOrder.map((section) => {
          const sectionCards = fixtureCards.filter(
            (card) => card.homeSection === section,
          );
          return (
            <section
              aria-labelledby={`section-${section}`}
              className="notification-group"
              key={section}
            >
              <header className="notification-group__header">
                <div>
                  <h2 id={`section-${section}`}>{sectionLabels[section]}</h2>
                  <p>{sectionDescriptions[section]}</p>
                </div>
                <span aria-label={`${sectionCards.length} 条通知`}>
                  {sectionCards.length}
                </span>
              </header>
              {sectionCards.length === 0 ? (
                <p className="notification-group__empty">当前没有通知</p>
              ) : (
                <ul className="notification-list">
                  {sectionCards.map((card) => (
                    <NotificationItem
                      card={card}
                      current={card.notification.id === currentId}
                      isAnalysisResult={
                        card.notification.id === analysisResultId
                      }
                      key={card.notification.id}
                      selected={card.notification.id === selectedId}
                      {...(taskId === undefined ? {} : { taskId })}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
