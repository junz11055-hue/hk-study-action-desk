import { createHash, randomUUID } from "node:crypto";

const TRANSIENT_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const PROVIDER_STATUSES = new Set([
  "cancelled",
  "completed",
  "failed",
  "in_progress",
  "incomplete",
  "queued",
  "refused",
]);
const INCOMPLETE_REASONS = new Set(["content_filter", "max_output_tokens"]);
const OUTPUT_ITEM_TYPES = new Set([
  "code_interpreter_call",
  "computer_call",
  "custom_tool_call",
  "file_search_call",
  "function_call",
  "image_generation_call",
  "local_shell_call",
  "mcp_call",
  "mcp_list_tools",
  "message",
  "reasoning",
  "web_search_call",
]);
export const INITIAL_MAX_OUTPUT_TOKENS = 6_000;
export const TRUNCATION_RETRY_MAX_OUTPUT_TOKENS = 8_000;

export class ModelRequestError extends Error {
  constructor(
    message,
    {
      status = null,
      retryable = false,
      retryAfterMs = null,
      increaseOutputBudget = false,
      repairable = false,
      code = "model_transport_failed",
      outcome = "permanent_error",
      attemptMetadata = null,
      cause,
    } = {},
  ) {
    super(message, { cause });
    this.name = "ModelRequestError";
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.increaseOutputBudget = increaseOutputBudget;
    this.repairable = repairable;
    this.code = code;
    this.outcome = outcome;
    this.attemptMetadata = attemptMetadata;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isoNow(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("clock must return a valid date");
  }
  return date.toISOString();
}

function elapsedDurationMs(monotonicClock, started) {
  const finished = monotonicClock();
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return 0;
  return Math.max(0, Math.round(finished - started));
}

function retryAfterMilliseconds(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 5_000);
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.min(timestamp - Date.now(), 5_000));
}

function providerStatus(payload, refusalPresent) {
  if (refusalPresent) return "refused";
  const status = PROVIDER_STATUSES.has(payload?.status) ? payload.status : null;
  return status;
}

function incompleteReason(payload) {
  if (payload?.status !== "incomplete") return null;
  const reason = payload?.incomplete_details?.reason;
  return INCOMPLETE_REASONS.has(reason) ? reason : "unknown";
}

function tokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function firstTokenCount(...values) {
  for (const value of values) {
    const count = tokenCount(value);
    if (count !== null) return count;
  }
  return null;
}

function providerDiagnostics(payload, { includePartialVisibleOutput = false } = {}) {
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const outputItemTypes = [];
  let refusalPresent = false;
  let partialVisibleOutputPresent = false;
  let partialVisibleOutputUtf8Bytes = 0;
  const partialHash = includePartialVisibleOutput ? createHash("sha256") : null;

  for (const item of output) {
    if (outputItemTypes.length < 16) {
      outputItemTypes.push(OUTPUT_ITEM_TYPES.has(item?.type) ? item.type : "unknown");
    }
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content?.type === "refusal") refusalPresent = true;
      if (
        includePartialVisibleOutput &&
        content?.type === "output_text" &&
        typeof content.text === "string" &&
        content.text.length > 0
      ) {
        partialVisibleOutputPresent = true;
        partialVisibleOutputUtf8Bytes += Buffer.byteLength(content.text, "utf8");
        partialHash.update(content.text, "utf8");
      }
    }
  }

  const usage = payload?.usage;
  return Object.freeze({
    providerStatus: providerStatus(payload, refusalPresent),
    incompleteReason: refusalPresent ? null : incompleteReason(payload),
    outputItemTypes: Object.freeze(outputItemTypes),
    outputItemCount: output.length,
    partialVisibleOutputPresent,
    partialVisibleOutputUtf8Bytes,
    partialVisibleOutputSha256: partialVisibleOutputPresent
      ? `sha256:${partialHash.digest("hex")}`
      : null,
    inputTokens: tokenCount(usage?.input_tokens),
    outputTokens: tokenCount(usage?.output_tokens),
    reasoningTokens: firstTokenCount(
      usage?.output_tokens_details?.reasoning_tokens,
      usage?.reasoning_tokens,
    ),
    outputTextTokens: firstTokenCount(
      usage?.output_tokens_details?.output_text_tokens,
      usage?.output_text_tokens,
    ),
  });
}

