import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error -- test-only integration import; the root Node service is JavaScript.
import { createPhase2aoOfflineAnalyzer } from "../../src/v2/product/offline-analyzers.js";
// @ts-expect-error -- test-only integration import; the root Node service is JavaScript.
import { createPhase2aoProductApi } from "../../src/v2/product/product-api.js";
// @ts-expect-error -- test-only integration import; the root Node service is JavaScript.
import { createPhase2aoTaskService } from "../../src/v2/product/task-service.js";
// @ts-expect-error -- test-only integration import; the root Node service is JavaScript.
import { createPhase2aoTaskStore } from "../../src/v2/product/task-store.js";
// @ts-expect-error -- test-only integration import; the root Node service is JavaScript.
import { loadPhase2aoProductInput } from "../../src/v2/product/product-input-loader.js";
import {
  handleSyntheticAnalysisGet,
  handleSyntheticAnalysisPost,
  type SyntheticAnalysisBffDependencies,
} from "../features/action-center/server/synthetic-analysis-bff";

const internalToken = "phase2ao-bff-http-integration-token";
const ownerToken = "owner-session-token-that-never-leaves-the-bff";
const foreignToken = "foreign-session-token-that-never-leaves-the-bff";
const ownerScope = `sha256:${"a".repeat(64)}`;
const foreignScope = `sha256:${"b".repeat(64)}`;
const idempotencyKey = "11111111-1111-4111-8111-111111111111";

type ProductApiServer = ReturnType<typeof createPhase2aoProductApi>;

const openServers = new Set<ProductApiServer>();
const temporaryDirectories = new Set<string>();

async function closeServer(server: ProductApiServer): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error: Error | undefined) =>
      error === undefined ? resolve() : reject(error),
    );
  });
}

async function listenLoopback(server: ProductApiServer): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Product API did not bind a random loopback port.");
  }
  return `http://127.0.0.1:${address.port}`;
}

function sessionScope(token: string | undefined): string | null {
  if (token === ownerToken) return ownerScope;
  if (token === foreignToken) return foreignScope;
  return null;
}

function postRequest(token: string): NextRequest {
  return new NextRequest(
    "http://127.0.0.1:3000/api/v2/synthetic/analysis-tasks",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "127.0.0.1:3000",
        Origin: "http://127.0.0.1:3000",
        "Sec-Fetch-Site": "same-origin",
        "Idempotency-Key": idempotencyKey,
        Cookie: `hkai_demo_session=${token}`,
      },
      body: JSON.stringify({
        contractVersion: "synthetic-analysis-request/v1",
        caseId: "DEV001",
      }),
    },
  );
}

function getRequest(taskId: string, token: string): NextRequest {
  return new NextRequest(
    `http://127.0.0.1:3000/api/v2/synthetic/analysis-tasks/${taskId}`,
    {
      method: "GET",
      headers: { Cookie: `hkai_demo_session=${token}` },
    },
  );
}

afterEach(async () => {
  await Promise.all([...openServers].map(closeServer));
  for (const server of openServers) {
    expect(server.listening).toBe(false);
  }
  openServers.clear();
  await Promise.all(
    [...temporaryDirectories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  temporaryDirectories.clear();
});

describe("Phase 2A-O BFF to Product API HTTP integration", () => {
  it("uses one offline Analyzer across POST, recoverable GET and session isolation", async () => {
    const directory = await realpath(
      await mkdtemp(path.join(tmpdir(), "phase2ao-bff-http-")),
    );
    temporaryDirectories.add(directory);
    const taskStore = await createPhase2aoTaskStore({ directory });
    const analyzer = createPhase2aoOfflineAnalyzer({
      executionMode: "synthetic_mock",
    });
    const taskService = createPhase2aoTaskService({
      taskStore,
      analyzer,
      executionMode: "synthetic_mock",
      clock: () => new Date("2026-09-01T00:00:01.000Z"),
      loadProductInput: ({ caseId }: { caseId: string }) =>
        loadPhase2aoProductInput({
          caseId,
          // Vite rewrites import.meta.url for test modules; keep the product
          // Loader authoritative while reading its pinned file explicitly.
          readFileImpl: () =>
            readFile(
              path.resolve(
                process.cwd(),
                "../src/v2/product/fixtures/synthetic-product-input-v1.json",
              ),
              "utf8",
            ),
        }),
    });
    const server = createPhase2aoProductApi({
      taskService,
      internalToken,
    });
    openServers.add(server);
    const baseUrl = await listenLoopback(server);
    const dependencies: SyntheticAnalysisBffDependencies = {
      resolveProductConfig: () => ({ baseUrl, token: internalToken }),
      resolveSessionScope: sessionScope,
    };

    const submittedResponse = await handleSyntheticAnalysisPost(
      postRequest(ownerToken),
      dependencies,
    );
    expect(submittedResponse.status).toBe(202);
    const submitted = (await submittedResponse.json()) as Record<
      string,
      unknown
    >;
    expect(submitted).toMatchObject({
      contractVersion: "synthetic-analysis-task/v1",
      caseId: "DEV001",
      executionMode: "synthetic_mock",
      status: "queued",
      cached: false,
    });
    const taskId = String(submitted.taskId);

    await taskService.drain();
    const restoredResponse = await handleSyntheticAnalysisGet(
      getRequest(taskId, ownerToken),
      taskId,
      dependencies,
    );
    expect(restoredResponse.status).toBe(200);
    const restored = (await restoredResponse.json()) as Record<
      string,
      unknown
    >;
    expect(restored.status, JSON.stringify(restored.error)).toBe("succeeded");
    expect(restored).toMatchObject({
      taskId,
      cached: true,
      resource: {
        status: "succeeded",
        card: {
          contractVersion: "action-card-view-model/v0.2",
          notification: { id: "DEV-NOTIF-PAIR-01" },
          provenance: {
            sourceMode: "synthetic_mock",
            harnessVerified: true,
          },
        },
      },
    });

    const replayResponse = await handleSyntheticAnalysisPost(
      postRequest(ownerToken),
      dependencies,
    );
    expect(replayResponse.status).toBe(200);
    await expect(replayResponse.json()).resolves.toMatchObject({
      taskId,
      status: "succeeded",
      cached: true,
    });
    expect(analyzer.callCount).toBe(1);

    const foreignResponse = await handleSyntheticAnalysisGet(
      getRequest(taskId, foreignToken),
      taskId,
      dependencies,
    );
    expect(foreignResponse.status).toBe(404);
    await expect(foreignResponse.json()).resolves.toMatchObject({
      error: { code: "TASK_NOT_FOUND" },
    });

    const serialized = JSON.stringify(restored);
    for (const forbidden of [
      internalToken,
      ownerToken,
      foreignToken,
      "candidateHash",
      "title_zh",
      "modelInput",
      "promptVersion",
      "/Users/",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    await closeServer(server);
    expect(server.listening).toBe(false);
  });
});
