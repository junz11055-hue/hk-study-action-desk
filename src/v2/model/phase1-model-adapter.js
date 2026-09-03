import { randomUUID } from "node:crypto";

import {
  buildStructuredRequestBody,
  INITIAL_MAX_OUTPUT_TOKENS,
  ModelRequestError,
  TRUNCATION_RETRY_MAX_OUTPUT_TOKENS,
} from "../../agent/deepseek-responses-client.js";
import {
  CANDIDATE_SCHEMA_NAME,
  NOTIFICATION_ANALYSIS_CANDIDATE_P1_SCHEMA,
} from "../contracts/notification-analysis-candidate-p1.schema.js";
import {
  NOTIFICATION_ANALYSIS_PROMPT_P1,
  PHASE1_PROMPT_VERSION,
} from "../prompts/notification-analysis-prompt-p1.js";
import {
  canonicalJsonStringify,
  hashCanonicalJson,
  hashUtf8,
} from "../validation/canonical-json.js";
import {
  CandidateValidationError,
  validateNotificationAnalysisCandidate,
} from "../validation/candidate-validator.js";

export const PHASE1_MAX_PROVIDER_ATTEMPTS = 3;

const RETRYABLE_CANDIDATE_CODES = new Set([
  "candidate_schema_invalid",
  "candidate_reference_invalid",
  "candidate_evidence_invalid",
]);

const SAFE_ERROR_MESSAGES = Object.freeze({
  model_not_configured: "DeepSeek is not configured.",
  model_auth_failed: "DeepSeek authentication failed.",
  model_timeout: "The model request timed out.",
  model_rate_limited: "The model request was rate limited.",
  model_transport_failed: "The model transport failed.",
  model_refused: "The model refused the structured request.",
  model_response_invalid: "The model response was not valid JSON output.",
  candidate_schema_invalid: "The candidate did not match the approved schema.",
  candidate_reference_invalid: "The candidate contained an invalid reference.",
  candidate_evidence_invalid: "The candidate contained an invalid evidence locator.",
  candidate_forbidden_field: "The candidate crossed a Harness ownership boundary.",
  internal_error: "The model analysis failed internally.",
});

function isoNow(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("clock must return a valid date");
  return date.toISOString();
}

function elapsedMs(startedAt, finishedAt) {
  return Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
}

function safeCode(value) {
  if (value === "candidate_locator_invalid") return "candidate_evidence_invalid";
  if (value === "candidate_cross_field_invalid") return "candidate_schema_invalid";
  if (
    value === "candidate_secret_detected" ||
    value === "candidate_external_action_claim" ||
    value === "candidate_forbidden_action"
  ) {
    return "candidate_forbidden_field";
  }
  return Object.hasOwn(SAFE_ERROR_MESSAGES, value) ? value : "internal_error";
}

function safeMessage(code) {
  return SAFE_ERROR_MESSAGES[safeCode(code)];
}

function validationFlags(overrides = {}) {
  return {
    schema_valid: false,
    references_closed: false,
    locator_quotes_exact: false,
    forbidden_fields_absent: false,
    candidate_unchanged: false,
    ...overrides,
  };
}

function validationForFailure(code) {
  if (code === "candidate_reference_invalid") {
    return validationFlags({ schema_valid: true, forbidden_fields_absent: true });
  }
  if (code === "candidate_evidence_invalid") {
    return validationFlags({
      schema_valid: true,
      references_closed: true,
      forbidden_fields_absent: true,
    });
  }
  if (code === "candidate_forbidden_field") {
    return validationFlags();
  }
  return validationFlags();
}

function controlledRepairFeedback(error) {
  const code = safeCode(error?.code);
  let jsonPaths = Array.isArray(error?.jsonPaths)
    ? error.jsonPaths.filter((value) => typeof value === "string").slice(0, 8)
    : [];
  jsonPaths = jsonPaths.map((value) => {
    if (value.startsWith("/")) return value;
    const withoutRoot = value.replace(/^\$\.?/, "");
    return `/${withoutRoot.replace(/\[(\d+)\]/g, "/$1").replaceAll(".", "/")}`;
  });
  if (jsonPaths.length === 0) jsonPaths = ["/"];
  return {
    error_code: code,
    json_paths: jsonPaths.map((value) => value.slice(0, 200)),
    message: safeMessage(code).slice(0, 300),
  };
}

