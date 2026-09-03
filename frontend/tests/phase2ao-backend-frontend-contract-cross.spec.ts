import { describe, expect, it } from "vitest";
import { syntheticAnalysisTaskSchema } from "../features/action-center/model/synthetic-analysis-task";

// Test-only imports intentionally cross the deployable frontend boundary so one
// wire DTO is checked by both independently implemented runtime validators.
// @ts-expect-error -- the backend is JavaScript and intentionally has no frontend declaration.
import { validateActionCardV02 } from "../../src/v2/product/action-card-v02.js";
// @ts-expect-error -- the backend is JavaScript and intentionally has no frontend declaration.
import { validatePhase2aoCandidate } from "../../src/v2/product/candidate-validation.js";
// @ts-expect-error -- the backend is JavaScript and intentionally has no frontend declaration.
import { assertPhase2aoTaskDto } from "../../src/v2/product/contracts.js";
// @ts-expect-error -- the backend is JavaScript and intentionally has no frontend declaration.
import { buildPhase2aoActionCard } from "../../src/v2/product/deterministic-harness.js";
// @ts-expect-error -- the backend is JavaScript and intentionally has no frontend declaration.
import { createPhase2aoOfflineAnalyzer } from "../../src/v2/product/offline-analyzers.js";
import syntheticProductInput from "../../src/v2/product/fixtures/synthetic-product-input-v1.json";

const taskId = "44444444-4444-4444-8444-444444444444";
const createdAt = "2026-08-29T12:00:00+08:00";
const finishedAt = "2026-08-29T12:01:00+08:00";

function clone(value: unknown): Record<string, unknown> {
  return structuredClone(value) as Record<string, unknown>;
}

async function wireTask(executionMode: "synthetic_mock" | "captured_replay") {
  const productInput = structuredClone(syntheticProductInput);
  const analyzer = createPhase2aoOfflineAnalyzer({ executionMode });
  const analyzed = await analyzer.analyze({
    caseId: "DEV001",
    modelInput: productInput.modelInput,
  });
  const accepted = validatePhase2aoCandidate(
    analyzed.candidate,
    productInput.modelInput,
  );
  const card = buildPhase2aoActionCard({
    productInput,
    candidate: accepted.candidate,
    validationEvidence: accepted.validationEvidence,
    executionMode,
    analyzedAt: finishedAt,
  });
  const task = {
    contractVersion: "synthetic-analysis-task/v1",
    taskId,
    caseId: "DEV001",
    executionMode,
    status: "succeeded",
    createdAt,
    updatedAt: finishedAt,
    finishedAt,
    cached: false,
    pollAfterMs: null,
    resource: { status: "succeeded", card, error: null },
    error: null,
  };
  assertPhase2aoTaskDto(task, { validateActionCard: validateActionCardV02 });
  return JSON.parse(JSON.stringify(task)) as unknown;
}

function expectBothReject(task: Record<string, unknown>) {
  expect(() =>
    assertPhase2aoTaskDto(task, { validateActionCard: validateActionCardV02 }),
  ).toThrow();
  expect(syntheticAnalysisTaskSchema.safeParse(task).success).toBe(false);
}

describe("Phase 2A-O backend → frontend wire contract", () => {
  it.each(["synthetic_mock", "captured_replay"] as const)(
    "parses the real %s Harness result with both validators",
    async (executionMode) => {
      const task = await wireTask(executionMode);
      expect(syntheticAnalysisTaskSchema.safeParse(task).success).toBe(true);
    },
  );

  it("rejects partial success, provenance drift and notification identity drift on both sides", async () => {
    const partial = clone(await wireTask("synthetic_mock"));
    (partial.resource as Record<string, unknown>).status =
      "partially_succeeded";
    expectBothReject(partial);

    const provenance = clone(await wireTask("synthetic_mock"));
    provenance.executionMode = "captured_replay";
    expectBothReject(provenance);

    const identity = clone(await wireTask("synthetic_mock"));
    const card = (identity.resource as Record<string, unknown>)
      .card as Record<string, unknown>;
    (card.notification as Record<string, unknown>).id = "OTHER-NOTIFICATION";
    expectBothReject(identity);
  });

  it.each([
    ["task creation", ["createdAt"]],
    ["task update", ["updatedAt"]],
    ["task finish", ["finishedAt"]],
    ["notification sent", ["resource", "card", "notification", "sentAt"]],
    [
      "notification received",
      ["resource", "card", "notification", "receivedAt"],
    ],
    ["analysis provenance", ["resource", "card", "provenance", "analyzedAt"]],
  ] as const)(
    "rejects a nonexistent calendar date in %s on both sides",
    async (_label, path) => {
      const task = clone(await wireTask("synthetic_mock"));
      let target: Record<string, unknown> = task;
      for (const segment of path.slice(0, -1)) {
        target = target[segment] as Record<string, unknown>;
      }
      target[path.at(-1)!] = "2026-02-29T00:00:00Z";
      expectBothReject(task);
    },
  );
});
