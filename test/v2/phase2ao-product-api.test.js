import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createPhase2aoOfflineAnalyzer } from "../../src/v2/product/offline-analyzers.js";
import { createPhase2aoProductApi } from "../../src/v2/product/product-api.js";
import { createPhase2aoTaskService } from "../../src/v2/product/task-service.js";
import { createPhase2aoTaskStore } from "../../src/v2/product/task-store.js";

const TOKEN = "phase2ao-internal-test-token-0001";
const SESSION_A = `sha256:${"a".repeat(64)}`;
const SESSION_B = `sha256:${"b".repeat(64)}`;
const KEY_A = "11111111-1111-4111-8111-111111111111";
const COLLECTION = "/api/v2/synthetic/analysis-tasks";

async function privateTempDirectory(t) {
  const created = await mkdtemp(path.join(tmpdir(), "phase2ao-api-"));
  const directory = await realpath(created);
  t.after(async () => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function listenLoopback(server) {
  assert.equal(server.listening, false);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.equal(typeof address, "object");
  assert.equal(address.address, "127.0.0.1");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

function headers({
  token = TOKEN,
  session = SESSION_A,
  idempotencyKey = KEY_A,
  contentType = "application/json",
  origin,
  post = true,
} = {}) {
  return {
    Accept: "application/json",
    "X-Product-Api-Token": token,
    "X-Session-Scope-Digest": session,
    ...(post
      ? {
          "Idempotency-Key": idempotencyKey,
          "Content-Type": contentType,
        }
      : {}),
    ...(origin === undefined ? {} : { Origin: origin }),
  };
}

async function json(response) {
  assert.equal(
    response.headers.get("content-type"),
    "application/json; charset=utf-8",
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  return await response.json();
}

async function actualApiFixture(t) {
  const directory = await privateTempDirectory(t);
  const taskStore = await createPhase2aoTaskStore({ directory });
  const analyzer = createPhase2aoOfflineAnalyzer({
    executionMode: "synthetic_mock",
  });
  const service = createPhase2aoTaskService({
    taskStore,
    analyzer,
    executionMode: "synthetic_mock",
    clock: () => new Date("2026-09-01T00:00:00.000Z"),
  });
  const server = createPhase2aoProductApi({
    taskService: service,
    internalToken: TOKEN,
  });
  const baseUrl = await listenLoopback(server);
  return { analyzer, baseUrl, server, service };
}

test("Product API completes POST to recoverable GET on a random loopback port", async (t) => {
  const { analyzer, baseUrl, server, service } = await actualApiFixture(t);
  try {
    const submittedResponse = await fetch(`${baseUrl}${COLLECTION}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        contractVersion: "synthetic-analysis-request/v1",
        caseId: "DEV001",
      }),
      redirect: "error",
    });
    assert.equal(submittedResponse.status, 202);
    const submitted = await json(submittedResponse);
    assert.equal(submitted.status, "queued");
    assert.equal(submitted.cached, false);
    assert.equal(submitted.executionMode, "synthetic_mock");

    await service.drain();
    assert.equal(analyzer.callCount, 1);
    const taskResponse = await fetch(
      `${baseUrl}${COLLECTION}/${submitted.taskId}`,
      { method: "GET", headers: headers({ post: false }), redirect: "error" },
    );
    assert.equal(taskResponse.status, 200);
    const task = await json(taskResponse);
    assert.equal(task.status, "succeeded");
    assert.equal(task.resource.card.notification.id, "DEV-NOTIF-PAIR-01");
    assert.equal(task.resource.card.provenance.sourceMode, "synthetic_mock");

    const foreignResponse = await fetch(
      `${baseUrl}${COLLECTION}/${submitted.taskId}`,
      {
        method: "GET",
        headers: headers({ post: false, session: SESSION_B }),
        redirect: "error",
      },
    );
    assert.equal(foreignResponse.status, 404);
    const foreign = await json(foreignResponse);
    assert.equal(foreign.error.code, "TASK_NOT_FOUND");

    const serialized = JSON.stringify(task);
    for (const forbidden of [TOKEN, "candidateHash", "modelInput", "prompt", "Key"]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  } finally {
    await closeServer(server);
  }
  assert.equal(server.listening, false);
});

test("Product API rejects malformed or unauthorized requests before Analyzer", async (t) => {
  const { analyzer, baseUrl, server } = await actualApiFixture(t);
  const validBody = JSON.stringify({
    contractVersion: "synthetic-analysis-request/v1",
    caseId: "DEV001",
  });
  const cases = [
    {
      name: "wrong internal token",
      expectedStatus: 401,
      expectedCode: "PRODUCT_API_AUTHENTICATION_FAILED",
      init: { method: "POST", headers: headers({ token: "x".repeat(20) }), body: validBody },
      path: COLLECTION,
    },
    {
      name: "direct browser origin",
      expectedStatus: 403,
      expectedCode: "DIRECT_BROWSER_REQUEST_REJECTED",
      init: { method: "POST", headers: headers({ origin: "http://127.0.0.1:3000" }), body: validBody },
      path: COLLECTION,
    },
    {
      name: "invalid session digest",
      expectedStatus: 400,
      expectedCode: "SESSION_SCOPE_INVALID",
      init: { method: "POST", headers: headers({ session: "invalid" }), body: validBody },
      path: COLLECTION,
    },
    {
      name: "invalid idempotency key",
      expectedStatus: 400,
      expectedCode: "IDEMPOTENCY_KEY_INVALID",
      init: { method: "POST", headers: headers({ idempotencyKey: "invalid" }), body: validBody },
      path: COLLECTION,
    },
    {
      name: "unexpected internal header",
      expectedStatus: 400,
      expectedCode: "REQUEST_HEADERS_INVALID",
      init: {
        method: "POST",
        headers: { ...headers(), "X-Execution-Mode": "live_model" },
        body: validBody,
      },
      path: COLLECTION,
    },
    {
      name: "wrong content type",
      expectedStatus: 415,
      expectedCode: "CONTENT_TYPE_INVALID",
      init: { method: "POST", headers: headers({ contentType: "text/plain" }), body: validBody },
      path: COLLECTION,
    },
    {
      name: "invalid JSON",
      expectedStatus: 400,
      expectedCode: "REQUEST_JSON_INVALID",
      init: { method: "POST", headers: headers(), body: "{" },
      path: COLLECTION,
    },
    {
      name: "unknown request field",
      expectedStatus: 400,
      expectedCode: "SYNTHETIC_ANALYSIS_REQUEST_INVALID",
      init: {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          contractVersion: "synthetic-analysis-request/v1",
          caseId: "DEV001",
          executionMode: "live_model",
        }),
      },
      path: COLLECTION,
    },
    {
      name: "query string",
      expectedStatus: 400,
      expectedCode: "REQUEST_PATH_INVALID",
      init: { method: "POST", headers: headers(), body: validBody },
      path: `${COLLECTION}?mode=live_model`,
    },
    {
      name: "oversized body",
      expectedStatus: 413,
      expectedCode: "REQUEST_BODY_TOO_LARGE",
      init: { method: "POST", headers: headers(), body: `{"padding":"${"x".repeat(5_000)}"}` },
      path: COLLECTION,
    },
  ];

  try {
    for (const scenario of cases) {
      const response = await fetch(`${baseUrl}${scenario.path}`, {
        ...scenario.init,
        redirect: "error",
      });
      assert.equal(response.status, scenario.expectedStatus, scenario.name);
      const payload = await json(response);
      assert.equal(payload.error.code, scenario.expectedCode, scenario.name);
      assert.deepEqual(Object.keys(payload).sort(), ["contractVersion", "error"]);
      assert.deepEqual(Object.keys(payload.error).sort(), [
        "code",
        "message",
        "retryable",
      ]);
    }
    assert.equal(analyzer.callCount, 0);
  } finally {
    await closeServer(server);
  }
  assert.equal(server.listening, false);
});

test("Product API validates Task DTO again and fails closed on service leakage", async () => {
  const server = createPhase2aoProductApi({
    internalToken: TOKEN,
    taskService: {
      async submit() {
        return {
          statusCode: 202,
          task: { taskId: KEY_A, candidate: { secret: "must-not-leak" } },
        };
      },
      async getTask() {
        return null;
      },
    },
  });
  const baseUrl = await listenLoopback(server);
  try {
    const response = await fetch(`${baseUrl}${COLLECTION}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        contractVersion: "synthetic-analysis-request/v1",
        caseId: "DEV001",
      }),
      redirect: "error",
    });
    assert.equal(response.status, 500);
    const payload = await json(response);
    assert.equal(payload.error.code, "PRODUCT_API_INTERNAL_ERROR");
    assert.equal(JSON.stringify(payload).includes("must-not-leak"), false);
  } finally {
    await closeServer(server);
  }
  assert.equal(server.listening, false);
});
