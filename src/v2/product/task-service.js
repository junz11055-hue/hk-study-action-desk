import { validateActionCardV02 } from "./action-card-v02.js";
import { validatePhase2aoCandidate } from "./candidate-validation.js";
import {
  assertPhase2aoAnalysisRequest,
  assertPhase2aoTaskDto,
  PHASE2AO_ANALYSIS_TASK_VERSION,
  PHASE2AO_EXECUTION_MODES,
} from "./contracts.js";
import { buildPhase2aoActionCard } from "./deterministic-harness.js";
import { createPhase2aoOfflineAnalyzer } from "./offline-analyzers.js";
import { PHASE2AO_CONTRACT_BUNDLE_HASH } from "./product-contract-manifest.js";
import { loadPhase2aoProductInput } from "./product-input-loader.js";
import { hashCanonicalJson } from "../validation/canonical-json.js";

const DEFAULT_EXECUTION_TIMEOUT_MS = 10_000;
const POLL_AFTER_MS = 250;

const SAFE_FAILURES = Object.freeze({
  product_input: Object.freeze({
    code: "PRODUCT_INPUT_REJECTED",
    message: "合成输入未通过完整性校验，任务已安全停止。",
    retryable: false,
  }),
  analyzer: Object.freeze({
    code: "ANALYZER_FAILED",
    message: "AI 分析器未能生成可校验结果，任务已安全停止。",
    retryable: true,
  }),
  candidate: Object.freeze({
    code: "CANDIDATE_VALIDATION_FAILED",
    message: "AI 候选结果未通过冻结合同校验，无法安全展示。",
    retryable: false,
  }),
  harness: Object.freeze({
    code: "ACTION_CARD_PROJECTION_FAILED",
    message: "候选结果无法通过确定性产品规则生成行动卡。",
    retryable: false,
  }),
  timeout: Object.freeze({
    code: "TASK_EXECUTION_TIMEOUT",
    message: "合成分析任务执行超时，未使用旧结果或固定结果替代。",
    retryable: true,
  }),
  unknown: Object.freeze({
    code: "TASK_EXECUTION_FAILED",
    message: "合成分析任务未能安全完成。",
    retryable: true,
  }),
});

export class Phase2aoTaskServiceError extends Error {
  constructor(code, message, { statusCode = 500, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "Phase2aoTaskServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function freezeJson(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeJson(child);
  }
  return value;
}

function taskDto(task, { cached }) {
  const active = task.status === "queued" || task.status === "running";
  const dto = {
    contractVersion: PHASE2AO_ANALYSIS_TASK_VERSION,
    taskId: task.taskId,
    caseId: task.caseId,
    executionMode: task.executionMode,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    finishedAt: task.finishedAt,
    cached,
    pollAfterMs: active ? POLL_AFTER_MS : null,
    resource: task.resource === null ? null : structuredClone(task.resource),
    error: task.error === null ? null : structuredClone(task.error),
  };
  assertPhase2aoTaskDto(dto, { validateActionCard: validateActionCardV02 });
  return freezeJson(dto);
}

function failureKind(error) {
  const name = error?.name;
  if (name === "Phase2aoProductInputError") return "product_input";
  if (name === "Phase2aoAnalyzerError") return "analyzer";
  if (name === "Phase2alLiveAnalyzerError") return "analyzer";
  if (name === "Phase2aoCandidateGateError") return "candidate";
  if (
    name === "Phase2aoHarnessError" ||
    name === "Phase2aoActionCardValidationError"
  ) {
    return "harness";
  }
  if (name === "Phase2aoExecutionTimeoutError") return "timeout";
  return "unknown";
}

function safeFailure(error) {
  return structuredClone(SAFE_FAILURES[failureKind(error)]);
}

function isoNow(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("clock must return a valid date");
  }
  return date.toISOString();
}

