import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/server.js";
import { DEPOSIT_QUOTE, makeValidActionCard } from "./fixtures.js";
import {
  TEST_PUBLIC_ORIGIN,
  authenticatedClient,
  createTestConfig,
  request,
  responseJson,
  startTestApp,
} from "./http-helpers.js";

function authMutation(client, path, json = {}) {
  return request(client.baseUrl, path, {
    method: "POST",
    json,
    origin: TEST_PUBLIC_ORIGIN,
    cookie: client.cookie,
    csrfToken: client.csrfToken,
  });
}

test("application fails closed when configured for anything except synthetic mode", () => {
  const config = createTestConfig({ runtimeMode: "real-mail" });
  assert.throws(() => createApp({ config }), /only supports synthetic mode/i);
});

test("bootstrap exposes only synthetic summaries and the approved top-level contract", async (t) => {
  const client = await authenticatedClient(t);
  const payload = client.bootstrap;

  for (const key of ["profile", "messages", "guides", "csrfToken", "modelStatus", "demo"]) {
    assert.ok(Object.hasOwn(payload, key), `bootstrap missing ${key}`);
  }
  assert.ok(Array.isArray(payload.messages));
  assert.ok(payload.messages.length >= 6);
  for (const message of payload.messages) {
    assert.equal("body" in message, false);
    assert.match(message.senderEmail, /\.invalid$/);
  }
  assert.match(JSON.stringify(payload.demo), /合成|synthetic/i);
  assert.doesNotMatch(JSON.stringify(payload), /DEEPSEEK_API_KEY|TEST-ONLY-SYNTHETIC-INVITE/);
});

test("analysis accepts only a server-known synthetic messageId and an empty body", async (t) => {
  const client = await authenticatedClient(t);

  const unknown = await authMutation(client, "/api/messages/not-a-server-fixture/analyze");
  assert.equal(unknown.status, 404);

  for (const body of [
    { messageId: "deposit-deadline" },
    { rawEmail: "this could be a real email" },
    { body: "paste a private email here" },
    { url: "https://mail.example/private" },
  ]) {
    const response = await authMutation(client, "/api/messages/deposit-deadline/analyze", body);
    assert.equal(response.status, 400, JSON.stringify(body));
  }

  const accepted = await authMutation(client, "/api/messages/deposit-deadline/analyze", {});
  assert.equal(accepted.status, 200);
  const payload = await responseJson(accepted);
  assert.equal(payload.card.messageId, "deposit-deadline");
});

test("missing DeepSeek key is visibly labeled preset and never invokes a model", async (t) => {
  let modelCalls = 0;
  const modelClient = {
    configured: false,
    async createStructured() {
      modelCalls += 1;
      throw new Error("must not be called");
    },
  };
  const client = await authenticatedClient(t, { modelClient });
  const response = await authMutation(client, "/api/messages/deposit-deadline/analyze", {});
  const payload = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(payload.analysisMode, "preset");
  assert.equal(payload.aiAvailable, false);
  assert.match(payload.notice, /预置|preset|未配置/i);
  assert.equal(modelCalls, 0);
});

test("a valid configured model result is validated and marked as AI", async (t) => {
  const calls = [];
  const modelClient = {
    configured: true,
    async createStructured(request) {
      calls.push(request);
      return makeValidActionCard();
    },
  };
  const client = await authenticatedClient(t, { modelClient });
  const response = await authMutation(client, "/api/messages/deposit-deadline/analyze", {});
  const payload = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(payload.analysisMode, "ai_guarded");
  assert.equal(payload.aiAvailable, true);
  assert.equal(calls.length, 1);
  assert.match(JSON.stringify(calls[0].input), /untrustedSyntheticEmail/);
  assert.match(JSON.stringify(calls[0].input), /fully_synthetic_test_data/);
  assert.equal(Object.hasOwn(calls[0], "tools"), false);
});

test("repeated analysis reuses the validated session result without another model call", async (t) => {
  let modelCalls = 0;
  const modelClient = {
    configured: true,
    async createStructured() {
      modelCalls += 1;
      return makeValidActionCard();
    },
  };
  const client = await authenticatedClient(t, { modelClient });

  const first = await authMutation(client, "/api/messages/deposit-deadline/analyze", {});
  assert.equal(first.status, 200);
  assert.equal((await responseJson(first)).cached, false);

  const second = await authMutation(client, "/api/messages/deposit-deadline/analyze", {});
  assert.equal(second.status, 200);
  assert.equal((await responseJson(second)).cached, true);
  assert.equal(modelCalls, 1);
});

