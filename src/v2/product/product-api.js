import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { TextDecoder } from "node:util";

import {
  assertPhase2aoAnalysisRequest,
  assertPhase2aoTaskDto,
  PHASE2AO_DIGEST_PATTERN,
  PHASE2AO_IDEMPOTENCY_KEY_PATTERN,
  PHASE2AO_TASK_ID_PATTERN,
  safeErrorEnvelope,
} from "./contracts.js";
import { validateActionCardV02 } from "./action-card-v02.js";

const TASK_COLLECTION_PATH = "/api/v2/synthetic/analysis-tasks";
const DEFAULT_BODY_LIMIT = 4_096;
const TOKEN_MINIMUM_LENGTH = 16;
const TOKEN_MAXIMUM_LENGTH = 512;

class ProductApiHttpError extends Error {
  constructor(statusCode, code, message, retryable = false, allow = undefined) {
    super(message);
    this.name = "ProductApiHttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
    this.allow = allow;
  }
}

function httpError(statusCode, code, message, retryable = false, allow) {
  throw new ProductApiHttpError(
    statusCode,
    code,
    message,
    retryable,
    allow,
  );
}

function securityHeaders() {
  return {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  if (response.headersSent || response.destroyed) return;
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  response.writeHead(statusCode, {
    ...securityHeaders(),
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    ...extraHeaders,
  });
  response.end(body);
}

function publicError(error) {
  if (error instanceof ProductApiHttpError) return error;
  const statusCode = Number.isInteger(error?.statusCode)
    ? error.statusCode
    : 500;
  const code =
    typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(error.code)
      ? error.code
      : "PRODUCT_API_INTERNAL_ERROR";
  if (statusCode === 400 && code === "SYNTHETIC_ANALYSIS_REQUEST_INVALID") {
    return new ProductApiHttpError(
      400,
      code,
      "只允许提交固定的 DEV001 合成分析请求。",
      false,
    );
  }
  if (statusCode === 503 && code === "TASK_STORE_UNAVAILABLE") {
    return new ProductApiHttpError(
      503,
      code,
      "本机任务存储暂时不可用。",
      true,
    );
  }
  return new ProductApiHttpError(
    500,
    "PRODUCT_API_INTERNAL_ERROR",
    "本机分析服务暂时无法安全处理请求。",
    true,
  );
}

function sendError(response, error) {
  const safe = publicError(error);
  sendJson(
    response,
    safe.statusCode,
    safeErrorEnvelope({
      code: safe.code,
      message: safe.message,
      retryable: safe.retryable,
    }),
    safe.allow === undefined ? {} : { allow: safe.allow },
  );
}

function isLoopback(address) {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function headerValues(request, name) {
  const target = name.toLowerCase();
  const values = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === target) {
      values.push(request.rawHeaders[index + 1]);
    }
  }
  return values;
}

function oneHeader(request, name, { required = true } = {}) {
  const values = headerValues(request, name);
  if (values.length > 1 || (required && values.length !== 1)) {
    httpError(400, "REQUEST_HEADERS_INVALID", "请求头不符合内部接口约定。", false);
  }
  return values[0];
}

function tokenMatches(supplied, expected) {
  if (typeof supplied !== "string") return false;
  const suppliedDigest = createHash("sha256").update(supplied, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

function assertInternalHeaderBoundary(request) {
  const allowedInternalHeaders = new Set([
    "x-product-api-token",
    "x-session-scope-digest",
  ]);
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index].toLowerCase();
    if (
      name === "authorization" ||
      name === "cookie" ||
      (name.startsWith("x-") && !allowedInternalHeaders.has(name))
    ) {
      httpError(
        400,
        "REQUEST_HEADERS_INVALID",
        "请求头不符合内部接口约定。",
        false,
      );
    }
  }
}

