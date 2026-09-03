import { hashCanonicalJson } from "../validation/canonical-json.js";

export const PHASE2AO_ANALYSIS_REQUEST_VERSION =
  "synthetic-analysis-request/v1";
export const PHASE2AO_ANALYSIS_TASK_VERSION = "synthetic-analysis-task/v1";
export const PHASE2AO_ANALYSIS_ERROR_VERSION = "synthetic-analysis-error/v1";
export const PHASE2AO_HARNESS_POLICY_VERSION = "product-harness-policy-v1";
export const PHASE2AO_ACTION_CARD_VERSION = "action-card-view-model/v0.2";

export const PHASE2AO_EXECUTION_MODES = Object.freeze([
  "synthetic_mock",
  "captured_replay",
  "live_model",
]);
export const PHASE2AO_OFFLINE_EXECUTION_MODES = Object.freeze([
  "synthetic_mock",
  "captured_replay",
]);
export const PHASE2AO_TASK_STATUSES = Object.freeze([
  "queued",
  "running",
  "succeeded",
  "failed",
  "stale",
]);

export const PHASE2AO_TASK_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const PHASE2AO_IDEMPOTENCY_KEY_PATTERN = PHASE2AO_TASK_ID_PATTERN;
export const PHASE2AO_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
export const PHASE2AO_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;

export const PHASE2AO_REQUEST_CONTRACT_DESCRIPTOR = Object.freeze({
  contractVersion: PHASE2AO_ANALYSIS_REQUEST_VERSION,
  additionalProperties: false,
  fields: Object.freeze({
    contractVersion: Object.freeze({ const: PHASE2AO_ANALYSIS_REQUEST_VERSION }),
    caseId: Object.freeze({ const: "DEV001" }),
  }),
});

export const PHASE2AO_TASK_CONTRACT_DESCRIPTOR = Object.freeze({
  contractVersion: PHASE2AO_ANALYSIS_TASK_VERSION,
  additionalProperties: false,
  executionModes: PHASE2AO_EXECUTION_MODES,
  statuses: PHASE2AO_TASK_STATUSES,
  rootFields: Object.freeze([
    "contractVersion",
    "taskId",
    "caseId",
    "executionMode",
    "status",
    "createdAt",
    "updatedAt",
    "finishedAt",
    "cached",
    "pollAfterMs",
    "resource",
    "error",
  ]),
  successResourceFields: Object.freeze(["status", "card", "error"]),
  successResourceStatuses: Object.freeze(["succeeded"]),
  successCardConstraints: Object.freeze({
    notificationId: "DEV-NOTIF-PAIR-01",
    provenanceSourceModeMatchesExecutionMode: true,
  }),
  safeErrorFields: Object.freeze(["code", "message", "retryable"]),
});

export const PHASE2AO_REQUEST_CONTRACT_HASH =
  "sha256:49b946e77b9d0df9b3e8dc5ec362e1079656caa6927058b4230c48df77b53cc3";
export const PHASE2AO_TASK_CONTRACT_HASH =
  "sha256:6199ff27df0d48cbff1ade48a6d27296f621582a09ea3e3cd153f1d31c52eef5";
if (
  hashCanonicalJson(PHASE2AO_REQUEST_CONTRACT_DESCRIPTOR) !==
    PHASE2AO_REQUEST_CONTRACT_HASH ||
  hashCanonicalJson(PHASE2AO_TASK_CONTRACT_DESCRIPTOR) !==
    PHASE2AO_TASK_CONTRACT_HASH
) {
  throw new TypeError("Phase 2A-O public task contracts drifted");
}

export class Phase2aoContractError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "Phase2aoContractError";
    this.code = code;
  }
}

export function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

export function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

export function isRfc3339(value) {
  if (typeof value !== "string") return false;

  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u.exec(
      value,
    );
  if (match === null) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1] &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}

