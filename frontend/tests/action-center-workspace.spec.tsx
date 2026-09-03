import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockActionCardRepository } from "../features/action-center/data/mock-action-card-repository";
import { SyntheticAnalysisClientError } from "../features/action-center/data/synthetic-analysis-task-client";
import { PENDING_SYNTHETIC_ANALYSIS_SUBMIT_KEY_V1 } from "../features/action-center/data/pending-synthetic-analysis-submit";
import type { SyntheticAnalysisTask } from "../features/action-center/model/synthetic-analysis-task";
import { ActionCenterWorkspace } from "../features/action-center/ui/action-center-workspace";
import {
  mutableClone,
  phase2aoTask,
  phase2aoTaskId,
} from "./phase2ao-test-fixtures";

const testDoubles = vi.hoisted(() => ({
  get: vi.fn(),
  replace: vi.fn(),
  submit: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: testDoubles.replace }),
}));

vi.mock(
  "../features/action-center/data/synthetic-analysis-task-client",
  async (importOriginal) => {
    const original = await importOriginal<
      typeof import("../features/action-center/data/synthetic-analysis-task-client")
    >();
    return {
      ...original,
      createSyntheticAnalysisTaskClient: () => ({
        get: testDoubles.get,
        submit: testDoubles.submit,
      }),
    };
  },
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const sequentialFocusSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "summary",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function advanceToFollowingTabStop(source: HTMLElement): HTMLElement {
  expect(document.activeElement).toBe(source);
  const next = Array.from(
    document.querySelectorAll<HTMLElement>(sequentialFocusSelector),
  ).find(
    (candidate) =>
      candidate.getAttribute("aria-disabled") !== "true" &&
      (source === document.body ||
        Boolean(
          source.compareDocumentPosition(candidate) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        )),
  );
  expect(next, "a following sequential focus target must exist").toBeDefined();
  next?.focus();
  expect(document.activeElement).toBe(next);
  return next as HTMLElement;
}

function expectNoPrematureAnalysisResult(container: HTMLElement): void {
  expect(
    container.querySelectorAll(".analysis-result-group .notification-item"),
  ).toHaveLength(0);
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.queryByText(/取消模型/u)).not.toBeInTheDocument();
}