function authorize(request, internalToken) {
  if (!isLoopback(request.socket.remoteAddress)) {
    httpError(404, "TASK_NOT_FOUND", "没有找到这次合成分析任务。", false);
  }
  if (request.headers.origin !== undefined) {
    httpError(403, "DIRECT_BROWSER_REQUEST_REJECTED", "该内部接口不接受浏览器直连。", false);
  }
  assertInternalHeaderBoundary(request);
  const supplied = oneHeader(request, "x-product-api-token");
  if (!tokenMatches(supplied, internalToken)) {
    httpError(401, "PRODUCT_API_AUTHENTICATION_FAILED", "内部服务认证失败。", false);
  }
  const sessionScopeDigest = oneHeader(request, "x-session-scope-digest");
  if (!PHASE2AO_DIGEST_PATTERN.test(sessionScopeDigest ?? "")) {
    httpError(400, "SESSION_SCOPE_INVALID", "会话作用域无效。", false);
  }
  const accept = oneHeader(request, "accept");
  if (accept.trim().toLowerCase() !== "application/json") {
    httpError(406, "RESPONSE_MEDIA_TYPE_REJECTED", "内部接口只返回 JSON。", false);
  }
  return sessionScopeDigest;
}

function rawPathname(requestUrl) {
  if (
    typeof requestUrl !== "string" ||
    requestUrl.length < 1 ||
    requestUrl.length > 256 ||
    requestUrl.includes("?") ||
    requestUrl.includes("#") ||
    requestUrl.includes("%") ||
    requestUrl.includes("\\") ||
    requestUrl.includes("\0") ||
    requestUrl.split("/").includes("..")
  ) {
    httpError(400, "REQUEST_PATH_INVALID", "请求路径无效。", false);
  }
  return requestUrl;
}

function taskIdFromPath(pathname) {
  if (!pathname.startsWith(`${TASK_COLLECTION_PATH}/`)) return null;
  const taskId = pathname.slice(TASK_COLLECTION_PATH.length + 1);
  return PHASE2AO_TASK_ID_PATTERN.test(taskId) ? taskId : null;
}

function assertNoRequestBody(request) {
  const contentLength = request.headers["content-length"];
  const transferEncoding = request.headers["transfer-encoding"];
  if (
    transferEncoding !== undefined ||
    (contentLength !== undefined && contentLength !== "0") ||
    request.headers["content-type"] !== undefined ||
    request.headers["content-encoding"] !== undefined
  ) {
    httpError(400, "REQUEST_BODY_NOT_ALLOWED", "该查询请求不能携带请求体。", false);
  }
}

async function readJson(request, maximumBytes) {
  const contentType = oneHeader(request, "content-type");
  if (contentType.trim().toLowerCase() !== "application/json") {
    request.resume();
    httpError(415, "CONTENT_TYPE_INVALID", "请求必须使用 application/json。", false);
  }
  if (request.headers["content-encoding"] !== undefined) {
    request.resume();
    httpError(415, "CONTENT_ENCODING_REJECTED", "请求体不能使用内容编码。", false);
  }
  const declaredValues = headerValues(request, "content-length");
  if (declaredValues.length > 1) {
    request.resume();
    httpError(400, "REQUEST_HEADERS_INVALID", "请求头不符合内部接口约定。", false);
  }
  if (
    declaredValues.length === 1 &&
    (!/^\d+$/u.test(declaredValues[0]) ||
      Number(declaredValues[0]) > maximumBytes)
  ) {
    request.resume();
    httpError(413, "REQUEST_BODY_TOO_LARGE", "请求内容超过安全大小限制。", false);
  }

  const chunks = [];
  let received = 0;
  const bytes = await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    request.on("data", (chunk) => {
      if (settled) return;
      received += chunk.length;
      if (received > maximumBytes) {
        request.resume();
        finish(reject, new ProductApiHttpError(
          413,
          "REQUEST_BODY_TOO_LARGE",
          "请求内容超过安全大小限制。",
          false,
        ));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => finish(resolve, Buffer.concat(chunks)));
    request.on("aborted", () => finish(reject, new ProductApiHttpError(
      400,
      "REQUEST_BODY_ABORTED",
      "请求内容读取中断。",
      false,
    )));
    request.on("error", () => finish(reject, new ProductApiHttpError(
      400,
      "REQUEST_BODY_INVALID",
      "请求内容无法安全读取。",
      false,
    )));
  });

  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    httpError(400, "REQUEST_BODY_ENCODING_INVALID", "请求内容必须是有效 UTF-8。", false);
  }
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    httpError(400, "REQUEST_JSON_INVALID", "请求内容不是有效 JSON。", false);
  }
  try {
    return assertPhase2aoAnalysisRequest(parsed);
  } catch {
    httpError(
      400,
      "SYNTHETIC_ANALYSIS_REQUEST_INVALID",
      "只允许提交固定的 DEV001 合成分析请求。",
      false,
    );
  }
}

