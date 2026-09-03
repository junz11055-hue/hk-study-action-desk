import type { z } from "zod";
import {
  syntheticAnalysisApiErrorEnvelopeSchema,
  syntheticAnalysisTaskSchema,
  type SyntheticAnalysisApiErrorEnvelope,
  type SyntheticAnalysisRequest,
  type SyntheticAnalysisTask,
} from "../model/synthetic-analysis-task";
import { readBoundedResponseJson } from "./bounded-json";

const productRequestTimeoutMs = 5_000;
const internalTokenMaximumLength = 512;

export type ProductApiClientConfig = Readonly<{
  baseUrl: string;
  token: string;
}>;

export type ProductApiResult =
  | Readonly<{
      ok: true;
      status: 200 | 202;
      body: SyntheticAnalysisTask;
    }>
  | Readonly<{
      ok: false;
      status: number;
      body: SyntheticAnalysisApiErrorEnvelope;
    }>;

export class ProductApiClientError extends Error {
  readonly code:
    | "PRODUCT_API_CONFIG_INVALID"
    | "PRODUCT_API_UNAVAILABLE"
    | "PRODUCT_API_RESPONSE_INVALID";

  constructor(
    code: ProductApiClientError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProductApiClientError";
    this.code = code;
  }
}

function normalizeLoopbackBaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const isAllowedHost =
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname === "[::1]" ||
      url.hostname === "::1";
    const hasCleanRoot =
      (url.pathname === "/" || url.pathname === "") &&
      url.search === "" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === "";
    if (
      url.protocol !== "http:" ||
      !isAllowedHost ||
      url.port === "" ||
      !hasCleanRoot
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function productApiConfigFromEnvironment(): ProductApiClientConfig {
  const configuredBaseUrl =
    process.env.PHASE2AO_PRODUCT_API_BASE_URL?.trim() ?? "";
  const baseUrl = normalizeLoopbackBaseUrl(configuredBaseUrl);
  const token = process.env.PHASE2AO_PRODUCT_API_TOKEN?.trim() ?? "";

  if (
    baseUrl === null ||
    token.length < 16 ||
    token.length > internalTokenMaximumLength
  ) {
    throw new ProductApiClientError(
      "PRODUCT_API_CONFIG_INVALID",
      "本机产品 API 尚未安全配置。",
    );
  }
  return { baseUrl, token };
}

function taskPath(taskId?: string): string {
  return taskId === undefined
    ? "/api/v2/synthetic/analysis-tasks"
    : `/api/v2/synthetic/analysis-tasks/${encodeURIComponent(taskId)}`;
}

function safeParse<T>(
  schema: z.ZodType<T>,
  payload: unknown,
): T | null {
  const parsed = schema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export async function requestProductApi(options: Readonly<{
  config: ProductApiClientConfig;
  sessionScopeDigest: string;
  method: "GET" | "POST";
  taskId?: string;
  idempotencyKey?: string;
  body?: SyntheticAnalysisRequest;
  fetchImpl?: typeof fetch;
}>): Promise<ProductApiResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = new URL(taskPath(options.taskId), options.config.baseUrl);
  const headers = new Headers({
    Accept: "application/json",
    "X-Product-Api-Token": options.config.token,
    "X-Session-Scope-Digest": options.sessionScopeDigest,
  });
  if (options.method === "POST") {
    headers.set("Content-Type", "application/json");
    if (options.idempotencyKey !== undefined) {
      headers.set("Idempotency-Key", options.idempotencyKey);
    }
  }

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: options.method,
      headers,
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(productRequestTimeoutMs),
    });
  } catch (cause) {
    throw new ProductApiClientError(
      "PRODUCT_API_UNAVAILABLE",
      "本机产品 API 暂时不可用。",
      { cause },
    );
  }

  const payload = await readBoundedResponseJson(response);
  if (!payload.ok) {
    throw new ProductApiClientError(
      "PRODUCT_API_RESPONSE_INVALID",
      "本机产品 API 返回了无法安全读取的响应。",
    );
  }

  if (response.status === 200 || response.status === 202) {
    const task = safeParse(syntheticAnalysisTaskSchema, payload.value);
    const taskIdentityMismatch =
      options.method === "GET" &&
      (options.taskId === undefined || task?.taskId !== options.taskId);
    if (task === null || taskIdentityMismatch) {
      throw new ProductApiClientError(
        "PRODUCT_API_RESPONSE_INVALID",
        "本机产品 API 返回了不符合合同的任务。",
      );
    }
    return { ok: true, status: response.status, body: task };
  }

  const error = safeParse(
    syntheticAnalysisApiErrorEnvelopeSchema,
    payload.value,
  );
  if (error === null || response.status < 400 || response.status > 599) {
    throw new ProductApiClientError(
      "PRODUCT_API_RESPONSE_INVALID",
      "本机产品 API 返回了不符合合同的错误。",
    );
  }
  return { ok: false, status: response.status, body: error };
}