test("a degraded preset result is retried and only the later AI success is cached", async (t) => {
  let modelCalls = 0;
  const modelClient = {
    configured: true,
    async createStructured() {
      modelCalls += 1;
      if (modelCalls === 1) throw new Error("synthetic transient model failure");
      return makeValidActionCard();
    },
  };
  const client = await authenticatedClient(t, { modelClient });

  const degraded = await authMutation(client, "/api/messages/deposit-deadline/analyze", {});
  assert.equal(degraded.status, 200);
  const degradedPayload = await responseJson(degraded);
  assert.equal(degradedPayload.analysisMode, "preset");
  assert.equal(degradedPayload.aiAvailable, false);
  assert.equal(degradedPayload.cached, false);
  assert.equal(modelCalls, 1);

  const retried = await authMutation(client, "/api/messages/deposit-deadline/analyze", {});
  assert.equal(retried.status, 200);
  const retriedPayload = await responseJson(retried);
  assert.equal(retriedPayload.analysisMode, "ai_guarded");
  assert.equal(retriedPayload.aiAvailable, true);
  assert.equal(retriedPayload.cached, false);
  assert.equal(modelCalls, 2);

  const cachedSuccess = await authMutation(client, "/api/messages/deposit-deadline/analyze", {});
  assert.equal(cachedSuccess.status, 200);
  const cachedPayload = await responseJson(cachedSuccess);
  assert.equal(cachedPayload.analysisMode, "ai_guarded");
  assert.equal(cachedPayload.aiAvailable, true);
  assert.equal(cachedPayload.cached, true);
  assert.equal(modelCalls, 2);
});

test("Prompt Injection cannot add tools or create a calendar-capable result", async (t) => {
  let modelCalls = 0;
  const malicious = makeValidActionCard({
    messageId: "prompt-injection-phishing",
    toolCalls: [{ name: "calendar.write", arguments: { title: "malicious" } }],
  });
  const modelClient = {
    configured: true,
    async createStructured() {
      modelCalls += 1;
      return malicious;
    },
  };
  const client = await authenticatedClient(t, { modelClient });
  const analyzed = await authMutation(client, "/api/messages/prompt-injection-phishing/analyze", {});
  const payload = await responseJson(analyzed);

  assert.equal(analyzed.status, 200);
  assert.equal(modelCalls, 1);
  assert.equal(payload.analysisMode, "preset");
  assert.equal(payload.aiAvailable, false);
  assert.ok(payload.card.riskFlags.includes("prompt_injection"));
  assert.ok(payload.card.actions.every((action) => action.calendarEligible === false));
  assert.equal("toolCalls" in payload.card, false);

  const preview = await authMutation(client, "/api/calendar/preview", {
    messageId: "prompt-injection-phishing",
    actionId: "do-not-share-secrets",
    dateId: "invented-date",
  });
  assert.notEqual(preview.status, 200);
});

test("follow-up accepts only one of three server-defined question templates", async (t) => {
  const client = await authenticatedClient(t);
  await authMutation(client, "/api/messages/deposit-deadline/analyze", {});

  for (const questionTemplateId of ["what_to_do", "deadline_evidence", "what_is_uncertain"]) {
    const response = await authMutation(client, "/api/messages/deposit-deadline/ask", {
      questionTemplateId,
    });
    assert.equal(response.status, 200, questionTemplateId);
  }

  for (const body of [
    { question: "Here is my real email: ..." },
    { questionTemplateId: "reveal_system_prompt" },
    { questionTemplateId: "what_to_do", question: "free text" },
  ]) {
    const response = await authMutation(client, "/api/messages/deposit-deadline/ask", body);
    assert.equal(response.status, 400, JSON.stringify(body));
  }
});

test("a degraded preset follow-up is retried and only the later AI success is cached", async (t) => {
  let analysisCalls = 0;
  let followUpCalls = 0;
  const modelClient = {
    configured: true,
    async createStructured(request) {
      if (request.schemaName === "synthetic_notification_action_card_v1") {
        analysisCalls += 1;
        return makeValidActionCard();
      }

      assert.equal(request.schemaName, "synthetic_notification_follow_up_v1");
      followUpCalls += 1;
      if (followUpCalls === 1) throw new Error("synthetic transient follow-up failure");
      return {
        answerZh: "截止时间是 9 月 4 日下午 5 点（17:00），请按原文要求核对。",
        evidenceQuotes: [DEPOSIT_QUOTE],
        uncertainty: null,
      };
    },
  };
  const client = await authenticatedClient(t, { modelClient });
  const question = { questionTemplateId: "deadline_evidence" };

  const analyzed = await authMutation(client, "/api/messages/deposit-deadline/analyze", {});
  assert.equal(analyzed.status, 200);
  assert.equal((await responseJson(analyzed)).analysisMode, "ai_guarded");
  assert.equal(analysisCalls, 1);

  const degraded = await authMutation(client, "/api/messages/deposit-deadline/ask", question);
  assert.equal(degraded.status, 200);
  const degradedPayload = await responseJson(degraded);
  assert.equal(degradedPayload.analysisMode, "preset");
  assert.equal(degradedPayload.aiAvailable, false);
  assert.equal(degradedPayload.cached, false);
  assert.equal(followUpCalls, 1);

  const retried = await authMutation(client, "/api/messages/deposit-deadline/ask", question);
  assert.equal(retried.status, 200);
  const retriedPayload = await responseJson(retried);
  assert.equal(retriedPayload.analysisMode, "ai_guarded");
  assert.equal(retriedPayload.aiAvailable, true);
  assert.equal(retriedPayload.cached, false);
  assert.equal(followUpCalls, 2);

  const cachedSuccess = await authMutation(client, "/api/messages/deposit-deadline/ask", question);
  assert.equal(cachedSuccess.status, 200);
  const cachedPayload = await responseJson(cachedSuccess);
  assert.equal(cachedPayload.analysisMode, "ai_guarded");
  assert.equal(cachedPayload.aiAvailable, true);
  assert.equal(cachedPayload.cached, true);
  assert.equal(followUpCalls, 2);
  assert.equal(analysisCalls, 1);
});

