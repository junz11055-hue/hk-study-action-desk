import {
  ActionCenterWorkspace,
  mockActionCardRepository,
} from "../../features/action-center";
import { demoSessionState } from "../../features/invite-access/server/demo-session";
import { isHostedDemoMode } from "../../features/invite-access/server/demo-mode";
import { ActionCenterScreen } from "../../features/action-center/ui/action-center-screen";
import { HostedDemoNotice } from "../../features/action-center/ui/hosted-demo-notice";
import { redirect } from "next/navigation";

type WorkspacePageProps = Readonly<{
  searchParams: Promise<{
    focus?: string | string[];
    notification?: string | string[];
    taskId?: string | string[];
  }>;
}>;

export default async function WorkspacePage({ searchParams }: WorkspacePageProps) {
  const [cards, query] = await Promise.all([
    mockActionCardRepository.list(),
    searchParams,
  ]);
  const selectedNotificationId = Array.isArray(query.notification)
    ? query.notification[0]
    : query.notification;
  const requestedFocusNotificationId = Array.isArray(query.focus)
    ? query.focus[0]
    : query.focus;
  const focusNotificationId =
    selectedNotificationId === undefined
      ? requestedFocusNotificationId
      : undefined;
  const taskId = Array.isArray(query.taskId) ? undefined : query.taskId;

  if (isHostedDemoMode()) {
    return (
      <ActionCenterScreen
        analysisSlot={<HostedDemoNotice />}
        cards={cards}
        {...(selectedNotificationId === undefined
          ? {}
          : { selectedNotificationId })}
        {...(focusNotificationId === undefined
          ? {}
          : { focusNotificationId })}
        showExitDemo={false}
        staticDemoOnly
      />
    );
  }

  const sessionState = await demoSessionState();
  if (sessionState !== "valid") {
    redirect(
      sessionState === "invalid" ? "/invite?reason=session-ended" : "/invite",
    );
  }

  return (
    <ActionCenterWorkspace
      staticCards={cards}
      {...(selectedNotificationId === undefined
        ? {}
        : { initialSelectedNotificationId: selectedNotificationId })}
      {...(focusNotificationId === undefined
        ? {}
        : { initialFocusNotificationId: focusNotificationId })}
      {...(taskId === undefined ? {} : { initialTaskId: taskId })}
    />
  );
}
