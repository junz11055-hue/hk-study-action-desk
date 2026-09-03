import { describe, expect, it, vi } from "vitest";
import {
  createSyntheticAnalysisTaskClient,
  SyntheticAnalysisClientError,
} from "../features/action-center/data/synthetic-analysis-task-client";
import { phase2aoTask, phase2aoTaskId } from "./phase2ao-test-fixtures";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SyntheticAnalysisTaskClient", () => {
  it("submits only fixed DEV001 with one idempotency key", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(phase2aoTask("queued"), 202),
    );
    const client = createSyntheticAnalysisTaskClient(fetchImpl);

    await client.submit("22222222-2222-4222-8222-222222222222");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0] ?? [];
    expect(input).toBe("/api/v2/synthetic/analysis-tasks");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      contractVersion: "synthetic-analysis-request/v1",
      caseId: "DEV001",
    });
  });

  it("restores by GET and rejects a Candidate leak", async () => {
    const leaked = {
      ...phase2aoTask(),
      candidate: { title_zh: "不应进入浏览器" },
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(leaked),
    );
    const client = createSyntheticAnalysisTaskClient(fetchImpl);

    await expect(client.get(phase2aoTaskId)).rejects.toBeInstanceOf(
      SyntheticAnalysisClientError,
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/v2/synthetic/analysis-tasks/${phase2aoTaskId}`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("preserves a strict safe API error without exposing arbitrary fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          contractVersion: "synthetic-analysis-error/v1",
          error: {
            code: "PRODUCT_API_UNAVAILABLE",
            message: "本机分析服务暂时不可用。",
            retryable: true,
          },
        },
        503,
      ),
    );
    const client = createSyntheticAnalysisTaskClient(fetchImpl);

    await expect(client.get(phase2aoTaskId)).rejects.toMatchObject({
      kind: "api",
      status: 503,
      envelope: {
        error: { code: "PRODUCT_API_UNAVAILABLE", retryable: true },
      },
    });
  });
});