function outputTextFromResponse(payload) {
  const outputTexts = [];
  let refusalPresent = false;
  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    if (item?.type !== "message") continue;
    const contentItems = Array.isArray(item.content) ? item.content : [];
    for (const content of contentItems) {
      if (content?.type === "refusal") {
        refusalPresent = true;
      }
      if (content?.type === "output_text" && typeof content.text === "string") {
        outputTexts.push(content.text);
      }
    }
  }
  if (refusalPresent) {
    throw new ModelRequestError("Model refused to produce structured output", {
      code: "model_refused",
      outcome: "refused",
    });
  }
  if (payload?.status === "incomplete") {
    const reason = incompleteReason(payload);
    throw new ModelRequestError(
      `Model response was incomplete: ${reason}`,
      {
        retryable: reason === "max_output_tokens",
        increaseOutputBudget: reason === "max_output_tokens",
        repairable: reason === "max_output_tokens",
        code: "model_response_invalid",
        outcome: reason === "max_output_tokens" ? "truncated" : "permanent_error",
      },
    );
  }
  if (payload?.status !== "completed") {
    const status = providerStatus(payload, false) ?? "unknown";
    throw new ModelRequestError(`Model response did not complete: ${status}`, {
      code: "model_response_invalid",
      outcome: "permanent_error",
    });
  }
  if (outputTexts.length === 1) return outputTexts[0];
  throw new ModelRequestError("Model response did not contain exactly one structured output text", {
    repairable: true,
    code: "model_response_invalid",
    outcome: "invalid_json",
  });
}

export function buildStructuredRequestBody({
  model,
  instructions,
  input,
  schema,
  schemaName,
  maxOutputTokens = INITIAL_MAX_OUTPUT_TOKENS,
}) {
  if (![INITIAL_MAX_OUTPUT_TOKENS, TRUNCATION_RETRY_MAX_OUTPUT_TOKENS].includes(maxOutputTokens)) {
    throw new TypeError("maxOutputTokens must be 6000 or 8000");
  }
  return {
    model,
    store: false,
    instructions,
    input,
    text: {
      format: {
        type: "json_schema",
        name: schemaName,
        strict: true,
        schema,
      },
    },
    max_output_tokens: maxOutputTokens,
  };
}

function attemptMetadata({
  requestId,
  requestBody,
  startedAt,
  finishedAt,
  durationMs,
  httpStatus,
  providerPayload = null,
  includePartialVisibleOutput = false,
}) {
  const diagnostics = providerDiagnostics(providerPayload, { includePartialVisibleOutput });
  const metadata = {
    requestId,
    startedAt,
    finishedAt,
    durationMs,
    httpStatus,
    providerStatus: diagnostics.providerStatus,
    incompleteReason: diagnostics.incompleteReason,
    outputItemTypes: diagnostics.outputItemTypes,
    outputItemCount: diagnostics.outputItemCount,
    partialVisibleOutputPresent: diagnostics.partialVisibleOutputPresent,
    partialVisibleOutputUtf8Bytes: diagnostics.partialVisibleOutputUtf8Bytes,
    partialVisibleOutputSha256: diagnostics.partialVisibleOutputSha256,
    inputTokens: diagnostics.inputTokens,
    outputTokens: diagnostics.outputTokens,
    reasoningTokens: diagnostics.reasoningTokens,
    outputTextTokens: diagnostics.outputTextTokens,
    maxOutputTokens: requestBody.max_output_tokens,
  };

  // The Phase 1 adapter needs the exact body to hash it, but it must never be
  // serialized into a log or run record. A non-enumerable property makes that
  // safety boundary explicit while keeping one canonical request builder.
  Object.defineProperty(metadata, "requestBody", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: requestBody,
  });
  return Object.freeze(metadata);
}

function classifyHttpError(status, retryAfterMs) {
  if (status === 401 || status === 403) {
    return new ModelRequestError(`DeepSeek request failed with status ${status}`, {
      status,
      code: "model_auth_failed",
      outcome: "permanent_error",
    });
  }
  if (status === 429) {
    return new ModelRequestError("DeepSeek request was rate limited", {
      status,
      retryable: true,
      retryAfterMs,
      code: "model_rate_limited",
      outcome: "rate_limited",
    });
  }
  const retryable = TRANSIENT_STATUS.has(status);
  return new ModelRequestError(`DeepSeek request failed with status ${status}`, {
    status,
    retryable,
    retryAfterMs,
    code: "model_transport_failed",
    outcome: retryable ? "transient_error" : "permanent_error",
  });
}