describe("ActionCenterWorkspace", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    testDoubles.get.mockReset();
    testDoubles.replace.mockReset();
    testDoubles.submit.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a synchronous click lock so a rapid double action creates one POST", async () => {
    const pending = deferred<SyntheticAnalysisTask>();
    testDoubles.submit.mockReturnValue(pending.promise);
    const cards = await mockActionCardRepository.list();
    render(<ActionCenterWorkspace staticCards={cards} />);

    const button = screen.getByRole("button", {
      name: "分析 DEV001 合成邮件",
    });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(testDoubles.submit).toHaveBeenCalledTimes(1);
    expect(testDoubles.submit.mock.calls[0]?.[0]).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    const submittingHeading = screen.getByRole("heading", {
      name: "正在提交合成分析任务",
    });
    expect(document.activeElement).toBe(submittingHeading);
    expect(advanceToFollowingTabStop(submittingHeading)).toBeInstanceOf(
      HTMLAnchorElement,
    );

    await act(async () => pending.resolve(phase2aoTask("queued")));
    expect(
      screen.getByRole("heading", { name: "已进入本机分析队列" }),
    ).toBeInTheDocument();
  });

  it("polls queued to running to succeeded with GET only and one dynamic card", async () => {
    vi.useFakeTimers();
    testDoubles.submit.mockResolvedValue(phase2aoTask("queued"));
    testDoubles.get
      .mockResolvedValueOnce(phase2aoTask("running"))
      .mockResolvedValueOnce(phase2aoTask("succeeded"));
    const cards = await mockActionCardRepository.list();
    const { container } = render(<ActionCenterWorkspace staticCards={cards} />);

    fireEvent.click(
      screen.getByRole("button", { name: "分析 DEV001 合成邮件" }),
    );
    await act(async () => Promise.resolve());
    expect(
      screen.getByRole("heading", { name: "已进入本机分析队列" }),
    ).toBeInTheDocument();
    expectNoPrematureAnalysisResult(container);

    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(
      screen.getByRole("heading", {
        name: "正在通过 Candidate v2 与 Harness 技术校验",
      }),
    ).toBeInTheDocument();
    expectNoPrematureAnalysisResult(container);

    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(
      screen.getByRole("heading", { name: "DEV001 行动卡已生成" }),
    ).toBeInTheDocument();
    expect(testDoubles.submit).toHaveBeenCalledTimes(1);
    expect(testDoubles.get).toHaveBeenCalledTimes(2);
    expect(
      container.querySelectorAll(".analysis-result-group .notification-item"),
    ).toHaveLength(1);
    const resultHeading = container.querySelector<HTMLElement>(
      "#detail-title-DEV-NOTIF-PAIR-01",
    );
    expect(resultHeading).not.toBeNull();
    if (resultHeading !== null) {
      expect(document.activeElement).toBe(resultHeading);
      expect(advanceToFollowingTabStop(resultHeading)).toHaveAccessibleName(
        "查看证据",
      );
    }
  });

  it("reuses the exact Idempotency-Key when the POST outcome is uncertain", async () => {
    testDoubles.submit
      .mockRejectedValueOnce(
        new SyntheticAnalysisClientError({
          kind: "transport",
          message: "连接在返回任务编号前中断。",
        }),
      )
      .mockResolvedValueOnce(phase2aoTask("queued"));
    const cards = await mockActionCardRepository.list();
    render(<ActionCenterWorkspace staticCards={cards} />);

    fireEvent.click(
      screen.getByRole("button", { name: "分析 DEV001 合成邮件" }),
    );
    const retry = await screen.findByRole("button", {
      name: "继续确认提交",
    });
    const firstKey = testDoubles.submit.mock.calls[0]?.[0];
    expect(window.sessionStorage.getItem(
      PENDING_SYNTHETIC_ANALYSIS_SUBMIT_KEY_V1,
    )).toBe(firstKey);
    fireEvent.click(retry);

    await waitFor(() => expect(testDoubles.submit).toHaveBeenCalledTimes(2));
    expect(firstKey).toBeDefined();
    expect(testDoubles.submit.mock.calls[1]?.[0]).toBe(firstKey);
    expect(testDoubles.get).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(
      PENDING_SYNTHETIC_ANALYSIS_SUBMIT_KEY_V1,
    )).toBeNull();
  });

  it("resumes a submission across a full remount with the same POST identity", async () => {
    const uncertain = deferred<SyntheticAnalysisTask>();
    testDoubles.submit
      .mockReturnValueOnce(uncertain.promise)
      .mockResolvedValueOnce(phase2aoTask("succeeded"));
    const cards = await mockActionCardRepository.list();
    const firstMount = render(<ActionCenterWorkspace staticCards={cards} />);

    fireEvent.click(
      screen.getByRole("button", { name: "分析 DEV001 合成邮件" }),
    );
    await waitFor(() => expect(testDoubles.submit).toHaveBeenCalledTimes(1));
    const firstKey = testDoubles.submit.mock.calls[0]?.[0];
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(window.sessionStorage).toHaveLength(1);
    expect(window.sessionStorage.getItem(
      PENDING_SYNTHETIC_ANALYSIS_SUBMIT_KEY_V1,
    )).toBe(firstKey);

    firstMount.unmount();
    render(<ActionCenterWorkspace staticCards={cards} />);

    await waitFor(() => expect(testDoubles.submit).toHaveBeenCalledTimes(2));
    expect(testDoubles.submit.mock.calls[1]?.[0]).toBe(firstKey);
    expect(window.sessionStorage.getItem(
      PENDING_SYNTHETIC_ANALYSIS_SUBMIT_KEY_V1,
    )).toBeNull();
    expect(testDoubles.get).not.toHaveBeenCalled();
  });

  it("clears a pending identity after a deterministic submit failure", async () => {
    testDoubles.submit.mockRejectedValue(
      new SyntheticAnalysisClientError({
        kind: "api",
        message: "合成请求已被确定性拒绝。",
        status: 400,
        envelope: {
          contractVersion: "synthetic-analysis-error/v1",
          error: {
            code: "INVALID_REQUEST",
            message: "合成请求已被确定性拒绝。",
            retryable: false,
          },
        },
      }),
    );
    const cards = await mockActionCardRepository.list();
    render(<ActionCenterWorkspace staticCards={cards} />);

    fireEvent.click(
      screen.getByRole("button", { name: "分析 DEV001 合成邮件" }),
    );

    await screen.findByRole("button", { name: "重新开始" });
    expect(window.sessionStorage.getItem(
      PENDING_SYNTHETIC_ANALYSIS_SUBMIT_KEY_V1,
    )).toBeNull();
  });

  it("clears the pending identity before moving an expired session to invite", async () => {
    testDoubles.submit.mockRejectedValue(
      new SyntheticAnalysisClientError({
        kind: "api",
        message: "邀请码会话已失效。",
        status: 401,
        envelope: {
          contractVersion: "synthetic-analysis-error/v1",
          error: {
            code: "DEMO_SESSION_INVALID",
            message: "邀请码会话已失效。",
            retryable: false,
          },
        },
      }),
    );
    const cards = await mockActionCardRepository.list();
    render(<ActionCenterWorkspace staticCards={cards} />);

    fireEvent.click(
      screen.getByRole("button", { name: "分析 DEV001 合成邮件" }),
    );

    await waitFor(() =>
      expect(testDoubles.replace).toHaveBeenCalledWith(
        "/invite?reason=session-ended",
        { scroll: false },
      ),
    );
    expect(window.sessionStorage.getItem(
      PENDING_SYNTHETIC_ANALYSIS_SUBMIT_KEY_V1,
    )).toBeNull();
  });

  it("restores by GET only, retries the same taskId after transport failure and separates the result", async () => {
    window.sessionStorage.setItem(
      PENDING_SYNTHETIC_ANALYSIS_SUBMIT_KEY_V1,
      "55555555-5555-4555-8555-555555555555",
    );
    testDoubles.get
      .mockRejectedValueOnce(
        new SyntheticAnalysisClientError({
          kind: "transport",
          message: "暂时无法连接本机分析服务。",
        }),
      )
      .mockResolvedValueOnce(phase2aoTask("succeeded"));
    const cards = await mockActionCardRepository.list();
    const { container } = render(
      <ActionCenterWorkspace
        initialTaskId={phase2aoTaskId}
        staticCards={cards}
      />,
    );

    const retry = await screen.findByRole("button", {
      name: "重新查询原任务",
    });
    fireEvent.click(retry);

    await screen.findByRole("heading", { name: "本次联调结果" });
    expect(testDoubles.submit).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(
      PENDING_SYNTHETIC_ANALYSIS_SUBMIT_KEY_V1,
    )).toBeNull();
    expect(testDoubles.get).toHaveBeenCalledTimes(2);
    expect(testDoubles.get.mock.calls.every(([id]) => id === phase2aoTaskId)).toBe(
      true,
    );
    expect(
      container.querySelectorAll(".analysis-result-group .notification-item"),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll(".notification-groups .notification-item"),
    ).toHaveLength(4);
  });

  it("clears the pending identity before explicit demo exit", async () => {
    const uncertain = deferred<SyntheticAnalysisTask>();
    testDoubles.submit.mockReturnValue(uncertain.promise);
    const cards = await mockActionCardRepository.list();
    render(<ActionCenterWorkspace staticCards={cards} />);
    fireEvent.click(
      screen.getByRole("button", { name: "分析 DEV001 合成邮件" }),
    );
    await waitFor(() => expect(testDoubles.submit).toHaveBeenCalledTimes(1));
    expect(window.sessionStorage.getItem(
      PENDING_SYNTHETIC_ANALYSIS_SUBMIT_KEY_V1,
    )).not.toBeNull();

    const exitButton = screen.getAllByRole("button", {
      name: "退出演示",
    })[0];
    expect(exitButton).toBeDefined();
    const exitForm = exitButton?.closest("form") ?? null;
    expect(exitForm).not.toBeNull();
    if (exitForm !== null) fireEvent.submit(exitForm);

    expect(window.sessionStorage.getItem(
      PENDING_SYNTHETIC_ANALYSIS_SUBMIT_KEY_V1,
    )).toBeNull();
  });

  it.each([
    ["queued", "已进入本机分析队列"],
    ["running", "正在通过 Candidate v2 与 Harness 技术校验"],
  ] as const)(
    "restores the %s state from initialTaskId with GET only",
    async (status, heading) => {
      vi.useFakeTimers();
      testDoubles.get.mockResolvedValue(phase2aoTask(status));
      const cards = await mockActionCardRepository.list();
      const { container } = render(
        <ActionCenterWorkspace
          initialTaskId={phase2aoTaskId}
          staticCards={cards}
        />,
      );

      await act(async () => Promise.resolve());
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
      expect(testDoubles.get).toHaveBeenCalledTimes(1);
      expect(testDoubles.get).toHaveBeenCalledWith(
        phase2aoTaskId,
        expect.any(AbortSignal),
      );
      expect(testDoubles.submit).not.toHaveBeenCalled();
      expectNoPrematureAnalysisResult(container);
      expect(document.activeElement).toBe(document.body);
      expect(advanceToFollowingTabStop(document.body)).toHaveAccessibleName(
        "跳到主要内容",
      );
    },
  );

  it("stops automatic polling on a non-retryable task error", async () => {
    vi.useFakeTimers();
    testDoubles.submit.mockResolvedValue(phase2aoTask("queued"));
    testDoubles.get.mockRejectedValue(
      new SyntheticAnalysisClientError({
        kind: "api",
        message: "没有找到这次合成分析任务。",
        status: 404,
        envelope: {
          contractVersion: "synthetic-analysis-error/v1",
          error: {
            code: "TASK_NOT_FOUND",
            message: "没有找到这次合成分析任务。",
            retryable: false,
          },
        },
      }),
    );
    const cards = await mockActionCardRepository.list();
    render(<ActionCenterWorkspace staticCards={cards} />);

    fireEvent.click(
      screen.getByRole("button", { name: "分析 DEV001 合成邮件" }),
    );
    await act(async () => Promise.resolve());
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(
      screen.getByRole("button", { name: "重新开始" }),
    ).toBeInTheDocument();
    expect(testDoubles.get).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(testDoubles.get).toHaveBeenCalledTimes(1);
    expect(testDoubles.submit).toHaveBeenCalledTimes(1);
  });

  it.each(["failed", "stale"] as const)(
    "fails closed on %s and never shows a DEV001 fallback card",
    async (status) => {
      testDoubles.get.mockResolvedValue(phase2aoTask(status));
      const cards = await mockActionCardRepository.list();
      const { container } = render(
        <ActionCenterWorkspace
          initialTaskId={phase2aoTaskId}
          staticCards={cards}
        />,
      );

      await screen.findByRole("button", {
        name: "明确新建一次合成分析",
      });
      expect(container.querySelector(".analysis-result-group")).toBeNull();
      expect(
        container.querySelectorAll(".notification-groups .notification-item"),
      ).toHaveLength(4);
      expect(screen.getByText("四张静态合成卡不会替代 DEV001 联调结果")).toBeInTheDocument();
      expect(document.activeElement).toBe(document.body);
      expect(advanceToFollowingTabStop(document.body)).toHaveAccessibleName(
        "跳到主要内容",
      );
    },
  );

  it.each(["failed", "stale"] as const)(
    "moves focus to the error summary after a user-started %s task and keeps Tab available",
    async (status) => {
      testDoubles.submit.mockResolvedValue(phase2aoTask(status));
      const cards = await mockActionCardRepository.list();
      render(<ActionCenterWorkspace staticCards={cards} />);

      fireEvent.click(
        screen.getByRole("button", { name: "分析 DEV001 合成邮件" }),
      );

      const errorHeading = await screen.findByRole("heading", {
        name:
          status === "failed"
            ? "这次结果无法安全展示"
            : "任务已失去执行租约",
      });
      expect(document.activeElement).toBe(errorHeading);
      expect(advanceToFollowingTabStop(errorHeading)).toHaveAccessibleName(
        "明确新建一次合成分析",
      );
    },
  );

  it("keeps taskId on result, notification and return navigation", async () => {
    testDoubles.get.mockResolvedValue(phase2aoTask("succeeded"));
    const cards = await mockActionCardRepository.list();
    const { container } = render(
      <ActionCenterWorkspace
        initialTaskId={phase2aoTaskId}
        staticCards={cards}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector(".analysis-result-group")).not.toBeNull();
    });
    const restoredResultHeading = container.querySelector<HTMLElement>(
      "#detail-title-DEV-NOTIF-PAIR-01",
    );
    expect(restoredResultHeading).not.toBeNull();
    if (restoredResultHeading !== null) {
      expect(document.activeElement).toBe(restoredResultHeading);
      expect(advanceToFollowingTabStop(restoredResultHeading)).toHaveAccessibleName(
        "查看证据",
      );
    }
    expect(
      container.querySelector(
        `a[href="/workspace?notification=DEV-NOTIF-PAIR-01&taskId=${phase2aoTaskId}"]`,
      ),
    ).not.toBeNull();
    expect(screen.getByRole("link", { name: "返回通知列表" })).toHaveAttribute(
      "href",
      `/workspace?focus=DEV-NOTIF-PAIR-01&taskId=${phase2aoTaskId}#notification-DEV-NOTIF-PAIR-01`,
    );
  });

  it.each(["failed", "stale"] as const)(
    "clears a prior success on a new URL task generation and never restores it when the new task is %s",
    async (status) => {
      const nextTaskId = "66666666-6666-4666-8666-666666666666";
      const pendingNextTask = deferred<SyntheticAnalysisTask>();
      testDoubles.get
        .mockResolvedValueOnce(phase2aoTask("succeeded"))
        .mockReturnValueOnce(pendingNextTask.promise);
      const cards = await mockActionCardRepository.list();
      const view = render(
        <ActionCenterWorkspace
          initialTaskId={phase2aoTaskId}
          staticCards={cards}
        />,
      );

      await waitFor(() => {
        expect(
          view.container.querySelectorAll(
            ".analysis-result-group .notification-item",
          ),
        ).toHaveLength(1);
      });

      view.rerender(
        <ActionCenterWorkspace
          initialTaskId={nextTaskId}
          staticCards={cards}
        />,
      );
      await waitFor(() => expect(testDoubles.get).toHaveBeenCalledTimes(2));
      expectNoPrematureAnalysisResult(view.container);

      const nextTask = mutableClone(phase2aoTask(status));
      nextTask.taskId = nextTaskId;
      await act(async () => pendingNextTask.resolve(nextTask));

      await screen.findByRole("button", {
        name: "明确新建一次合成分析",
      });
      expect(
        view.container.querySelector(".analysis-result-group"),
      ).toBeNull();
      expect(
        view.container.querySelectorAll(
          ".notification-groups .notification-item",
        ),
      ).toHaveLength(4);
      expect(testDoubles.submit).not.toHaveBeenCalled();
    },
  );

  it("ignores an aborted older restore response after URL taskId changes", async () => {
    const older = deferred<SyntheticAnalysisTask>();
    const newerTaskId = "33333333-3333-4333-8333-333333333333";
    const newer = mutableClone(phase2aoTask("succeeded"));
    newer.taskId = newerTaskId;
    testDoubles.get
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce(newer);
    const cards = await mockActionCardRepository.list();
    const view = render(
      <ActionCenterWorkspace
        initialTaskId={phase2aoTaskId}
        staticCards={cards}
      />,
    );

    view.rerender(
      <ActionCenterWorkspace
        initialTaskId={newerTaskId}
        staticCards={cards}
      />,
    );
    await screen.findByRole("heading", { name: "DEV001 行动卡已生成" });

    await act(async () => older.resolve(phase2aoTask("failed")));
    expect(
      screen.getByRole("heading", { name: "DEV001 行动卡已生成" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "明确新建一次合成分析" }),
    ).not.toBeInTheDocument();
  });
});
