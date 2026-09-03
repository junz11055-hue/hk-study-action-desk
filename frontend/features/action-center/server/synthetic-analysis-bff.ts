import { NextResponse, type NextRequest } from "next/server";
import {
  demoSessionCookieName,
  validatedDemoSessionScopeDigest,
} from "../../invite-access/server/demo-session-scope";
import { isSameOriginDemoRequest } from "../../invite-access/server/demo-access-request";
import {
  idempotencyKeySchema,
  syntheticAnalysisRequestSchema,
  syntheticAnalysisTaskIdSchema,
  type SyntheticAnalysisApiErrorEnvelope,
} from "../model/synthetic-analysis-task";
import { readBoundedRequestJson } from "./bounded-json";
import {
  ProductApiClientError,
  productApiConfigFromEnvironment,
  requestProductApi,
  type ProductApiClientConfig,
} from "./product-api-client";

export type SyntheticAnalysisBffDependencies = Readonly<{
  resolveProductConfig?: () => ProductApiClientConfig;
  requestProduct?: typeof requestProductApi;
  resolveSessionScope?: (token: string | undefined) => string | null;
}>;

function errorEnvelope(
  code: string,
  message: string,
  retryable: boolean,
): SyntheticAnalysisApiErrorEnvelope {
  return {
    contractVersion: "synthetic-analysis-error/v1",
    error: { code, message, retryable },
  };
}

function jsonResponse(payload: unknown, status: number): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function sessionScope(
  request: NextRequest,
  dependencies: SyntheticAnalysisBffDependencies,
): string | null {
  const token = request.cookies.get(demoSessionCookieName)?.value;
  return dependencies.resolveSessionScope === undefined
    ? validatedDemoSessionScopeDigest(token)
    : dependencies.resolveSessionScope(token);
}

function productClientFailure(error: unknown): NextResponse {
  const invalidResponse =
    error instanceof ProductApiClientError &&
    error.code === "PRODUCT_API_RESPONSE_INVALID";
  return jsonResponse(
    errorEnvelope(
      invalidResponse
        ? "PRODUCT_API_RESPONSE_INVALID"
        : "PRODUCT_API_UNAVAILABLE",
      invalidResponse
        ? "分析服务返回了无法安全显示的结果。"
        : "本机分析服务暂时不可用，请稍后继续查询。",
      true,
    ),
    invalidResponse ? 502 : 503,
  );
}

function productResultResponse(
  result: Awaited<ReturnType<typeof requestProductApi>>,
): NextResponse {
  if (!result.ok && (result.status === 401 || result.status === 403)) {
    return jsonResponse(
      errorEnvelope(
        "PRODUCT_API_UNAVAILABLE",
        "本机分析服务暂时不可用，请稍后继续查询。",
        true,
      ),
      503,
    );
  }
  return jsonResponse(result.body, result.status);
}

export async function handleSyntheticAnalysisPost(
  request: NextRequest,
  dependencies: SyntheticAnalysisBffDependencies = {},
): Promise<NextResponse> {
  if (!isSameOriginDemoRequest(request)) {
    return jsonResponse(
      errorEnvelope("REQUEST_REJECTED", "请求来源未通过校验。", false),
      403,
    );
  }

  const scopeDigest = sessionScope(request, dependencies);
  if (scopeDigest === null) {
    return jsonResponse(
      errorEnvelope("DEMO_SESSION_INVALID", "邀请码会话已失效。", false),
      401,
    );
  }

  const idempotencyResult = idempotencyKeySchema.safeParse(
    request.headers.get("idempotency-key"),
  );
  const bodyResult = await readBoundedRequestJson(request);
  const requestResult = bodyResult.ok
    ? syntheticAnalysisRequestSchema.safeParse(bodyResult.value)
    : null;
  if (
    !idempotencyResult.success ||
    requestResult === null ||
    !requestResult.success
  ) {
    return jsonResponse(
      errorEnvelope(
        "SYNTHETIC_ANALYSIS_REQUEST_INVALID",
        "只允许提交固定的 DEV001 合成分析请求。",
        false,
      ),
      400,
    );
  }

  try {
    const requestProduct = dependencies.requestProduct ?? requestProductApi;
    const result = await requestProduct({
      config:
        dependencies.resolveProductConfig?.() ??
        productApiConfigFromEnvironment(),
      sessionScopeDigest: scopeDigest,
      method: "POST",
      idempotencyKey: idempotencyResult.data,
      body: requestResult.data,
    });
    return productResultResponse(result);
  } catch (error) {
    return productClientFailure(error);
  }
}

export async function handleSyntheticAnalysisGet(
  request: NextRequest,
  taskId: string,
  dependencies: SyntheticAnalysisBffDependencies = {},
): Promise<NextResponse> {
  const scopeDigest = sessionScope(request, dependencies);
  if (scopeDigest === null) {
    return jsonResponse(
      errorEnvelope("DEMO_SESSION_INVALID", "邀请码会话已失效。", false),
      401,
    );
  }

  const taskIdResult = syntheticAnalysisTaskIdSchema.safeParse(taskId);
  if (!taskIdResult.success) {
    return jsonResponse(
      errorEnvelope("TASK_NOT_FOUND", "没有找到这次合成分析任务。", false),
      404,
    );
  }

  try {
    const requestProduct = dependencies.requestProduct ?? requestProductApi;
    const result = await requestProduct({
      config:
        dependencies.resolveProductConfig?.() ??
        productApiConfigFromEnvironment(),
      sessionScopeDigest: scopeDigest,
      method: "GET",
      taskId: taskIdResult.data,
    });
    return productResultResponse(result);
  } catch (error) {
    return productClientFailure(error);
  }
}