function assertMethod(request, expected) {
  if (request.method !== expected) {
    httpError(405, "METHOD_NOT_ALLOWED", "该路径不支持此请求方法。", false, expected);
  }
}

/** Create the private Product API server without binding a port. */
export function createPhase2aoProductApi({
  taskService,
  internalToken,
  maximumBodyBytes = DEFAULT_BODY_LIMIT,
} = {}) {
  if (
    typeof taskService?.submit !== "function" ||
    typeof taskService?.getTask !== "function"
  ) {
    throw new TypeError("taskService is required");
  }
  if (
    typeof internalToken !== "string" ||
    internalToken.length < TOKEN_MINIMUM_LENGTH ||
    internalToken.length > TOKEN_MAXIMUM_LENGTH
  ) {
    throw new TypeError("internalToken must be a bounded non-empty secret");
  }
  if (
    !Number.isInteger(maximumBodyBytes) ||
    maximumBodyBytes < 64 ||
    maximumBodyBytes > 65_536
  ) {
    throw new TypeError("maximumBodyBytes is invalid");
  }

  const server = createServer((request, response) => {
    void (async () => {
      const pathname = rawPathname(request.url);
      const sessionScopeDigest = authorize(request, internalToken);

      if (pathname === TASK_COLLECTION_PATH) {
        assertMethod(request, "POST");
        const idempotencyKey = oneHeader(request, "idempotency-key");
        if (!PHASE2AO_IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey ?? "")) {
          request.resume();
          httpError(
            400,
            "IDEMPOTENCY_KEY_INVALID",
            "幂等键必须是 UUID v4。",
            false,
          );
        }
        const body = await readJson(request, maximumBodyBytes);
        const result = await taskService.submit({
          sessionScopeDigest,
          idempotencyKey,
          request: body,
        });
        if (
          ![200, 202].includes(result?.statusCode) ||
          result?.task === undefined
        ) {
          throw new TypeError("Task service submit result is invalid");
        }
        assertPhase2aoTaskDto(result.task, {
          validateActionCard: validateActionCardV02,
        });
        sendJson(response, result.statusCode, result.task);
        return;
      }

      const taskId = taskIdFromPath(pathname);
      if (taskId !== null) {
        assertMethod(request, "GET");
        if (request.headers["idempotency-key"] !== undefined) {
          httpError(400, "REQUEST_HEADERS_INVALID", "查询请求不能携带幂等键。", false);
        }
        assertNoRequestBody(request);
        const task = await taskService.getTask({ taskId, sessionScopeDigest });
        if (task === null) {
          httpError(404, "TASK_NOT_FOUND", "没有找到这次合成分析任务。", false);
        }
        assertPhase2aoTaskDto(task, {
          validateActionCard: validateActionCardV02,
        });
        sendJson(response, 200, task);
        return;
      }

      httpError(404, "TASK_NOT_FOUND", "没有找到这次合成分析任务。", false);
    })().catch((error) => sendError(response, error));
  });
  server.headersTimeout = 5_000;
  server.requestTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  return server;
}
