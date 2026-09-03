import { createPhase2aoProductApi } from "../product/product-api.js";
import { createPhase2aoTaskService } from "../product/task-service.js";
import { createPhase2aoTaskStore } from "../product/task-store.js";
import { createPhase2alLiveAnalyzer } from "./phase2al-live-analyzer.js";
import { PHASE2AL_TASK_TIMEOUT_MS } from "./phase2al-run-contract.js";

/**
 * Compose, but do not bind, the Phase 2A-L Product API. Construction does not
 * read model configuration; the lazy Analyzer reaches its authorization gate
 * only after the fixed DEV001 task is accepted by the Product Worker.
 */
export async function createPhase2alProductRuntime({
  taskDirectory,
  internalToken,
  analyzer = undefined,
  analyzerOptions = undefined,
  taskStoreOptions = undefined,
  serviceOptions = undefined,
} = {}) {
  if (typeof taskDirectory !== "string" || taskDirectory.length < 1) {
    throw new TypeError("taskDirectory is required");
  }
  const selectedAnalyzer =
    analyzer ?? createPhase2alLiveAnalyzer(analyzerOptions);
  if (selectedAnalyzer?.executionMode !== "live_model") {
    throw new TypeError("Phase 2A-L requires the Live Analyzer");
  }
  const taskStore = await createPhase2aoTaskStore({
    ...(taskStoreOptions ?? {}),
    directory: taskDirectory,
  });
  const taskService = createPhase2aoTaskService({
    ...(serviceOptions ?? {}),
    taskStore,
    executionMode: "live_model",
    analyzer: selectedAnalyzer,
    executionTimeoutMs: PHASE2AL_TASK_TIMEOUT_MS,
  });
  const server = createPhase2aoProductApi({ taskService, internalToken });
  return Object.freeze({
    executionMode: "live_model",
    analyzer: selectedAnalyzer,
    taskStore,
    taskService,
    server,
  });
}
