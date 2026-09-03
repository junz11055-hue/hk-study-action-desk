import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { config as defaultConfig } from "./config.js";
import { createLogger } from "./utils/logger.js";
import { SYNTHETIC_PROFILE } from "./data/synthetic-profile.js";
import {
  getSyntheticEmail,
  listSyntheticEmailSummaries,
} from "./data/synthetic-emails.js";
import { SYNTHETIC_GUIDES } from "./data/guides.js";
import { DeepSeekResponsesClient } from "./agent/deepseek-responses-client.js";
import { createModelGate } from "./agent/model-gate.js";
import {
  AgentUnavailableError,
  createNotificationAgent,
  QUESTION_TEMPLATES,
} from "./agent/notification-agent.js";
import {
  clearSessionCookie,
  createSessionStore,
  InviteRejectedError,
  readSessionToken,
  sessionCookie,
} from "./services/session-store.js";
import {
  CalendarPreviewError,
  createCalendarPreview,
} from "./services/calendar-preview.js";

const JSON_BODY_LIMIT = 16 * 1024;
const STATIC_FILES = Object.freeze({
  "/": { file: "index.html", type: "text/html; charset=utf-8", cache: "no-store" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8", cache: "no-store" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8", cache: "no-cache" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8", cache: "no-cache" },
});

class HttpError extends Error {
  constructor(statusCode, code, message, allow = null) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.allow = allow;
  }
}

function securityHeaders(isApi = false) {
  return {
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    ...(isApi ? { "cache-control": "no-store" } : {}),
  };
}

function sendJson(response, statusCode, payload, extraHeaders = {}, method = "GET") {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(statusCode, {
    ...securityHeaders(true),
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    ...extraHeaders,
  });
  response.end(method === "HEAD" ? undefined : body);
}

function sendError(response, error, method = "GET") {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  const code = error?.code || (statusCode === 500 ? "internal_error" : "request_failed");
  const message =
    statusCode === 500 ? "服务暂时无法处理此请求。" : error?.message || "请求无法完成。";
  const headers = error?.allow ? { allow: error.allow } : {};
  sendJson(response, statusCode, { error: { code, message } }, headers, method);
}

function rawPathname(requestUrl = "/") {
  const path = String(requestUrl).split("?", 1)[0];
  if (
    !path.startsWith("/") ||
    path.includes("%") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").includes("..")
  ) {
    throw new HttpError(400, "invalid_path", "请求路径无效。");
  }
  return path;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

async function readJson(request, limit = JSON_BODY_LIMIT) {
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
    throw new HttpError(415, "unsupported_media_type", "请求必须使用 application/json。");
  }
  const declaredLength = Number.parseInt(request.headers["content-length"] ?? "0", 10);
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    request.resume();
    throw new HttpError(413, "body_too_large", "请求内容过大。");
  }

  const chunks = [];
  let received = 0;
  const raw = await new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.on("data", (chunk) => {
      if (settled) return;
      received += chunk.length;
      if (received > limit) {
        fail(new HttpError(413, "body_too_large", "请求内容过大。"));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("aborted", () => fail(new HttpError(400, "request_aborted", "请求已中断。")));
    request.on("error", () => fail(new HttpError(400, "invalid_body", "无法读取请求内容。")));
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid_json", "请求内容不是有效 JSON。");
  }
  if (!isPlainObject(parsed)) {
    throw new HttpError(400, "invalid_body", "JSON 根节点必须是对象。");
  }
  return parsed;
}

function requireExactKeys(body, requiredKeys) {
  const keys = Object.keys(body);
  const extras = keys.filter((key) => !requiredKeys.includes(key));
  const missing = requiredKeys.filter((key) => !(key in body));
  if (extras.length > 0 || missing.length > 0) {
    throw new HttpError(400, "invalid_fields", "请求字段不符合此接口约定。");
  }
}

function tokenEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length === 0) return false;
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function assertOrigin(request, publicOrigin) {
  const supplied = request.headers.origin;
  if (!supplied) throw new HttpError(403, "origin_rejected", "请求来源未获允许。");
  let expectedOrigin;
  let suppliedOrigin;
  try {
    expectedOrigin = new URL(publicOrigin).origin;
    suppliedOrigin = new URL(supplied).origin;
  } catch {
    throw new HttpError(403, "origin_rejected", "请求来源未获允许。");
  }
  if (expectedOrigin !== suppliedOrigin) {
    throw new HttpError(403, "origin_rejected", "请求来源未获允许。");
  }
}

