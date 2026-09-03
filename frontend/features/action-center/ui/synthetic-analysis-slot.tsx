import {
  Bot,
  CircleAlert,
  FlaskConical,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type {
  SyntheticAnalysisExecutionMode,
  SyntheticAnalysisServerStatus,
} from "../model/synthetic-analysis-task";

export type SyntheticAnalysisSlotStatus =
  | "idle"
  | "submitting"
  | SyntheticAnalysisServerStatus;

export type SyntheticAnalysisTransportIssue = Readonly<{
  message: string;
  action: "refresh_task" | "resume_submit" | "start_new";
}>;

type SyntheticAnalysisSlotProps = Readonly<{
  status: SyntheticAnalysisSlotStatus;
  executionMode?: SyntheticAnalysisExecutionMode;
  errorMessage?: string;
  transportIssue?: SyntheticAnalysisTransportIssue;
  submittingIntent?: "create" | "restore";
  onStart: () => void;
  onResumeSubmit: () => void;
  onRefresh: () => void;
}>;

const executionModeLabels = {
  synthetic_mock: "合成 Mock · 未调用模型",
  captured_replay: "已捕获结果回放 · 不是本次实时调用",
  live_model: "本次 DeepSeek 生成 · Harness 技术校验",
} as const;

const statusCopy = {
  idle: {
    title: "用 DEV001 跑通 AI 产品链路",
    detail: "一封合成邮件将经过 Candidate v2、Harness 和行动卡合同。",
  },
  submitting: {
    title: "正在提交合成分析任务",
    detail: "任务创建后会写入当前页面地址，刷新也不会重复提交。",
  },
  queued: {
    title: "已进入本机分析队列",
    detail: "正在等待离线 Analyzer；没有调用邮箱、日历或真实模型。",
  },
  running: {
    title: "正在通过 Candidate v2 与 Harness 技术校验",
    detail: "只显示真实任务状态，不展示虚假进度百分比。",
  },
  succeeded: {
    title: "DEV001 行动卡已生成",
    detail: "结果已通过前端 v0.2 合同，可在通知分区中查看证据。",
  },
  failed: {
    title: "这次结果无法安全展示",
    detail: "未使用固定样本或旧结果替代失败的 DEV001。",
  },
  stale: {
    title: "任务已失去执行租约",
    detail: "系统不会自动重跑；如需继续，请明确新建一次任务。",
  },
} as const;

export function SyntheticAnalysisSlot({
  status,
  executionMode,
  errorMessage,
  transportIssue,
  submittingIntent,
  onStart,
  onResumeSubmit,
  onRefresh,
}: SyntheticAnalysisSlotProps) {
  const failed = status === "failed" || status === "stale";
  const active = ["submitting", "queued", "running"].includes(status);
  const copy = statusCopy[status];

  return (
    <section
      aria-busy={active ? "true" : undefined}
      aria-labelledby={failed ? "analysis-task-error" : "analysis-task-heading"}
      className="analysis-slot"
      data-status={status}
    >
      <div className="analysis-slot__eyebrow">
        <FlaskConical aria-hidden="true" size={15} />
        DEV001 · AI 联调槽位
      </div>

      <div
        aria-atomic="true"
        aria-live={failed ? undefined : "polite"}
        role={failed ? undefined : "status"}
      >
        <div className="analysis-slot__heading-row">
          <span className="analysis-slot__node" aria-hidden="true">
            {active ? (
              <LoaderCircle size={17} />
            ) : failed ? (
              <CircleAlert size={17} />
            ) : status === "succeeded" ? (
              <ShieldCheck size={17} />
            ) : (
              <Bot size={17} />
            )}
          </span>
          <div>
            <h2
              id={failed ? "analysis-task-error" : "analysis-task-heading"}
              tabIndex={-1}
            >
              {copy.title}
            </h2>
            <p>
              {status === "submitting" && submittingIntent === "restore"
                ? "正在按页面中的任务编号恢复，不会创建新任务。"
                : copy.detail}
            </p>
          </div>
        </div>

        {executionMode === undefined ? null : (
          <p className="analysis-slot__mode">
            {executionModeLabels[executionMode]}
          </p>
        )}

        {failed && errorMessage !== undefined ? (
          <p className="analysis-slot__error" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </div>

      {transportIssue === undefined ? null : (
        <div className="analysis-slot__transport" role="alert">
          <CircleAlert aria-hidden="true" size={16} />
          <p>{transportIssue.message}</p>
          <button
            onClick={
              transportIssue.action === "resume_submit"
                ? onResumeSubmit
                : transportIssue.action === "refresh_task"
                  ? onRefresh
                  : onStart
            }
            type="button"
          >
            <RefreshCw aria-hidden="true" size={15} />
            {transportIssue.action === "resume_submit"
              ? "继续确认提交"
              : transportIssue.action === "refresh_task"
                ? "重新查询原任务"
                : "重新开始"}
          </button>
        </div>
      )}

      {status === "idle" && transportIssue === undefined ? (
        <button className="analysis-slot__primary" onClick={onStart} type="button">
          分析 DEV001 合成邮件
        </button>
      ) : null}

      {failed ? (
        <button className="analysis-slot__secondary" onClick={onStart} type="button">
          明确新建一次合成分析
        </button>
      ) : null}

      <p className="analysis-slot__boundary">
        {executionMode === "live_model"
          ? "本次仍只使用合成邮件；未接邮箱、日历，不使用真实学生数据。"
          : "当前仅允许合成 Mock / 回放；未接邮箱、日历，不使用真实学生数据。"}
      </p>
    </section>
  );
}
