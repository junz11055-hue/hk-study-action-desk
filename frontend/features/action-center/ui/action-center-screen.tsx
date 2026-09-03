import type { ReactNode } from "react";
import { ActionDetailPanel } from "./action-detail-panel";
import { FocusTarget } from "./focus-target";
import { NotificationRail } from "./notification-rail";
import type { ActionCard } from "./presentation";
import { WorkspaceShell } from "./workspace-shell";

type ActionCenterScreenProps = Readonly<{
  cards: readonly ActionCard[];
  selectedNotificationId?: string;
  focusNotificationId?: string;
  analysisResultId?: string;
  analysisSlot?: ReactNode;
  staticDemoOnly?: boolean;
  focusRequestKey?: number;
  preferredFocusTargetId?: string | null;
  taskId?: string;
  onExitDemo?: () => void;
  showExitDemo?: boolean;
}>;

export function ActionCenterScreen({
  cards,
  focusNotificationId,
  selectedNotificationId,
  analysisResultId,
  analysisSlot,
  staticDemoOnly = false,
  focusRequestKey,
  preferredFocusTargetId,
  taskId,
  onExitDemo,
  showExitDemo = true,
}: ActionCenterScreenProps) {
  const selectedFromQuery =
    selectedNotificationId === undefined
      ? undefined
      : cards.find(
          (card) => card.notification.id === selectedNotificationId,
        );
  const selectedCard = selectedFromQuery ?? cards[0] ?? null;
  const selectedId = selectedCard?.notification.id ?? null;
  const currentId = selectedFromQuery?.notification.id ?? null;
  const validatedFocusNotificationId =
    focusNotificationId !== undefined &&
    cards.some((card) => card.notification.id === focusNotificationId)
      ? focusNotificationId
      : null;
  const focusTargetId =
    preferredFocusTargetId !== undefined
      ? preferredFocusTargetId
      : currentId !== null
        ? `detail-title-${currentId}`
        : validatedFocusNotificationId === null
          ? null
          : `notification-${validatedFocusNotificationId}`;
  const mobileDetailOpen = selectedFromQuery !== undefined;
  const academicCount = cards.filter((card) =>
    card.topics.includes("academic_course"),
  ).length;
  const protectedAffairsCount = cards.filter((card) =>
    card.topics.some((topic) =>
      [
        "payment_funding",
        "registration_status",
        "visa_identity",
        "exam_results",
        "account_security",
      ].includes(topic),
    ),
  ).length;
  const campusCount = cards.filter((card) =>
    card.topics.some((topic) =>
      ["campus_activity", "housing_campus_life"].includes(topic),
    ),
  ).length;

  return (
    <WorkspaceShell
      activeView="notifications"
      categoryCounts={{
        academic: academicCount,
        protectedAffairs: protectedAffairsCount,
        campus: campusCount,
      }}
      notificationCount={cards.length}
      onExitDemo={onExitDemo}
      showExitDemo={showExitDemo}
    >
      <FocusTarget
        targetId={focusTargetId}
        {...(focusRequestKey === undefined ? {} : { requestKey: focusRequestKey })}
      />
      <NotificationRail
        cards={cards}
        currentId={currentId}
        mobileDetailOpen={mobileDetailOpen}
        selectedId={selectedId}
        {...(analysisResultId === undefined ? {} : { analysisResultId })}
        {...(analysisSlot === undefined ? {} : { analysisSlot })}
        staticDemoOnly={staticDemoOnly}
        {...(taskId === undefined ? {} : { taskId })}
      />
      <ActionDetailPanel
        card={selectedCard}
        mobileDetailOpen={mobileDetailOpen}
        {...(taskId === undefined ? {} : { taskId })}
      />
    </WorkspaceShell>
  );
}
