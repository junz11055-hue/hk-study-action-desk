import { once } from "node:events";
import http from "node:http";

import { createApp } from "../src/server.js";

export const TEST_INVITE_CODE = "TEST-ONLY-SYNTHETIC-INVITE";
export const TEST_PUBLIC_ORIGIN = "http://test.local";

export function createTestConfig(overrides = {}) {
  const base = {
    port: 0,
    publicOrigin: TEST_PUBLIC_ORIGIN,
    inviteCodes: [TEST_INVITE_CODE],
    inviteMaxUses: 50,
    sessionTtlMs: 60 * 60_000,
    deepseek: {
      apiKey: "",
      model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com",
      timeoutMs: 50,
      maxRetries: 1,
    },
    allowPresetFallback: true,
  };
  return {
    ...base,
    ...overrides,
    deepseek: { ...base.deepseek, ...(overrides.deepseek ?? {}) },
  };
}

export function createNoopLogger(records = []) {
  function record(level, event, metadata) {
    records.push({ level, event, metadata });
  }
  return {
    info: (event, metadata) => record("info", event, metadata),
    warn: (event, metadata) => record("warn", event, metadata),
    error: (event, metadata) => record("error", event, metadata),
  };
}

export function unconfiguredModelClient() {
  return {
    configured: false,
    async createStructured() {
      throw new Error("An unconfigured model client must never be called");
    },
  };
}

export async function startTestApp(t, overrides = {}) {
  const config = overrides.config ?? createTestConfig();
  const loggerRecords = [];
  const logger = overrides.logger ?? createNoopLogger(loggerRecords);
  const modelClient = overrides.modelClient ?? unconfiguredModelClient();
  const server = createApp({
    config,
    modelClient,
    clock: overrides.clock,
    logger,
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    if (!server.listening) return;
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  return { baseUrl, config, loggerRecords, modelClient, server };
}

export function cookieFrom(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  const raw = values[0] ?? response.headers.get("set-cookie") ?? "";
  return { raw, cookie: raw.split(";", 1)[0] };
}

export async function request(baseUrl, path, options = {}) {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers ?? {});
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.csrfToken) headers.set("x-csrf-token", options.csrfToken);
  if (options.origin) headers.set("origin", options.origin);

  let body;
  if (Object.hasOwn(options, "json")) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.json);
  } else if (Object.hasOwn(options, "rawBody")) {
    body = options.rawBody;
  }

  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body,
    redirect: "manual",
  });
}

export async function responseJson(response) {
  const text = await response.text();
  assertJsonContentType(response);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected JSON for ${response.status}, received: ${text.slice(0, 240)}`, {
      cause: error,
    });
  }
}

export function assertJsonContentType(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!/^application\/json(?:;|$)/i.test(contentType)) {
    throw new Error(`Expected application/json, received ${contentType || "no content-type"}`);
  }
}

export async function login(baseUrl, code = TEST_INVITE_CODE, options = {}) {
  const response = await request(baseUrl, "/api/auth/invite", {
    method: "POST",
    json: { code },
    origin: options.origin ?? TEST_PUBLIC_ORIGIN,
    cookie: options.cookie,
  });
  const cookie = cookieFrom(response);
  const payload = await responseJson(response);
  return { response, payload, ...cookie };
}

export async function bootstrap(baseUrl, cookie) {
  const response = await request(baseUrl, "/api/bootstrap", { cookie });
  const payload = await responseJson(response);
  return { response, payload };
}

export async function authenticatedClient(t, overrides = {}) {
  const app = await startTestApp(t, overrides);
  const auth = await login(app.baseUrl);
  if (![200, 201].includes(auth.response.status)) {
    throw new Error(`Test login failed with ${auth.response.status}: ${JSON.stringify(auth.payload)}`);
  }
  const boot = await bootstrap(app.baseUrl, auth.cookie);
  if (boot.response.status !== 200) {
    throw new Error(`Test bootstrap failed with ${boot.response.status}`);
  }
  return {
    ...app,
    cookie: auth.cookie,
    setCookie: auth.raw,
    csrfToken: boot.payload.csrfToken,
    bootstrap: boot.payload,
  };
}

export async function rawHttpRequest(baseUrl, rawPath, options = {}) {
  const target = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        method: options.method ?? "GET",
        path: rawPath,
        headers: options.headers,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.on("error", reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}
