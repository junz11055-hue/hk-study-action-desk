import { deepFreeze } from "../../../lib/types/readonly-deep";
import {
  syntheticAnalysisApiErrorEnvelopeSchema,
  syntheticAnalysisTaskSchema,
  type SyntheticAnalysisApiErrorEnvelope,
  type SyntheticAnalysisTask,
} from "../model/synthetic-analysis-task";

const maximumBrowserResponseCharacters = 1_048_576;

export class SyntheticAnalysisClientError extends Error {
  readonly kind: "api" | "contract" | "transport";
  readonly status: number | null;
  readonly envelope: SyntheticAnalysisApiErrorEnvelope | null;

  constructor(options: Readonly<{
    kind: SyntheticAnalysisClientError["kind"];
    message: string;
    status?: number;
    envelope?: SyntheticAnalysisApiErrorEnvelope;
    cause?: unknown;
  }>) {
    super(options.message, { cause: options.cause });
    this.name = "SyntheticAnalysisClientError";
    this.kind = options.kind;
    this.status = options.status ?? null;
    this.envelope = options.envelope ?? null;
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new SyntheticAnalysisClientError({
      kind: "contract",
      message: "分析接口返回了无法安全读取的内容。",
      status: response.status,
    });
  }

  const text = await response.text();
  if (text.length > maximumBrowserResponseCharacters) {
    throw new SyntheticAnalysisClientError({
      kind: "contract",
      message: "分析接口响应超过安全大小限制。",
      status: response.status,
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new SyntheticAnalysisClientError({
      kind: "contract",
      message: "分析接口返回了无效 JSON。",
      status: response.status,
      cause,
    });
  }
}

async function requestTask(
  input: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<SyntheticAnalysisTask> {
  let response: Response;
  try {
    response = await fetchImpl(input, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
  } catch (cause) {
    throw new SyntheticAnalysisClientError({
      kind: "transport",
      message: "暂时无法连接本机分析服务。",
      cause,
    });
  }

  const payload = await parseResponse(response);
  if (response.ok) {
    const task = syntheticAnalysisTaskSchema.safeParse(payload);
    if (!task.success) {
      throw new SyntheticAnalysisClientError({
        kind: "contract",
        message: "分析任务未通过前端合同校验。",
        status: response.status,
        cause: task.error,
      });
    }
    return deepFreeze(task.data) as unknown as SyntheticAnalysisTask;
  }

  const envelope = syntheticAnalysisApiErrorEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new SyntheticAnalysisClientError({
      kind: "contract",
      message: "分析接口错误未通过前端合同校验。",
      status: response.status,
      cause: envelope.error,
    });
  }
  throw new SyntheticAnalysisClientError({
    kind: "api",
    message: envelope.data.error.message,
    status: response.status,
    envelope: envelope.data,
  });
}

export type SyntheticAnalysisTaskClient = Readonly<{
  submit: (
    idempotencyKey: string,
    signal?: AbortSignal,
  ) => Promise<SyntheticAnalysisTask>;
  get: (taskId: string, signal?: AbortSignal) => Promise<SyntheticAnalysisTask>;
}>;

export function createSyntheticAnalysisTaskClient(
  fetchImpl: typeof fetch = fetch,
): SyntheticAnalysisTaskClient {
  return Object.freeze({
    submit(idempotencyKey, signal) {
      return requestTask(
        "/api/v2/synthetic/analysis-tasks",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            contractVersion: "synthetic-analysis-request/v1",
            caseId: "DEV001",
          }),
          ...(signal === undefined ? {} : { signal }),
        },
        fetchImpl,
      );
    },
    get(taskId, signal) {
      return requestTask(
        `/api/v2/synthetic/analysis-tasks/${encodeURIComponent(taskId)}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          ...(signal === undefined ? {} : { signal }),
        },
        fetchImpl,
      );
    },
  });
}
