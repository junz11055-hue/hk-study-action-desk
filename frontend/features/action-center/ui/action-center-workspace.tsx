"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  syntheticAnalysisTaskIdSchema,
  type SyntheticAnalysisTask,
} from "../model/synthetic-analysis-task";
import { workspaceHref } from "../model/workspace-url";
import {
  createSyntheticAnalysisTaskClient,
  SyntheticAnalysisClientError,
} from "../data/synthetic-analysis-task-client";
import {
  clearPendingSyntheticAnalysisSubmit,
  readPendingSyntheticAnalysisSubmit,
  rememberPendingSyntheticAnalysisSubmit,
} from "../data/pending-synthetic-analysis-submit";
import { ActionCenterScreen } from "./action-center-screen";
import {
  SyntheticAnalysisSlot,
  type SyntheticAnalysisSlotStatus,
  type SyntheticAnalysisTransportIssue,
} from "./synthetic-analysis-slot";
import type { ActionCard } from "./presentation";

type ActionCenterWorkspaceProps = Readonly<{
  staticCards: readonly ActionCard[];
  initialSelectedNotificationId?: string;
  initialFocusNotificationId?: string;
  initialTaskId?: string;
}>;

function validTaskId(value: string | undefined): string | null {
  const parsed = syntheticAnalysisTaskIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

type ActiveSyntheticAnalysisTask = SyntheticAnalysisTask &
  Readonly<{
    status: "queued" | "running";
    pollAfterMs: number;
  }>;

function activeTask(
  task: SyntheticAnalysisTask | null,
): task is ActiveSyntheticAnalysisTask {
  return (
    (task?.status === "queued" || task?.status === "running") &&
    task.pollAfterMs !== null
  );
}

function safeIssueMessage(error: unknown): string {
  return error instanceof SyntheticAnalysisClientError
    ? error.message
    : "本机分析服务暂时不可用。";
}

function retryableIssue(error: unknown): boolean {
  return (
    error instanceof SyntheticAnalysisClientError &&
    (error.kind === "transport" ||
      error.envelope?.error.retryable === true)
  );
}

function sessionExpired(error: unknown): boolean {
  return (
    error instanceof SyntheticAnalysisClientError && error.status === 401
  );
}

export function ActionCenterWorkspace({
  staticCards,
  initialSelectedNotificationId,
  initialFocusNotificationId,
  initialTaskId,
}: ActionCenterWorkspaceProps) {
  const router = useRouter();
  const client = useMemo(() => createSyntheticAnalysisTaskClient(), []);
  const normalizedInitialTaskId = validTaskId(initialTaskId);
  const [task, setTask] = useState<SyntheticAnalysisTask | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(
    normalizedInitialTaskId,
  );
  const [localStatus, setLocalStatus] = useState<"idle" | "submitting">(
    normalizedInitialTaskId === null ? "idle" : "submitting",
  );
  const [submittingIntent, setSubmittingIntent] = useState<
    "create" | "restore"
  >(normalizedInitialTaskId === null ? "create" : "restore");
  const [transportIssue, setTransportIssue] =
    useState<SyntheticAnalysisTransportIssue | null>(null);
  const [selectionOverride, setSelectionOverride] = useState<Readonly<{
    initialValue: string | undefined;
    value: string | undefined;
  }> | null>(null);
  const [focusOverride, setFocusOverride] = useState<Readonly<{
    initialSelection: string | undefined;
    targetId: string;
  }> | null>(null);
  const [focusRequestKey, setFocusRequestKey] = useState(0);
  const [pollCancelKey, setPollCancelKey] = useState(0);
  const submitLockRef = useRef(false);
  const submitKeyRef = useRef<string | null>(null);
  const recoveredSubmitAttemptedRef = useRef(false);
  const handledUrlTaskIdRef = useRef<string | null>(null);
  const taskRef = useRef<SyntheticAnalysisTask | null>(null);
  const pollingHaltedTaskIdRef = useRef<string | null>(null);
  const generationRef = useRef(0);

  const requestFocus = useCallback((targetId: string) => {
    setFocusOverride({
      initialSelection: initialSelectedNotificationId,
      targetId,
    });
    setFocusRequestKey((current) => current + 1);
  }, [initialSelectedNotificationId]);

  const moveToInvite = useCallback(() => {
    submitKeyRef.current = null;
    clearPendingSyntheticAnalysisSubmit();
    router.replace("/invite?reason=session-ended", { scroll: false });
  }, [router]);

  const abandonPendingSubmit = useCallback(() => {
    generationRef.current += 1;
    submitKeyRef.current = null;
    clearPendingSyntheticAnalysisSubmit();
  }, []);

  const acceptTask = useCallback(
    (
      nextTask: SyntheticAnalysisTask,
      options: Readonly<{ focusTerminal: boolean; updateUrl: boolean }>,
    ) => {
      taskRef.current = nextTask;
      submitKeyRef.current = null;
      clearPendingSyntheticAnalysisSubmit();
      pollingHaltedTaskIdRef.current = null;
      setTask(nextTask);
      setActiveTaskId(nextTask.taskId);
      setLocalStatus("idle");
      setTransportIssue(null);
      handledUrlTaskIdRef.current = nextTask.taskId;

      const resultId =
        nextTask.status === "succeeded" && nextTask.resource !== null
          ? nextTask.resource.card.notification.id
          : undefined;
      if (resultId !== undefined) {
        setSelectionOverride({
          initialValue: initialSelectedNotificationId,
          value: resultId,
        });
        if (options.focusTerminal) {
          requestFocus(`detail-title-${resultId}`);
        }
      } else if (
        options.focusTerminal &&
        (nextTask.status === "failed" || nextTask.status === "stale")
      ) {
        requestFocus("analysis-task-error");
      }

      if (options.updateUrl) {
        router.replace(
          workspaceHref({
            taskId: nextTask.taskId,
            ...(resultId === undefined ? {} : { notificationId: resultId }),
          }),
          { scroll: false },
        );
      }
    },
    [initialSelectedNotificationId, requestFocus, router],
  );

  useEffect(() => {
    const urlTaskId = validTaskId(initialTaskId);
    if (urlTaskId !== null) {
      submitKeyRef.current = null;
      clearPendingSyntheticAnalysisSubmit();
    }
    if (
      urlTaskId === null ||
      handledUrlTaskIdRef.current === urlTaskId
    ) {
      return;
    }

    handledUrlTaskIdRef.current = urlTaskId;
    const generation = ++generationRef.current;
    setActiveTaskId(urlTaskId);
    setTask(null);
    taskRef.current = null;
    pollingHaltedTaskIdRef.current = null;
    setLocalStatus("submitting");
    setSubmittingIntent("restore");
    setTransportIssue(null);
    const controller = new AbortController();

    void client
      .get(urlTaskId, controller.signal)
      .then((restoredTask) => {
        if (generationRef.current !== generation) return;
        acceptTask(restoredTask, {
          focusTerminal: false,
          updateUrl: false,
        });
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          generationRef.current !== generation
        ) {
          return;
        }
        if (sessionExpired(error)) {
          moveToInvite();
          return;
        }
        setLocalStatus("idle");
        setTransportIssue({
          message: safeIssueMessage(error),
          action: retryableIssue(error) ? "refresh_task" : "start_new",
        });
      });

    return () => controller.abort();
  }, [acceptTask, client, initialTaskId, moveToInvite]);

  const submitWithExistingKey = useCallback(async () => {
    const idempotencyKey = submitKeyRef.current;
    if (idempotencyKey === null || submitLockRef.current) return;

    submitLockRef.current = true;
    setLocalStatus("submitting");
    setSubmittingIntent("create");
    setTransportIssue(null);
    requestFocus("analysis-task-heading");
    const generation = generationRef.current;
    const controller = new AbortController();
    try {
      const submittedTask = await client.submit(
        idempotencyKey,
        controller.signal,
      );
      if (generationRef.current !== generation) return;
      submitKeyRef.current = null;
      acceptTask(submittedTask, {
        focusTerminal: true,
        updateUrl: true,
      });
    } catch (error) {
      if (generationRef.current !== generation) return;
      if (sessionExpired(error)) {
        moveToInvite();
        return;
      }
      setLocalStatus("idle");
      const retryable = retryableIssue(error);
      if (!retryable) {
        submitKeyRef.current = null;
        clearPendingSyntheticAnalysisSubmit();
      }
      setTransportIssue({
        message: retryable
          ? "尚不能确认任务是否已创建；继续时会复用同一个提交标识。"
          : safeIssueMessage(error),
        action: retryable ? "resume_submit" : "start_new",
      });
      requestFocus("analysis-task-heading");
    } finally {
      submitLockRef.current = false;
    }
  }, [acceptTask, client, moveToInvite, requestFocus]);

  useEffect(() => {
    if (
      initialTaskId !== undefined ||
      recoveredSubmitAttemptedRef.current
    ) {
      return;
    }
    recoveredSubmitAttemptedRef.current = true;
    const pendingKey = readPendingSyntheticAnalysisSubmit();
    if (pendingKey === null) return;

    submitKeyRef.current = pendingKey;
    generationRef.current += 1;
    void submitWithExistingKey();
  }, [initialTaskId, submitWithExistingKey]);

  const startTask = useCallback(() => {
    if (submitLockRef.current) return;
    recoveredSubmitAttemptedRef.current = true;
    generationRef.current += 1;
    const idempotencyKey = crypto.randomUUID();
    submitKeyRef.current = idempotencyKey;
    rememberPendingSyntheticAnalysisSubmit(idempotencyKey);
    setTask(null);
    taskRef.current = null;
    pollingHaltedTaskIdRef.current = null;
    setActiveTaskId(null);
    setSelectionOverride({
      initialValue: initialSelectedNotificationId,
      value: undefined,
    });
    setTransportIssue(null);
    router.replace("/workspace", { scroll: false });
    void submitWithExistingKey();
  }, [initialSelectedNotificationId, router, submitWithExistingKey]);

  const refreshExistingTask = useCallback(async () => {
    if (activeTaskId === null) return;

    const generation = ++generationRef.current;
    setPollCancelKey((current) => current + 1);
    const controller = new AbortController();
    if (taskRef.current === null) {
      setLocalStatus("submitting");
      setSubmittingIntent("restore");
    }
    setTransportIssue(null);
    try {
      const refreshedTask = await client.get(
        activeTaskId,
        controller.signal,
      );
      if (generationRef.current !== generation) return;
      acceptTask(refreshedTask, {
        focusTerminal: true,
        updateUrl: true,
      });
    } catch (error) {
      if (generationRef.current !== generation) return;
      if (sessionExpired(error)) {
        moveToInvite();
        return;
      }
      if (taskRef.current === null) setLocalStatus("idle");
      setTransportIssue({
        message: safeIssueMessage(error),
        action: retryableIssue(error) ? "refresh_task" : "start_new",
      });
    }
  }, [acceptTask, activeTaskId, client, moveToInvite]);

  useEffect(() => {
    const currentTask = taskRef.current;
    if (
      !activeTask(currentTask) ||
      pollingHaltedTaskIdRef.current === currentTask.taskId
    ) {
      return;
    }

    const controller = new AbortController();
    const generation = generationRef.current;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const interval = Math.min(
      5_000,
      Math.max(250, currentTask.pollAfterMs ?? 1_000),
    );

    const query = async () => {
      if (pollingHaltedTaskIdRef.current === currentTask.taskId) return;
      try {
        const refreshedTask = await client.get(
          currentTask.taskId,
          controller.signal,
        );
        if (generationRef.current !== generation) return;
        acceptTask(refreshedTask, {
          focusTerminal: true,
          updateUrl: true,
        });
      } catch (error) {
        if (
          controller.signal.aborted ||
          generationRef.current !== generation
        ) {
          return;
        }
        if (sessionExpired(error)) {
          moveToInvite();
          return;
        }
        const retryable = retryableIssue(error);
        setTransportIssue({
          message: retryable
            ? "任务查询暂时中断；保留原任务编号，不会重新提交。"
            : safeIssueMessage(error),
          action: retryable ? "refresh_task" : "start_new",
        });
        if (retryable) {
          timeoutId = setTimeout(() => void query(), 1_000);
        } else {
          pollingHaltedTaskIdRef.current = currentTask.taskId;
        }
      }
    };

    timeoutId = setTimeout(() => void query(), interval);
    return () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      controller.abort();
    };
  }, [acceptTask, client, moveToInvite, pollCancelKey, task]);

  const dynamicCard =
    task?.status === "succeeded" && task.resource !== null
      ? task.resource.card
      : null;
  const cards = dynamicCard === null
    ? staticCards
    : [dynamicCard, ...staticCards];
  const selectedNotificationId =
    selectionOverride !== null &&
    selectionOverride.initialValue === initialSelectedNotificationId
      ? selectionOverride.value
      : initialSelectedNotificationId;
  const preferredFocusTargetId =
    focusOverride !== null &&
    focusOverride.initialSelection === initialSelectedNotificationId
      ? focusOverride.targetId
      : undefined;
  const slotStatus: SyntheticAnalysisSlotStatus =
    task?.status ?? localStatus;

  return (
    <ActionCenterScreen
      cards={cards}
      {...(selectedNotificationId === undefined
        ? {}
        : { selectedNotificationId })}
      {...(initialFocusNotificationId === undefined
        ? {}
        : { focusNotificationId: initialFocusNotificationId })}
      {...(dynamicCard === null
        ? {}
        : { analysisResultId: dynamicCard.notification.id })}
      {...(activeTaskId === null ? {} : { taskId: activeTaskId })}
      focusRequestKey={focusRequestKey}
      onExitDemo={abandonPendingSubmit}
      {...(preferredFocusTargetId === undefined
        ? {}
        : { preferredFocusTargetId })}
      analysisSlot={
        <SyntheticAnalysisSlot
          status={slotStatus}
          {...(task === null
            ? {}
            : { executionMode: task.executionMode })}
          {...(task?.error === null || task?.error === undefined
            ? {}
            : { errorMessage: task.error.message })}
          {...(transportIssue === null ? {} : { transportIssue })}
          submittingIntent={submittingIntent}
          onStart={startTask}
          onResumeSubmit={() => void submitWithExistingKey()}
          onRefresh={() => void refreshExistingTask()}
        />
      }
    />
  );
}
