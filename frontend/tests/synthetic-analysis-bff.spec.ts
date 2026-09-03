import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createDemoAccessStore } from "../features/invite-access/server/demo-access-store";
import {
  demoSessionCookieName,
  validatedDemoSessionScopeDigest,
} from "../features/invite-access/server/demo-session-scope";
import {
  handleSyntheticAnalysisGet,
  handleSyntheticAnalysisPost,
  type SyntheticAnalysisBffDependencies,
} from "../features/action-center/server/synthetic-analysis-bff";
import {
  ProductApiClientError,
  requestProductApi,
} from "../features/action-center/server/product-api-client";
import { phase2aoTask, phase2aoTaskId } from "./phase2ao-test-fixtures";

const productConfig = {
  baseUrl: "http://127.0.0.1:43123",
  token: "internal-test-product-token",
} as const;
const fixedSessionToken =
  "fixed-bff-session-token-that-is-longer-than-thirty-two-bytes";

function sessionDependencies(
  requestProduct: typeof requestProductApi,
): SyntheticAnalysisBffDependencies {
  return sessionFixture(requestProduct).dependencies;
}

function sessionFixture(requestProduct: typeof requestProductApi) {
  const store = createDemoAccessStore({
    inviteCode: "PHASE2AO-BFF-TEST",
    createToken: () => fixedSessionToken,
    now: () => Date.parse("2026-09-01T09:00:00+08:00"),
  });
  const redemption = store.redeemInvite("PHASE2AO-BFF-TEST", "client");
  if (!redemption.ok) throw new Error("test invite must redeem");
  return {
    store,
    dependencies: {
      resolveProductConfig: () => productConfig,
      requestProduct,
      resolveSessionScope: (token: string | undefined) =>
        validatedDemoSessionScopeDigest(token, store),
    } satisfies SyntheticAnalysisBffDependencies,
  };
}

function postRequest(options: Readonly<{
  origin?: string;
  body?: unknown;
  idempotencyKey?: string;
  sessionToken?: string;
}> = {}): NextRequest {
  const origin = options.origin ?? "http://127.0.0.1:3000";
  const headers = new Headers({
    "Content-Type": "application/json",
    Host: "127.0.0.1:3000",
    Origin: origin,
    "Sec-Fetch-Site":
      origin === "http://127.0.0.1:3000" ? "same-origin" : "cross-site",
    "Idempotency-Key":
      options.idempotencyKey ??
      "22222222-2222-4222-8222-222222222222",
  });
  if (options.sessionToken !== undefined) {
    headers.set(
      "Cookie",
      `${demoSessionCookieName}=${options.sessionToken}`,
    );
  }
  return new NextRequest(
    "http://127.0.0.1:3000/api/v2/synthetic/analysis-tasks",
    {
      method: "POST",
      headers,
      body: JSON.stringify(
        options.body ?? {
          contractVersion: "synthetic-analysis-request/v1",
          caseId: "DEV001",
        },
      ),
    },
  );
}

function getRequest(sessionToken?: string): NextRequest {
  const headers = new Headers();
  if (sessionToken !== undefined) {
    headers.set(
      "Cookie",
      `${demoSessionCookieName}=${sessionToken}`,
    );
  }
  return new NextRequest(
    `http://127.0.0.1:3000/api/v2/synthetic/analysis-tasks/${phase2aoTaskId}`,
    { method: "GET", headers },
  );
}