function nextRetry(error) {
  if (error?.outcome === "truncated" && error?.increaseOutputBudget) {
    return { allowed: true, kind: "truncation" };
  }
  if (error?.outcome === "invalid_json" && error?.repairable) {
    return { allowed: true, kind: "invalid_json_repair" };
  }
  if (error instanceof CandidateValidationError || RETRYABLE_CANDIDATE_CODES.has(error?.code)) {
    return {
      allowed: RETRYABLE_CANDIDATE_CODES.has(error?.code),
      kind: "candidate_repair",
    };
  }
  if (error?.retryable) {
    return {
      allowed: true,
      kind: error?.outcome === "rate_limited" ? "retry_after" : "transport",
    };
  }
  return { allowed: false, kind: null };
}

function attemptRecord({
  attempt,
  metadata,
  localStartedAt,
  localFinishedAt,
  outcome,
  retryKind,
  maxOutputTokens,
  promptHash,
  requestPayloadHash,
  errorCode = null,
}) {
  const startedAt = metadata?.startedAt ?? localStartedAt;
  const finishedAt = metadata?.finishedAt ?? localFinishedAt;
  return {
    attempt,
    started_at: startedAt,
    finished_at: finishedAt,
    outcome,
    http_status: metadata?.httpStatus ?? null,
    input_tokens: metadata?.inputTokens ?? null,
    output_tokens: metadata?.outputTokens ?? null,
    duration_ms: metadata?.durationMs ?? elapsedMs(startedAt, finishedAt),
    retry_kind: retryKind,
    max_output_tokens: maxOutputTokens,
    prompt_hash: promptHash,
    request_payload_hash: requestPayloadHash,
    error_code: errorCode,
  };
}

function actualRequestPayloadHash(metadata, fallbackHash) {
  return metadata?.requestBody
    ? hashCanonicalJson(metadata.requestBody)
    : fallbackHash;
}

export class Phase1ModelAdapterError extends Error {
  constructor(code, { attempts = [], validation = validationFlags(), candidateHash = null } = {}) {
    super(safeMessage(code));
    this.name = "Phase1ModelAdapterError";
    this.code = safeCode(code);
    this.attempts = attempts;
    this.validation = validation;
    this.candidateHash = candidateHash;
    this.attemptBudgetExhausted = attempts.length >= PHASE1_MAX_PROVIDER_ATTEMPTS;
  }
}