async function withTimeout(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error("Phase 2A-O task execution timed out");
          error.name = "Phase2aoExecutionTimeoutError";
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function assertStore(store) {
  for (const method of ["reserve", "markRunning", "succeed", "fail", "get"]) {
    if (typeof store?.[method] !== "function") {
      throw new TypeError(`taskStore.${method} must be a function`);
    }
  }
}

/**
 * Compose the Product chain. Provider access, when separately authorized, is
 * isolated behind an injected Analyzer; this module owns no environment or
 * transport access and never provides a fallback Candidate.
 */
export function createPhase2aoTaskService({
  taskStore,
  executionMode,
  analyzer = undefined,
  loadProductInput = loadPhase2aoProductInput,
  validateCandidate = validatePhase2aoCandidate,
  buildActionCard = buildPhase2aoActionCard,
  validateActionCard = validateActionCardV02,
  contractBundleHash = PHASE2AO_CONTRACT_BUNDLE_HASH,
  clock = () => new Date(),
  schedule = (job) => setImmediate(job),
  executionTimeoutMs = DEFAULT_EXECUTION_TIMEOUT_MS,
} = {}) {
  assertStore(taskStore);
  if (!PHASE2AO_EXECUTION_MODES.includes(executionMode)) {
    throw new Phase2aoTaskServiceError(
      "EXECUTION_MODE_NOT_ALLOWED",
      "The Product task execution mode is not approved.",
      { statusCode: 500 },
    );
  }
  if (executionMode === "live_model" && analyzer === undefined) {
    throw new Phase2aoTaskServiceError(
      "LIVE_ANALYZER_REQUIRED",
      "Live mode requires an explicitly authorized Analyzer.",
      { statusCode: 500 },
    );
  }
  const selectedAnalyzer =
    analyzer ?? createPhase2aoOfflineAnalyzer({ executionMode });
  if (
    selectedAnalyzer?.executionMode !== executionMode ||
    typeof selectedAnalyzer.analyze !== "function" ||
    typeof loadProductInput !== "function" ||
    typeof validateCandidate !== "function" ||
    typeof buildActionCard !== "function" ||
    typeof validateActionCard !== "function" ||
    typeof clock !== "function" ||
    typeof schedule !== "function" ||
    !Number.isInteger(executionTimeoutMs) ||
    executionTimeoutMs < 1 ||
    executionTimeoutMs > 120_000 ||
    (executionMode === "live_model" && executionTimeoutMs < 90_000)
  ) {
    throw new TypeError("Phase 2A-O task service dependencies are invalid");
  }

  const pending = new Set();

  async function recordTaskTerminal(value) {
    if (typeof selectedAnalyzer.recordTaskTerminal !== "function") return;
    try {
      await selectedAnalyzer.recordTaskTerminal(value);
    } catch {
      // The Product task remains authoritative. Missing private run evidence
      // makes the later live acceptance fail, but must not rewrite a terminal.
    }
  }

  async function execute(taskId, caseId) {
    try {
      await taskStore.markRunning(taskId);
      const result = await withTimeout(
        (async () => {
          const productInput = await loadProductInput({ caseId });
          const analyzed = await selectedAnalyzer.analyze({
            caseId,
            modelInput: productInput.modelInput,
            taskId,
          });
          if (analyzed?.executionMode !== executionMode) {
            const error = new Error("Analyzer execution mode drifted");
            error.name = "Phase2aoAnalyzerError";
            throw error;
          }
          const accepted = validateCandidate(
            analyzed.candidate,
            productInput.modelInput,
          );
          const analyzedAt = isoNow(clock);
          const card = buildActionCard({
            productInput,
            candidate: accepted.candidate,
            validationEvidence: accepted.validationEvidence,
            executionMode,
            analyzedAt,
          });
          validateActionCard(card);
          return { candidateHash: accepted.candidateHash, card };
        })(),
        executionTimeoutMs,
      );
      await taskStore.succeed(taskId, result);
      await recordTaskTerminal({
        taskId,
        status: "succeeded",
        candidateHash: result.candidateHash,
        actionCardHash: hashCanonicalJson(result.card),
        errorCode: null,
      });
    } catch (error) {
      const failure = safeFailure(error);
      await taskStore.fail(taskId, failure).catch(() => undefined);
      await recordTaskTerminal({
        taskId,
        status: "failed",
        candidateHash: null,
        actionCardHash: null,
        errorCode: failure.code,
      });
    }
  }

  function enqueue(taskId, caseId) {
    let settle;
    const work = new Promise((resolve) => {
      settle = resolve;
    });
    pending.add(work);
    try {
      schedule(() => {
        Promise.resolve(execute(taskId, caseId)).then(settle, settle);
      });
    } catch (error) {
      Promise.resolve(taskStore.fail(taskId, safeFailure(error))).then(
        settle,
        settle,
      );
    }
    void work.finally(() => pending.delete(work));
  }

  return Object.freeze({
    executionMode,

    async submit({ sessionScopeDigest, idempotencyKey, request } = {}) {
      try {
        assertPhase2aoAnalysisRequest(request);
      } catch (cause) {
        throw new Phase2aoTaskServiceError(
          "SYNTHETIC_ANALYSIS_REQUEST_INVALID",
          "Only the fixed DEV001 synthetic request is accepted.",
          { statusCode: 400, cause },
        );
      }
      let reserved;
      try {
        reserved = await taskStore.reserve({
          sessionScopeDigest,
          idempotencyKey,
          caseId: request.caseId,
          executionMode,
          contractBundleHash,
        });
      } catch (cause) {
        const invalid = cause?.code === "task_reservation_invalid";
        throw new Phase2aoTaskServiceError(
          invalid ? "SYNTHETIC_ANALYSIS_REQUEST_INVALID" : "TASK_STORE_UNAVAILABLE",
          invalid
            ? "The task reservation fields are invalid."
            : "The task store could not reserve the request.",
          { statusCode: invalid ? 400 : 503, cause },
        );
      }
      if (reserved.created) {
        enqueue(reserved.task.taskId, reserved.task.caseId);
      }
      return Object.freeze({
        statusCode: reserved.created ? 202 : 200,
        task: taskDto(reserved.task, { cached: reserved.cached }),
      });
    },

    async getTask({ taskId, sessionScopeDigest } = {}) {
      let task;
      try {
        task = await taskStore.get(taskId, sessionScopeDigest);
      } catch (cause) {
        throw new Phase2aoTaskServiceError(
          "TASK_STORE_UNAVAILABLE",
          "The task store could not read the request.",
          { statusCode: 503, cause },
        );
      }
      return task === null ? null : taskDto(task, { cached: true });
    },

    async drain() {
      while (pending.size > 0) {
        await Promise.all([...pending]);
      }
    },
  });
}