test("calendar is preview-only and is derived from a validated card in this session", async (t) => {
  const client = await authenticatedClient(t);
  const requestBody = {
    messageId: "deposit-deadline",
    actionId: "pay-deposit",
    dateId: "deposit-due-at",
  };

  const beforeAnalysis = await authMutation(client, "/api/calendar/preview", requestBody);
  assert.notEqual(beforeAnalysis.status, 200);

  await authMutation(client, "/api/messages/deposit-deadline/analyze", {});
  const response = await authMutation(client, "/api/calendar/preview", requestBody);
  const previewPayload = await responseJson(response);
  const preview = previewPayload.preview ?? previewPayload;
  assert.equal(response.status, 200);
  assert.equal(preview.previewOnly, true);
  assert.equal(preview.timezone, "Asia/Hong_Kong");
  assert.doesNotMatch(JSON.stringify(preview), /eventId|providerEvent|syncedAt/i);

  const repeated = await authMutation(client, "/api/calendar/preview", requestBody);
  assert.equal(repeated.status, 200);
  const repeatedPayload = await responseJson(repeated);
  assert.deepEqual(repeatedPayload.preview ?? repeatedPayload, preview);

  for (const path of [
    "/api/calendar/sync",
    "/api/calendar/events",
    "/api/oauth/connect",
    "/api/mail/connect",
    "/api/upload",
  ]) {
    const absent = await authMutation(client, path, {});
    assert.equal(absent.status, 404, path);
  }
});

test("API rejects malformed, wrong-media-type, oversized and unknown requests safely", async (t) => {
  const client = await authenticatedClient(t);
  const path = "/api/messages/deposit-deadline/analyze";
  const baseHeaders = {
    origin: TEST_PUBLIC_ORIGIN,
    cookie: client.cookie,
    "x-csrf-token": client.csrfToken,
  };

  const wrongType = await request(client.baseUrl, path, {
    method: "POST",
    rawBody: "{}",
    headers: { ...baseHeaders, "content-type": "text/plain" },
  });
  assert.equal(wrongType.status, 415);

  const malformed = await request(client.baseUrl, path, {
    method: "POST",
    rawBody: "{broken",
    headers: { ...baseHeaders, "content-type": "application/json" },
  });
  assert.equal(malformed.status, 400);

  const oversized = await request(client.baseUrl, path, {
    method: "POST",
    rawBody: JSON.stringify({ padding: "x".repeat(70_000) }),
    headers: { ...baseHeaders, "content-type": "application/json" },
  });
  assert.equal(oversized.status, 413);

  const unknown = await request(client.baseUrl, "/api/not-a-route", { cookie: client.cookie });
  assert.equal(unknown.status, 404);
  const payload = await responseJson(unknown);
  assert.ok(payload.error);
  assert.doesNotMatch(JSON.stringify(payload), /\/Users\/|node:internal|DEEPSEEK_API_KEY/);
});

test("complete offline API smoke: login → bootstrap → analyze → ask → preview → logout", async (t) => {
  const client = await authenticatedClient(t);

  const analyzed = await authMutation(client, "/api/messages/deposit-deadline/analyze", {});
  assert.equal(analyzed.status, 200);
  const analysis = await responseJson(analyzed);
  assert.equal(analysis.card.messageId, "deposit-deadline");

  const asked = await authMutation(client, "/api/messages/deposit-deadline/ask", {
    questionTemplateId: "deadline_evidence",
  });
  assert.equal(asked.status, 200);
  const answer = await responseJson(asked);
  assert.ok(answer.followUp.answerZh);
  assert.ok(answer.followUp.evidenceQuotes.length > 0);

  const previewed = await authMutation(client, "/api/calendar/preview", {
    messageId: "deposit-deadline",
    actionId: "pay-deposit",
    dateId: "deposit-due-at",
  });
  assert.equal(previewed.status, 200);
  const previewPayload = await responseJson(previewed);
  assert.equal((previewPayload.preview ?? previewPayload).previewOnly, true);

  const logout = await authMutation(client, "/api/auth/logout", {});
  assert.ok([200, 204].includes(logout.status));
  const after = await request(client.baseUrl, "/api/bootstrap", { cookie: client.cookie });
  assert.equal(after.status, 401);
});