describe("Synthetic analysis BFF boundary", () => {
  it("rejects cross-site POST before reading session or forwarding", async () => {
    const requestProduct = vi.fn<typeof requestProductApi>();
    const response = await handleSyntheticAnalysisPost(
      postRequest({ origin: "https://attacker.invalid" }),
      sessionDependencies(requestProduct),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(requestProduct).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "REQUEST_REJECTED" },
    });
  });

  it("requires an independently valid invite session", async () => {
    const requestProduct = vi.fn<typeof requestProductApi>();
    const response = await handleSyntheticAnalysisPost(
      postRequest(),
      sessionDependencies(requestProduct),
    );
    expect(response.status).toBe(401);
    expect(requestProduct).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      contractVersion: "synthetic-analysis-error/v1",
      error: { code: "DEMO_SESSION_INVALID", retryable: false },
    });
  });

  it("forwards only a digest scope and never the raw session cookie", async () => {
    const requestProduct = vi
      .fn<typeof requestProductApi>()
      .mockResolvedValue({
        ok: true,
        status: 202,
        body: phase2aoTask("queued"),
      });
    const response = await handleSyntheticAnalysisPost(
      postRequest({ sessionToken: fixedSessionToken }),
      sessionDependencies(requestProduct),
    );

    expect(response.status).toBe(202);
    expect(requestProduct).toHaveBeenCalledTimes(1);
    const forwarded = requestProduct.mock.calls[0]?.[0];
    expect(forwarded?.sessionScopeDigest).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
    expect(JSON.stringify(forwarded)).not.toContain(fixedSessionToken);
    expect(forwarded).not.toHaveProperty("cookie");
  });

  it.each([
    {
      label: "extra body",
      request: () =>
        postRequest({
          sessionToken: fixedSessionToken,
          body: {
            contractVersion: "synthetic-analysis-request/v1",
            caseId: "DEV001",
            prompt: "not allowed",
          },
        }),
    },
    {
      label: "oversized body",
      request: () =>
        postRequest({
          sessionToken: fixedSessionToken,
          body: {
            contractVersion: "synthetic-analysis-request/v1",
            caseId: "DEV001",
            padding: "x".repeat(5_000),
          },
        }),
    },
    {
      label: "bad Idempotency-Key",
      request: () =>
        postRequest({
          sessionToken: fixedSessionToken,
          idempotencyKey: "not-a-uuid",
        }),
    },
  ])("rejects $label before Product API fetch", async ({ request }) => {
    const requestProduct = vi.fn<typeof requestProductApi>();
    const response = await handleSyntheticAnalysisPost(
      request(),
      sessionDependencies(requestProduct),
    );
    expect(response.status).toBe(400);
    expect(requestProduct).not.toHaveBeenCalled();
  });

  it("maps an unknown/leaking upstream response to a 502 safe envelope", async () => {
    const requestProduct = vi
      .fn<typeof requestProductApi>()
      .mockRejectedValue(
        new ProductApiClientError(
          "PRODUCT_API_RESPONSE_INVALID",
          "upstream leaked Candidate and an internal path",
        ),
      );
    const response = await handleSyntheticAnalysisPost(
      postRequest({ sessionToken: fixedSessionToken }),
      sessionDependencies(requestProduct),
    );
    const serialized = JSON.stringify(await response.json());
    expect(response.status).toBe(502);
    expect(serialized).toContain("PRODUCT_API_RESPONSE_INVALID");
    expect(serialized).not.toContain("Candidate");
    expect(serialized).not.toContain("internal path");
  });

  it("guards GET by session and safely passes through a scoped 404", async () => {
    const requestProduct = vi
      .fn<typeof requestProductApi>()
      .mockResolvedValue({
        ok: false,
        status: 404,
        body: {
          contractVersion: "synthetic-analysis-error/v1",
          error: {
            code: "TASK_NOT_FOUND",
            message: "没有找到这次合成分析任务。",
            retryable: false,
          },
        },
      });
    const dependencies = sessionDependencies(requestProduct);

    const invalidSessionResponse = await handleSyntheticAnalysisGet(
      getRequest(),
      phase2aoTaskId,
      dependencies,
    );
    expect(invalidSessionResponse.status).toBe(401);
    expect(requestProduct).not.toHaveBeenCalled();

    const notFoundResponse = await handleSyntheticAnalysisGet(
      getRequest(fixedSessionToken),
      phase2aoTaskId,
      dependencies,
    );
    expect(notFoundResponse.status).toBe(404);
    await expect(notFoundResponse.json()).resolves.toMatchObject({
      error: { code: "TASK_NOT_FOUND", retryable: false },
    });
  });

  it("denies an existing task after its owning invite session is revoked", async () => {
    const requestProduct = vi
      .fn<typeof requestProductApi>()
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        body: phase2aoTask("queued"),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: phase2aoTask("succeeded"),
      });
    const { dependencies, store } = sessionFixture(requestProduct);

    const createdResponse = await handleSyntheticAnalysisPost(
      postRequest({ sessionToken: fixedSessionToken }),
      dependencies,
    );
    expect(createdResponse.status).toBe(202);

    const ownedResponse = await handleSyntheticAnalysisGet(
      getRequest(fixedSessionToken),
      phase2aoTaskId,
      dependencies,
    );
    expect(ownedResponse.status).toBe(200);
    await expect(ownedResponse.json()).resolves.toMatchObject({
      taskId: phase2aoTaskId,
      status: "succeeded",
    });
    expect(requestProduct).toHaveBeenCalledTimes(2);

    expect(store.revokeSession(fixedSessionToken)).toBe(true);
    const revokedResponse = await handleSyntheticAnalysisGet(
      getRequest(fixedSessionToken),
      phase2aoTaskId,
      dependencies,
    );
    expect(revokedResponse.status).toBe(401);
    expect(revokedResponse.headers.get("cache-control")).toBe("no-store");
    expect(requestProduct).toHaveBeenCalledTimes(2);

    const revokedBody = await revokedResponse.json();
    expect(revokedBody).toEqual({
      contractVersion: "synthetic-analysis-error/v1",
      error: {
        code: "DEMO_SESSION_INVALID",
        message: "邀请码会话已失效。",
        retryable: false,
      },
    });
    const serialized = JSON.stringify(revokedBody);
    expect(serialized).not.toContain(phase2aoTaskId);
    expect(serialized).not.toContain("DEV-NOTIF-PAIR-01");
    expect(serialized).not.toContain("resource");
  });
});