export async function analyzePhase1Candidate({
  executionMode,
  modelClient,
  modelInput,
  schema = NOTIFICATION_ANALYSIS_CANDIDATE_P1_SCHEMA,
  schemaName = CANDIDATE_SCHEMA_NAME,
  instructions = NOTIFICATION_ANALYSIS_PROMPT_P1,
  validateCandidate = validateNotificationAnalysisCandidate,
  clock = () => new Date(),
  sleepImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  if (!new Set(["mock", "deepseek"]).has(executionMode)) {
    throw new TypeError("executionMode must be fixed to mock or deepseek");
  }
  if (modelClient?.provider !== executionMode) {
    throw new Phase1ModelAdapterError("internal_error");
  }
  if (!modelClient?.configured) {
    throw new Phase1ModelAdapterError("model_not_configured");
  }
  if (typeof modelClient.createStructuredAttempt !== "function") {
    throw new Phase1ModelAdapterError("internal_error");
  }

  const attempts = [];
  const promptHash = hashUtf8(instructions);
  let retryKind = "initial";
  let maxOutputTokens = INITIAL_MAX_OUTPUT_TOKENS;
  let repairFeedback = null;
  let latestValidation = validationFlags();
  let latestCandidateHash = null;

  for (let index = 0; index < PHASE1_MAX_PROVIDER_ATTEMPTS; index += 1) {
    const attemptNumber = index + 1;
    const attemptInput = { ...modelInput, repair_feedback: repairFeedback };
    const serializedInput = canonicalJsonStringify(attemptInput);
    const requestBody = buildStructuredRequestBody({
      model: modelClient.model,
      instructions,
      input: serializedInput,
      schema,
      schemaName,
      maxOutputTokens,
    });
    const requestPayloadHash = hashCanonicalJson(requestBody);
    const localStartedAt = isoNow(clock);

    try {
      const response = await modelClient.createStructuredAttempt({
        instructions,
        input: serializedInput,
        schema,
        schemaName,
        maxOutputTokens,
        attemptNumber,
      });
      const candidate = response?.value;
      const candidateHashBefore = hashCanonicalJson(candidate);
      latestCandidateHash = candidateHashBefore;

      try {
        const accepted = validateCandidate(candidate, attemptInput);
        const candidateHashAfter = hashCanonicalJson(candidate);
        if (accepted !== candidate || candidateHashBefore !== candidateHashAfter) {
          throw new Phase1ModelAdapterError("internal_error", {
            attempts,
            validation: validationFlags(),
            candidateHash: candidateHashBefore,
          });
        }

        latestValidation = validationFlags({
          schema_valid: true,
          references_closed: true,
          locator_quotes_exact: true,
          forbidden_fields_absent: true,
          candidate_unchanged: true,
        });
        attempts.push(
          attemptRecord({
            attempt: attemptNumber,
            metadata: response?.metadata,
            localStartedAt,
            localFinishedAt: isoNow(clock),
            outcome: "completed",
            retryKind,
            maxOutputTokens,
            promptHash,
            requestPayloadHash: actualRequestPayloadHash(
              response?.metadata,
              requestPayloadHash,
            ),
          }),
        );
        return Object.freeze({
          candidate,
          candidateHash: candidateHashBefore,
          attempts,
          validation: latestValidation,
          promptHash,
          promptVersion: PHASE1_PROMPT_VERSION,
          attemptBudgetExhausted: false,
        });
      } catch (error) {
        if (error instanceof Phase1ModelAdapterError) throw error;
        const code = safeCode(error?.code);
        latestValidation = validationForFailure(code);
        attempts.push(
          attemptRecord({
            attempt: attemptNumber,
            metadata: response?.metadata,
            localStartedAt,
            localFinishedAt: isoNow(clock),
            outcome: "candidate_invalid",
            retryKind,
            maxOutputTokens,
            promptHash,
            requestPayloadHash: actualRequestPayloadHash(
              response?.metadata,
              requestPayloadHash,
            ),
            errorCode: code,
          }),
        );
        const retry = {
          allowed: RETRYABLE_CANDIDATE_CODES.has(code),
          kind: "candidate_repair",
        };
        if (!retry.allowed || attemptNumber >= PHASE1_MAX_PROVIDER_ATTEMPTS) {
          throw new Phase1ModelAdapterError(code, {
            attempts,
            validation: latestValidation,
            candidateHash: latestCandidateHash,
          });
        }
        retryKind = retry.kind;
        repairFeedback = controlledRepairFeedback(error);
      }
    } catch (error) {
      if (error instanceof Phase1ModelAdapterError) throw error;
      const normalized =
        error instanceof ModelRequestError
          ? error
          : new ModelRequestError("Model request failed", {
              retryable: true,
              code: "model_transport_failed",
              outcome: "transient_error",
              cause: error,
            });
      const code = safeCode(normalized.code);
      attempts.push(
        attemptRecord({
          attempt: attemptNumber,
          metadata: normalized.attemptMetadata,
          localStartedAt,
          localFinishedAt: isoNow(clock),
          outcome: normalized.outcome ?? "permanent_error",
          retryKind,
          maxOutputTokens,
          promptHash,
          requestPayloadHash: actualRequestPayloadHash(
            normalized.attemptMetadata,
            requestPayloadHash,
          ),
          errorCode: code,
        }),
      );
      const retry = nextRetry(normalized);
      if (!retry.allowed || attemptNumber >= PHASE1_MAX_PROVIDER_ATTEMPTS) {
        throw new Phase1ModelAdapterError(code, {
          attempts,
          validation: latestValidation,
          candidateHash: latestCandidateHash,
        });
      }
      if (normalized.increaseOutputBudget) {
        maxOutputTokens = TRUNCATION_RETRY_MAX_OUTPUT_TOKENS;
      }
      retryKind = retry.kind;
      if (retry.kind === "invalid_json_repair") {
        repairFeedback = controlledRepairFeedback(normalized);
      }
      const delayMs = Math.max(
        0,
        Math.min(normalized.retryAfterMs ?? 200 * 2 ** index, 5_000),
      );
      await sleepImpl(delayMs);
    }
  }

  throw new Phase1ModelAdapterError("internal_error", { attempts });
}

function bodyEvidence(modelInput, evidenceId, quote) {
  const body = modelInput.message.body;
  const start = body.indexOf(quote);
  if (start < 0) throw new TypeError(`Mock quote ${evidenceId} is absent from the synthetic body`);
  return {
    evidence_id: evidenceId,
    source: "body",
    locator: {
      kind: "utf16_range",
      attachment_id: null,
      page_number: null,
      start,
      end: start + quote.length,
    },
    quote,
  };
}

export function createDev001MockCandidate(modelInput) {
  const course = modelInput.profile.courses.find((item) => item.code === "COMP7101");
  if (!course) throw new TypeError("The Phase 1 mock requires the DEV001 COMP7101 profile");

  const actionQuote = "COMP7101 students must submit Assignment 1";
  const dateQuote = "5:00 pm HKT on 31 August 2026";
  const consequenceQuote =
    "Late submissions receive zero marks unless an approved extension exists.";
  const evidence = [
    bodyEvidence(modelInput, "ev-action", actionQuote),
    bodyEvidence(modelInput, "ev-date", dateQuote),
    bodyEvidence(modelInput, "ev-consequence", consequenceQuote),
  ];
  const courseRef = {
    profile_field_id: course.profile_field_id,
    value: course.code,
    source: course.source,
    confirmation_status: course.confirmation_status,
    valid_until: course.valid_until,
    course_status: course.status,
  };

  return {
    notification_id: modelInput.message.notification_id,
    source_language: "en",
    title_zh: "COMP7101 作业一提交截止通知",
    title_claim_refs: ["cl-action", "cl-date"],
    summary_zh: "COMP7101 学生须在 2026 年 8 月 31 日香港时间下午 5 点前提交作业一；除非已有获批延期，迟交将计零分。",
    summary_claim_refs: ["cl-action", "cl-date", "cl-consequence"],
    topics: [{ label: "专业与课程", evidence_ids: ["ev-action"] }],
    applicability: {
      scope: "confirmed_course",
      value: "applies",
      reason: "邮件点名 COMP7101，且画像中该课程已确认并仍在有效期内。",
      applicability_claim_id: "cl-audience",
      evidence_ids: ["ev-action"],
      profile_field_refs: [courseRef],
      gaps: [],
    },
    claims: [
      {
        claim_id: "cl-audience",
        type: "audience",
        text: "通知面向 COMP7101 学生。",
        high_impact: true,
        evidence_ids: ["ev-action"],
      },
      {
        claim_id: "cl-action",
        type: "action",
        text: "COMP7101 学生必须提交作业一。",
        high_impact: true,
        evidence_ids: ["ev-action"],
      },
      {
        claim_id: "cl-date",
        type: "deadline",
        text: "提交截止为 2026 年 8 月 31 日香港时间下午 5 点。",
        high_impact: true,
        evidence_ids: ["ev-date"],
      },
      {
        claim_id: "cl-consequence",
        type: "consequence",
        text: "除非已有获批延期，迟交将计零分。",
        high_impact: true,
        evidence_ids: ["ev-consequence"],
      },
    ],
    evidence,
    actions: [
      {
        action_id: "act-submit",
        actor: "COMP7101 学生",
        verb: "提交",
        object: "作业一",
        condition: "属于 COMP7101 学生",
        materials: ["作业一文件"],
        obligation: "conditional_mandatory",
        condition_status: "met",
        condition_claim_refs: ["cl-audience"],
        condition_basis_refs: [courseRef],
        claim_refs: ["cl-action", "cl-date"],
      },
    ],
    management_suggestions: [
      {
        suggestion_id: "sug-reminder",
        text: "可在个人任务清单中预留提交前检查时间。",
        reason: "邮件给出了明确且临近的截止时间。",
        claim_refs: ["cl-date"],
      },
    ],
    dates: [
      {
        date_id: "date-deadline",
        original_text: dateQuote,
        role: "deadline",
        normalized: "2026-08-31T17:00:00+08:00",
        timezone: "Asia/Hong_Kong",
        conflict: false,
        claim_id: "cl-date",
        evidence_ids: ["ev-date"],
      },
    ],
    key_changes: [],
    consequence: {
      level: "medium",
      reason: "邮件明确说明无获批延期时迟交计零分。",
      claim_id: "cl-consequence",
      evidence_ids: ["ev-consequence"],
    },
    security_risks: [],
    uncertainties: [],
  };
}

function mockAttemptMetadata(requestBody, startedAt, finishedAt) {
  const metadata = {
    requestId: randomUUID(),
    startedAt,
    finishedAt,
    durationMs: elapsedMs(startedAt, finishedAt),
    httpStatus: null,
    inputTokens: null,
    outputTokens: null,
    maxOutputTokens: requestBody.max_output_tokens,
  };
  Object.defineProperty(metadata, "requestBody", {
    enumerable: false,
    value: requestBody,
  });
  return Object.freeze(metadata);
}

export function createPhase1MockModelClient({
  candidateFactory = createDev001MockCandidate,
  clock = () => new Date(),
} = {}) {
  return Object.freeze({
    configured: true,
    provider: "mock",
    model: "phase1-offline-mock",
    async createStructuredAttempt(request) {
      const startedAt = isoNow(clock);
      const requestBody = buildStructuredRequestBody({
        model: "phase1-offline-mock",
        instructions: request.instructions,
        input: request.input,
        schema: request.schema,
        schemaName: request.schemaName,
        maxOutputTokens: request.maxOutputTokens,
      });
      const modelInput = JSON.parse(request.input);
      const value = await candidateFactory(modelInput, request);
      const finishedAt = isoNow(clock);
      return {
        value,
        metadata: mockAttemptMetadata(requestBody, startedAt, finishedAt),
      };
    },
  });
}