export class DeepSeekResponsesClient {
  constructor({
    apiKey,
    model,
    baseUrl,
    timeoutMs,
    maxRetries,
    fetchImpl = globalThis.fetch,
    logger,
    clock = () => new Date(),
    monotonicClock = () => performance.now(),
  }) {
    this.provider = "deepseek";
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.clock = clock;
    this.monotonicClock = monotonicClock;
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  async createStructuredAttempt({
    instructions,
    input,
    schema,
    schemaName,
    maxOutputTokens = INITIAL_MAX_OUTPUT_TOKENS,
    requestId = randomUUID(),
    attemptNumber = 1,
  }) {
    if (!this.configured) {
      throw new ModelRequestError("DeepSeek API key is not configured", {
        code: "model_not_configured",
        outcome: "permanent_error",
      });
    }

    const requestBody = buildStructuredRequestBody({
      model: this.model,
      instructions,
      input,
      schema,
      schemaName,
      maxOutputTokens,
    });
    const startedAt = isoNow(this.clock);
    const started = this.monotonicClock();
    let httpStatus = null;
    let providerPayload = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          "x-client-request-id": requestId,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      httpStatus = response.status;
      if (!response.ok) {
        throw classifyHttpError(
          response.status,
          retryAfterMilliseconds(response.headers.get("retry-after")),
        );
      }

      providerPayload = await response.json();
      const outputText = outputTextFromResponse(providerPayload);
      let parsed;
      try {
        parsed = JSON.parse(outputText);
      } catch {
        throw new ModelRequestError("Model returned invalid JSON", {
          repairable: true,
          code: "model_response_invalid",
          outcome: "invalid_json",
        });
      }
      const finishedAt = isoNow(this.clock);
      const durationMs = elapsedDurationMs(this.monotonicClock, started);
      const metadata = attemptMetadata({
        requestId,
        requestBody,
        startedAt,
        finishedAt,
        durationMs,
        httpStatus,
        providerPayload,
      });
      this.logger?.info("model_request_completed", {
        requestId,
        provider: "deepseek",
        model: this.model,
        durationMs,
        attempt: attemptNumber,
        inputTokens: metadata.inputTokens,
        outputTokens: metadata.outputTokens,
      });
      return Object.freeze({ value: parsed, metadata });
    } catch (error) {
      const normalized =
        error?.name === "AbortError"
          ? new ModelRequestError("DeepSeek request timed out", {
              retryable: true,
              code: "model_timeout",
              outcome: "timeout",
              cause: error,
            })
          : error instanceof ModelRequestError
            ? error
            : new ModelRequestError("DeepSeek request failed", {
                retryable: true,
                code: "model_transport_failed",
                outcome: "transient_error",
                cause: error,
              });
      const metadata = attemptMetadata({
        requestId,
        requestBody,
        startedAt,
        finishedAt: isoNow(this.clock),
        durationMs: elapsedDurationMs(this.monotonicClock, started),
        httpStatus: normalized.status ?? httpStatus,
        providerPayload,
        includePartialVisibleOutput: true,
      });
      normalized.attemptMetadata = metadata;
      this.logger?.warn("model_request_failed", {
        requestId,
        provider: "deepseek",
        model: this.model,
        attempt: attemptNumber,
        status: normalized.status,
        retryable: normalized.retryable,
        reason: normalized.message,
      });
      throw normalized;
    } finally {
      clearTimeout(timer);
    }
  }

  async createStructured({ instructions, input, schema, schemaName }) {
    if (!this.configured) {
      throw new ModelRequestError("DeepSeek API key is not configured", {
        code: "model_not_configured",
        outcome: "permanent_error",
      });
    }

    const requestId = randomUUID();
    let lastError;
    let maxOutputTokens = INITIAL_MAX_OUTPUT_TOKENS;
    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      try {
        const result = await this.createStructuredAttempt({
          instructions,
          input,
          schema,
          schemaName,
          maxOutputTokens,
          requestId,
          attemptNumber: attempt + 1,
        });
        return result.value;
      } catch (error) {
        lastError = error;
        if (!error.retryable || attempt + 1 >= this.maxRetries) break;
        if (error.increaseOutputBudget) {
          maxOutputTokens = TRUNCATION_RETRY_MAX_OUTPUT_TOKENS;
        }
        await wait(
          error.retryAfterMs ?? 200 * 2 ** attempt + Math.floor(Math.random() * 80),
        );
      }
    }
    throw lastError;
  }
}
