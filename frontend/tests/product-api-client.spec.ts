import { describe, expect, it, vi } from "vitest";
import {
  requestProductApi,
} from "../features/action-center/server/product-api-client";
import { phase2aoTask, phase2aoTaskId } from "./phase2ao-test-fixtures";

const config = {
  baseUrl: "http://127.0.0.1:43123",
  token: "internal-test-token-that-is-never-returned",
} as const;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Product API client", () => {
  it("sends only internal authentication, session digest and idempotency headers", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(phase2aoTask("queued"), 202),
    );

    await requestProductApi({
      config,
      sessionScopeDigest: `sha256:${"a".repeat(64)}`,
      method: "POST",
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      body: {
        contractVersion: "synthetic-analysis-request/v1",
        caseId: "DEV001",
      },
      fetchImpl,
    });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "http://127.0.0.1:43123/api/v2/synthetic/analysis-tasks",
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("x-product-api-token")).toBe(config.token);
    expect(headers.get("x-session-scope-digest")).toBe(
      `sha256:${"a".repeat(64)}`,
    );
    expect(headers.get("idempotency-key")).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
  });

  it("fails closed when the upstream task contains an unknown field", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ ...phase2aoTask(), providerRaw: "must-not-pass" }),
    );

    await expect(
      requestProductApi({
        config,
        sessionScopeDigest: `sha256:${"b".repeat(64)}`,
        method: "GET",
        taskId: phase2aoTaskId,
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      code: "PRODUCT_API_RESPONSE_INVALID",
    });
  });

  it("fails closed when GET returns a different contextual task identity", async () => {
    const mismatchedTaskId = "33333333-3333-4333-8333-333333333333";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ ...phase2aoTask(), taskId: mismatchedTaskId }),
    );

    await expect(
      requestProductApi({
        config,
        sessionScopeDigest: `sha256:${"b".repeat(64)}`,
        method: "GET",
        taskId: phase2aoTaskId,
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      code: "PRODUCT_API_RESPONSE_INVALID",
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(phase2aoTaskId);
  });

  it("passes through only a strict safe error envelope", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          contractVersion: "synthetic-analysis-error/v1",
          error: {
            code: "TASK_NOT_FOUND",
            message: "没有找到这次合成分析任务。",
            retryable: false,
          },
        },
        404,
      ),
    );

    await expect(
      requestProductApi({
        config,
        sessionScopeDigest: `sha256:${"c".repeat(64)}`,
        method: "GET",
        taskId: phase2aoTaskId,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: 404,
      body: { error: { code: "TASK_NOT_FOUND" } },
    });
  });
});