function syntheticMessageForClient(email, { includeBody = false } = {}) {
  const output = {
    id: email.id,
    source: "synthetic",
    isSynthetic: true,
    school: email.school,
    senderName: email.senderName,
    senderEmail: email.senderEmail,
    subject: email.subject,
    receivedAt: email.receivedAt,
    language: email.language,
  };
  if (includeBody) output.body = email.body;
  return output;
}

function methodNotAllowed(allow) {
  throw new HttpError(405, "method_not_allowed", "此路径不支持该请求方法。", allow);
}

export function createApp({
  config: appConfig = defaultConfig,
  modelClient: injectedModelClient,
  clock = () => Date.now(),
  logger: injectedLogger,
} = {}) {
  if (appConfig.runtimeMode && appConfig.runtimeMode !== "synthetic") {
    throw new Error("The Step 5 application only supports synthetic mode");
  }
  const now = typeof clock === "function" ? clock : () => clock.now();
  const logger = injectedLogger ?? createLogger();
  const secureCookie = String(appConfig.publicOrigin).startsWith("https://");
  const sessionStore = createSessionStore({
    inviteCodes: appConfig.inviteCodes,
    inviteMaxUses: appConfig.inviteMaxUses,
    sessionTtlMs: appConfig.sessionTtlMs,
    now,
  });
  const rawModelClient =
    injectedModelClient ??
    new DeepSeekResponsesClient({
      ...appConfig.deepseek,
      logger,
    });
  const modelClient = createModelGate(rawModelClient, { maxConcurrent: 2, maxQueued: 20 });
  const agent = createNotificationAgent({
    modelClient,
    allowPresetFallback: appConfig.allowPresetFallback,
    logger,
  });
  let processModelRequestCount = 0;

  function authenticate(request) {
    const token = readSessionToken(request);
    const session = sessionStore.getSession(token);
    if (!session) throw new HttpError(401, "authentication_required", "请先使用邀请码进入演示。" );
    return { token, session };
  }

  function authorizeMutation(request, session) {
    assertOrigin(request, appConfig.publicOrigin);
    if (!tokenEqual(request.headers["x-csrf-token"], session.csrfToken)) {
      throw new HttpError(403, "csrf_rejected", "安全校验失败，请刷新页面后重试。");
    }
  }

  function reserveModelBudget(session) {
    if (!modelClient.configured) return;
    if (processModelRequestCount >= (appConfig.modelProcessBudget ?? 100)) {
      throw new HttpError(429, "model_process_budget_reached", "本地演示进程的 AI 调用额度已用完。" );
    }
    if (session.modelRequestCount >= 12) {
      throw new HttpError(429, "model_budget_reached", "本次演示会话的 AI 调用额度已用完。" );
    }
    session.modelRequestCount += 1;
    processModelRequestCount += 1;
  }

  async function handleApi(request, response, pathname) {
    const method = request.method || "GET";

    if (pathname === "/api/health") {
      if (method !== "GET") methodNotAllowed("GET");
      sendJson(response, 200, {
        status: "ok",
        runtimeMode: "synthetic",
        modelConfigured: Boolean(modelClient.configured),
      });
      return;
    }

    if (pathname === "/api/auth/invite") {
      if (method !== "POST") methodNotAllowed("POST");
      assertOrigin(request, appConfig.publicOrigin);
      const body = await readJson(request);
      requireExactKeys(body, ["code"]);
      if (typeof body.code !== "string" || body.code.trim().length === 0) {
        throw new HttpError(401, "invite_rejected", "此邀请码暂时无法使用，请检查后重试或联系邀请人。");
      }
      let redemption;
      try {
        redemption = sessionStore.redeemInvite(body.code, request.socket.remoteAddress);
      } catch (error) {
        if (error instanceof InviteRejectedError) {
          throw new HttpError(401, "invite_rejected", "此邀请码暂时无法使用，请检查后重试或联系邀请人。");
        }
        throw error;
      }
      sendJson(
        response,
        201,
        {
          session: {
            kind: "local_synthetic_demo",
            expiresAt: new Date(redemption.session.expiresAt).toISOString(),
          },
          csrfToken: redemption.session.csrfToken,
          demo: {
            syntheticOnly: true,
            mailboxConnected: false,
            calendarConnected: false,
          },
        },
        {
          "set-cookie": sessionCookie(redemption.token, {
            secure: secureCookie,
            maxAgeSeconds: Math.floor(appConfig.sessionTtlMs / 1_000),
          }),
        },
      );
      return;
    }

    if (pathname === "/api/auth/logout") {
      if (method !== "POST") methodNotAllowed("POST");
      const { token, session } = authenticate(request);
      authorizeMutation(request, session);
      sessionStore.revoke(token);
      sendJson(
        response,
        200,
        { loggedOut: true },
        { "set-cookie": clearSessionCookie({ secure: secureCookie }) },
      );
      return;
    }

    if (pathname === "/api/bootstrap") {
      if (method !== "GET") methodNotAllowed("GET");
      const { session } = authenticate(request);
      const messages = listSyntheticEmailSummaries().map((summary) => {
        const analysis = session.analyses.get(summary.id);
        return {
          ...syntheticMessageForClient(summary),
          ...(analysis
            ? {
                card: analysis.card,
                analysisMode: analysis.analysisMode,
                aiAvailable: analysis.aiAvailable,
                notice: analysis.notice,
              }
            : {}),
        };
      });
      sendJson(response, 200, {
        profile: { ...SYNTHETIC_PROFILE, isSynthetic: true },
        messages,
        guides: SYNTHETIC_GUIDES.map((guide) => ({ ...guide, isSynthetic: true })),
        csrfToken: session.csrfToken,
        questionTemplates: Object.entries(QUESTION_TEMPLATES).map(([id, label]) => ({ id, label })),
        modelStatus: {
          provider: "deepseek",
          configured: Boolean(modelClient.configured),
          model: modelClient.configured ? modelClient.model ?? appConfig.deepseek?.model : null,
          fallbackAvailable: Boolean(appConfig.allowPresetFallback),
        },
        demo: {
          syntheticOnly: true,
          mailboxConnected: false,
          calendarConnected: false,
          localOnly: true,
        },
      });
      return;
    }

    if (pathname === "/api/guides") {
      if (method !== "GET") methodNotAllowed("GET");
      authenticate(request);
      sendJson(response, 200, {
        guides: SYNTHETIC_GUIDES.map((guide) => ({ ...guide, isSynthetic: true })),
      });
      return;
    }

    const messageMatch = pathname.match(/^\/api\/messages\/([a-z0-9-]+)$/);
    if (messageMatch) {
      if (method !== "GET") methodNotAllowed("GET");
      authenticate(request);
      const email = getSyntheticEmail(messageMatch[1]);
      if (!email) throw new HttpError(404, "message_not_found", "找不到这封合成通知。" );
      sendJson(response, 200, { message: syntheticMessageForClient(email, { includeBody: true }) });
      return;
    }

    const analyzeMatch = pathname.match(/^\/api\/messages\/([a-z0-9-]+)\/analyze$/);
    if (analyzeMatch) {
      if (method !== "POST") methodNotAllowed("POST");
      const { session } = authenticate(request);
      authorizeMutation(request, session);
      const body = await readJson(request);
      requireExactKeys(body, []);
      const email = getSyntheticEmail(analyzeMatch[1]);
      if (!email) throw new HttpError(404, "message_not_found", "找不到这封合成通知。" );

      const cached = session.analyses.get(email.id);
      const retryDegradedAnalysis =
        cached?.analysisMode === "preset" && modelClient.configured;
      if (cached && !retryDegradedAnalysis) {
        sendJson(response, 200, {
          message: syntheticMessageForClient(email),
          ...cached,
          cached: true,
        });
        return;
      }
      if (retryDegradedAnalysis) session.analyses.delete(email.id);

      let pending = session.inFlightAnalyses.get(email.id);
      if (!pending) {
        reserveModelBudget(session);
        pending = agent
          .analyze(email, SYNTHETIC_PROFILE)
          .then((result) => {
            const stored = { ...result, analyzedAt: new Date(now()).toISOString() };
            session.analyses.set(email.id, stored);
            return stored;
          })
          .finally(() => session.inFlightAnalyses.delete(email.id));
        session.inFlightAnalyses.set(email.id, pending);
      }
      const result = await pending;
      sendJson(response, 200, {
        message: syntheticMessageForClient(email),
        ...result,
        cached: false,
      });
      return;
    }

    const askMatch = pathname.match(/^\/api\/messages\/([a-z0-9-]+)\/ask$/);
    if (askMatch) {
      if (method !== "POST") methodNotAllowed("POST");
      const { session } = authenticate(request);
      authorizeMutation(request, session);
      const body = await readJson(request);
      requireExactKeys(body, ["questionTemplateId"]);
      if (typeof body.questionTemplateId !== "string" || !(body.questionTemplateId in QUESTION_TEMPLATES)) {
        throw new HttpError(400, "invalid_question", "请选择产品提供的固定问题。" );
      }
      const email = getSyntheticEmail(askMatch[1]);
      if (!email) throw new HttpError(404, "message_not_found", "找不到这封合成通知。" );
      const analysis = session.analyses.get(email.id);
      if (!analysis) {
        throw new HttpError(409, "analysis_required", "请先分析这封合成通知。" );
      }
      const cacheKey = `${email.id}:${body.questionTemplateId}`;
      const cached = session.followUps.get(cacheKey);
      const retryDegradedFollowUp =
        cached?.analysisMode === "preset" && modelClient.configured;
      if (cached && !retryDegradedFollowUp) {
        sendJson(response, 200, {
          messageId: email.id,
          questionTemplateId: body.questionTemplateId,
          ...cached,
          cached: true,
        });
        return;
      }
      if (retryDegradedFollowUp) session.followUps.delete(cacheKey);
      let pending = session.inFlightFollowUps.get(cacheKey);
      if (!pending) {
        reserveModelBudget(session);
        pending = agent
          .answer(email, SYNTHETIC_PROFILE, analysis.card, body.questionTemplateId)
          .then((result) => {
            session.followUps.set(cacheKey, result);
            return result;
          })
          .finally(() => session.inFlightFollowUps.delete(cacheKey));
        session.inFlightFollowUps.set(cacheKey, pending);
      }
      const result = await pending;
      sendJson(response, 200, {
        messageId: email.id,
        questionTemplateId: body.questionTemplateId,
        ...result,
        cached: false,
      });
      return;
    }

    if (pathname === "/api/calendar/preview") {
      if (method !== "POST") methodNotAllowed("POST");
      const { session } = authenticate(request);
      authorizeMutation(request, session);
      const body = await readJson(request);
      requireExactKeys(body, ["messageId", "actionId", "dateId"]);
      for (const key of ["messageId", "actionId", "dateId"]) {
        if (typeof body[key] !== "string" || !/^[a-z0-9-]+$/.test(body[key])) {
          throw new HttpError(400, "invalid_calendar_selection", "日历预览参数无效。" );
        }
      }
      const email = getSyntheticEmail(body.messageId);
      const analysis = session.analyses.get(body.messageId);
      if (!email || !analysis) {
        throw new HttpError(404, "analysis_not_found", "找不到对应的已分析合成通知。" );
      }
      const preview = createCalendarPreview({
        email,
        card: analysis.card,
        actionId: body.actionId,
        dateId: body.dateId,
      });
      sendJson(response, 200, { preview });
      return;
    }

    throw new HttpError(404, "api_not_found", "此 API 不存在。" );
  }

  async function handleStatic(request, response, pathname) {
    const entry = STATIC_FILES[pathname];
    if (!entry) throw new HttpError(404, "not_found", "页面不存在。" );
    if (!["GET", "HEAD"].includes(request.method || "GET")) methodNotAllowed("GET, HEAD");
    const fileUrl = new URL(`../public/${entry.file}`, import.meta.url);
    const body = await readFile(fileUrl);
    response.writeHead(200, {
      ...securityHeaders(false),
      "content-type": entry.type,
      "content-length": String(body.length),
      "cache-control": entry.cache,
    });
    response.end(request.method === "HEAD" ? undefined : body);
  }

  const server = http.createServer(async (request, response) => {
    let pathname = "/";
    try {
      pathname = rawPathname(request.url);
      if (pathname.startsWith("/api/")) {
        await handleApi(request, response, pathname);
      } else {
        await handleStatic(request, response, pathname);
      }
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const mappedError =
        error instanceof AgentUnavailableError
          ? new HttpError(503, "ai_unavailable", "真实模型暂时不可用，请稍后重试。")
          : error instanceof CalendarPreviewError
            ? new HttpError(error.statusCode, "calendar_preview_rejected", error.message)
            : error;
      if (!(mappedError instanceof HttpError) || mappedError.statusCode >= 500) {
        logger.error("request_failed", {
          method: request.method,
          pathname,
          errorType: error?.name ?? "Error",
        });
      }
      sendError(response, mappedError, request.method);
    }
  });

  server.on("clientError", (_error, socket) => {
    if (!socket.writable) return;
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const app = createApp();
  app.listen(defaultConfig.port, defaultConfig.host, () => {
    console.log(
      `AI 留学管家合成数据演示已启动：http://${defaultConfig.host}:${defaultConfig.port}`,
    );
    console.log(
      defaultConfig.deepseek.apiKey
        ? `DeepSeek 真实模型接口已配置：${defaultConfig.deepseek.model}`
        : "未配置 DEEPSEEK_API_KEY：分析将明确使用预置合成结果。",
    );
    console.log(
      defaultConfig.generatedInviteCode
        ? `本次启动生成的本地演示邀请码：${defaultConfig.generatedInviteCode}`
        : "本地演示邀请码已从 DEMO_INVITE_CODES 配置。",
    );
  });
}