export function assertPhase2aoAnalysisRequest(value) {
  if (
    !hasExactKeys(value, ["contractVersion", "caseId"]) ||
    value.contractVersion !== PHASE2AO_ANALYSIS_REQUEST_VERSION ||
    value.caseId !== "DEV001"
  ) {
    throw new Phase2aoContractError(
      "invalid_request",
      "The synthetic analysis request is invalid.",
    );
  }
  return value;
}

export function assertSafeTaskError(value) {
  if (
    !hasExactKeys(value, ["code", "message", "retryable"]) ||
    !PHASE2AO_ERROR_CODE_PATTERN.test(value.code ?? "") ||
    typeof value.message !== "string" ||
    value.message.trim().length < 1 ||
    value.message.length > 300 ||
    typeof value.retryable !== "boolean"
  ) {
    throw new Phase2aoContractError(
      "invalid_safe_error",
      "The task error contract is invalid.",
    );
  }
  return value;
}

export function assertPhase2aoTaskDto(value, { validateActionCard } = {}) {
  if (
    !hasExactKeys(value, PHASE2AO_TASK_CONTRACT_DESCRIPTOR.rootFields) ||
    value.contractVersion !== PHASE2AO_ANALYSIS_TASK_VERSION ||
    !PHASE2AO_TASK_ID_PATTERN.test(value.taskId ?? "") ||
    value.caseId !== "DEV001" ||
    !PHASE2AO_EXECUTION_MODES.includes(value.executionMode) ||
    !PHASE2AO_TASK_STATUSES.includes(value.status) ||
    !isRfc3339(value.createdAt) ||
    !isRfc3339(value.updatedAt) ||
    Date.parse(value.updatedAt) < Date.parse(value.createdAt) ||
    typeof value.cached !== "boolean"
  ) {
    throw new Phase2aoContractError(
      "invalid_task_dto",
      "The synthetic analysis task response is invalid.",
    );
  }

  const isPending = value.status === "queued" || value.status === "running";
  const isSuccess = value.status === "succeeded";
  const isFailure = value.status === "failed" || value.status === "stale";
  if (
    (isPending &&
      (value.finishedAt !== null ||
        value.pollAfterMs !== 250 ||
        value.resource !== null ||
        value.error !== null)) ||
    ((isSuccess || isFailure) &&
      (!isRfc3339(value.finishedAt) ||
        Date.parse(value.finishedAt) < Date.parse(value.createdAt) ||
        value.updatedAt !== value.finishedAt ||
        value.pollAfterMs !== null))
  ) {
    throw new Phase2aoContractError(
      "invalid_task_state",
      "The task state fields are inconsistent.",
    );
  }

  if (isSuccess) {
    if (
      !hasExactKeys(value.resource, ["status", "card", "error"]) ||
      value.resource.status !== "succeeded" ||
      value.resource.error !== null ||
      value.error !== null ||
      typeof validateActionCard !== "function"
    ) {
      throw new Phase2aoContractError(
        "invalid_task_resource",
        "A successful task must contain one valid Action Card resource.",
      );
    }
    validateActionCard(value.resource.card);
    if (
      value.resource.card.provenance.sourceMode !== value.executionMode ||
      value.resource.card.notification.id !== "DEV-NOTIF-PAIR-01"
    ) {
      throw new Phase2aoContractError(
        "invalid_task_resource_identity",
        "The successful Action Card does not belong to this DEV001 task.",
      );
    }
  }

  if (isFailure) {
    if (value.resource !== null || value.error === null) {
      throw new Phase2aoContractError(
        "invalid_task_failure",
        "A failed or stale task must contain only a safe error.",
      );
    }
    assertSafeTaskError(value.error);
  }
  return value;
}

export function safeErrorEnvelope(error) {
  assertSafeTaskError(error);
  return Object.freeze({
    contractVersion: PHASE2AO_ANALYSIS_ERROR_VERSION,
    error: Object.freeze({ ...error }),
  });
}
