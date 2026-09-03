import Ajv2020 from "ajv/dist/2020.js";

import {
  canonicalJsonStringify,
  hashCanonicalJson,
} from "../validation/canonical-json.js";

export const PHASE1_RUN_RECORD_SCHEMA_VERSION = "phase1-run-record-v1";
export const PHASE1_PROMPT_VERSION = "notification-candidate-prompt-p1-v1";
export const PHASE1_CANDIDATE_SCHEMA_VERSION =
  "notification-analysis-candidate-p1-v1";
export const PHASE1_SCHEMA_DIALECT =
  "https://json-schema.org/draft/2020-12/schema";

export const PHASE1_RUN_ERROR_CODES = Object.freeze([
  "invalid_cli_input",
  "fixture_not_allowed",
  "fixture_invalid",
  "model_not_configured",
  "model_auth_failed",
  "smoke_lock_unavailable",
  "model_timeout",
  "model_rate_limited",
  "model_transport_failed",
  "model_refused",
  "model_response_invalid",
  "candidate_schema_invalid",
  "candidate_reference_invalid",
  "candidate_evidence_invalid",
  "candidate_forbidden_field",
  "record_write_failed",
  "internal_error",
]);

const SHA256_PATTERN = "^sha256:[0-9a-f]{64}$";
const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
const RFC3339_PATTERN =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?(?:Z|[+-]\\d{2}:\\d{2})$";

const nullableHash = {
  type: ["string", "null"],
  pattern: SHA256_PATTERN,
};

const attemptSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "attempt",
    "started_at",
    "finished_at",
    "outcome",
    "http_status",
    "input_tokens",
    "output_tokens",
    "duration_ms",
    "retry_kind",
    "max_output_tokens",
    "prompt_hash",
    "request_payload_hash",
    "error_code",
  ],
  properties: {
    attempt: { type: "integer", minimum: 1, maximum: 3 },
    started_at: { type: "string", pattern: RFC3339_PATTERN },
    finished_at: { type: "string", pattern: RFC3339_PATTERN },
    outcome: {
      type: "string",
      enum: [
        "completed",
        "timeout",
        "rate_limited",
        "transient_error",
        "permanent_error",
        "truncated",
        "invalid_json",
        "candidate_invalid",
        "refused",
      ],
    },
    http_status: {
      type: ["integer", "null"],
      minimum: 100,
      maximum: 599,
    },
    input_tokens: { type: ["integer", "null"], minimum: 0 },
    output_tokens: { type: ["integer", "null"], minimum: 0 },
    duration_ms: { type: "integer", minimum: 0 },
    retry_kind: {
      type: "string",
      enum: [
        "initial",
        "transport",
        "retry_after",
        "truncation",
        "invalid_json_repair",
        "candidate_repair",
      ],
    },
    max_output_tokens: { type: "integer", enum: [6000, 8000] },
    prompt_hash: { type: "string", pattern: SHA256_PATTERN },
    request_payload_hash: { type: "string", pattern: SHA256_PATTERN },
    error_code: {
      type: ["string", "null"],
      enum: [null, ...PHASE1_RUN_ERROR_CODES],
    },
  },
};

const errorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "message"],
  properties: {
    code: { type: "string", enum: PHASE1_RUN_ERROR_CODES },
    message: { type: "string", minLength: 1, maxLength: 500 },
  },
};

export const PHASE1_RUN_RECORD_SCHEMA = Object.freeze({
  $schema: PHASE1_SCHEMA_DIALECT,
  $id: "https://local.invalid/schemas/phase1-run-record-v1.schema.json",
  type: "object",
  additionalProperties: false,
  required: [
    "record_schema_version",
    "run_id",
    "case_id",
    "dataset_split",
    "execution_mode",
    "status",
    "started_at",
    "finished_at",
    "provider",
    "model",
    "prompt_version",
    "candidate_schema_version",
    "schema_dialect",
    "attempt_budget_exhausted",
    "decoding",
    "attempts",
    "hashes",
    "validation",
    "candidate",
    "error",
  ],
  properties: {
    record_schema_version: {
      type: "string",
      const: PHASE1_RUN_RECORD_SCHEMA_VERSION,
    },
    run_id: { type: "string", pattern: UUID_PATTERN },
    case_id: { type: "string", const: "DEV001" },
    dataset_split: { type: "string", const: "development" },
    execution_mode: { type: "string", enum: ["mock", "deepseek"] },
    status: { type: "string", enum: ["succeeded", "failed"] },
    started_at: { type: "string", pattern: RFC3339_PATTERN },
    finished_at: { type: "string", pattern: RFC3339_PATTERN },
    provider: { type: "string", enum: ["mock", "deepseek"] },
    model: { type: ["string", "null"], minLength: 1, maxLength: 128 },
    prompt_version: { type: "string", const: PHASE1_PROMPT_VERSION },
    candidate_schema_version: {
      type: "string",
      const: PHASE1_CANDIDATE_SCHEMA_VERSION,
    },
    schema_dialect: { type: "string", const: PHASE1_SCHEMA_DIALECT },
    attempt_budget_exhausted: { type: "boolean" },
    decoding: {
      type: "object",
      additionalProperties: false,
      required: [
        "max_attempts",
        "initial_max_output_tokens",
        "truncation_max_output_tokens",
        "timeout_ms",
      ],
      properties: {
        max_attempts: { type: "integer", const: 3 },
        initial_max_output_tokens: { type: "integer", const: 6000 },
        truncation_max_output_tokens: { type: "integer", const: 8000 },
        timeout_ms: { type: "integer", minimum: 3000, maximum: 120000 },
      },
    },
    attempts: {
      type: "array",
      maxItems: 3,
      items: attemptSchema,
    },
    hashes: {
      type: "object",
      additionalProperties: false,
      required: [
        "fixture_input_hash",
        "prompt_hash",
        "schema_hash",
        "model_payload_hash",
        "candidate_hash",
        "delivered_output_hash",
      ],
      properties: {
        fixture_input_hash: nullableHash,
        prompt_hash: nullableHash,
        schema_hash: nullableHash,
        model_payload_hash: nullableHash,
        candidate_hash: nullableHash,
        delivered_output_hash: nullableHash,
      },
    },
    validation: {
      type: "object",
      additionalProperties: false,
      required: [
        "schema_valid",
        "references_closed",
        "locator_quotes_exact",
        "forbidden_fields_absent",
        "candidate_unchanged",
      ],
      properties: {
        schema_valid: { type: "boolean" },
        references_closed: { type: "boolean" },
        locator_quotes_exact: { type: "boolean" },
        forbidden_fields_absent: { type: "boolean" },
        candidate_unchanged: { type: "boolean" },
      },
    },
    candidate: { type: ["object", "null"] },
    error: {
      anyOf: [{ type: "null" }, errorSchema],
    },
  },
  allOf: [
    {
      if: {
        required: ["execution_mode"],
        properties: { execution_mode: { const: "mock" } },
      },
      then: {
        properties: {
          provider: { const: "mock" },
          model: { type: "null" },
        },
      },
      else: {
        properties: { provider: { const: "deepseek" } },
      },
    },
    {
      if: {
        required: ["status"],
        properties: { status: { const: "succeeded" } },
      },
      then: {
        properties: {
          attempt_budget_exhausted: { const: false },
          attempts: { type: "array", minItems: 1 },
          hashes: {
            type: "object",
            properties: {
              fixture_input_hash: { type: "string", pattern: SHA256_PATTERN },
              prompt_hash: { type: "string", pattern: SHA256_PATTERN },
              schema_hash: { type: "string", pattern: SHA256_PATTERN },
              model_payload_hash: { type: "string", pattern: SHA256_PATTERN },
              candidate_hash: { type: "string", pattern: SHA256_PATTERN },
              delivered_output_hash: {
                type: "string",
                pattern: SHA256_PATTERN,
              },
            },
          },
          validation: {
            type: "object",
            properties: {
              schema_valid: { const: true },
              references_closed: { const: true },
              locator_quotes_exact: { const: true },
              forbidden_fields_absent: { const: true },
              candidate_unchanged: { const: true },
            },
          },
          candidate: { type: "object" },
          error: { type: "null" },
        },
      },
      else: {
        properties: {
          candidate: { type: "null" },
          error: errorSchema,
        },
      },
    },
  ],
});

const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  validateFormats: false,
});
const validateSchema = ajv.compile(PHASE1_RUN_RECORD_SCHEMA);

function publicAjvErrors(errors = []) {
  return errors.map(({ instancePath, keyword, message }) => ({
    instancePath,
    keyword,
    message: message ?? "validation failed",
  }));
}

function customError(instancePath, keyword, message) {
  return { instancePath, keyword, message };
}

function validTimestamp(value) {
  if (typeof value !== "string") {
    return false;
  }
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/u,
  );
  if (!match) {
    return false;
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute =
    offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
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
    !Number.isNaN(Date.parse(value))
  );
}

function collectContractErrors(record) {
  const errors = [];
  try {
    canonicalJsonStringify(record);
  } catch {
    errors.push(
      customError("", "jsonValue", "record must contain only JSON-compatible data"),
    );
    return errors;
  }

  for (const field of ["started_at", "finished_at"]) {
    if (!validTimestamp(record[field])) {
      errors.push(
        customError(
          `/${field}`,
          "rfc3339",
          `${field} must be a real RFC3339 timestamp`,
        ),
      );
    }
  }

  if (
    validTimestamp(record.started_at) &&
    validTimestamp(record.finished_at) &&
    Date.parse(record.finished_at) < Date.parse(record.started_at)
  ) {
    errors.push(
      customError(
        "/finished_at",
        "timeOrder",
        "finished_at must not precede started_at",
      ),
    );
  }

  const attempts = record.attempts;
  if (!Array.isArray(attempts)) {
    return errors;
  }

  attempts.forEach((attempt, index) => {
    for (const field of ["started_at", "finished_at"]) {
      if (!validTimestamp(attempt?.[field])) {
        errors.push(
          customError(
            `/attempts/${index}/${field}`,
            "rfc3339",
            `${field} must be a real RFC3339 timestamp`,
          ),
        );
      }
    }
    if (attempt?.attempt !== index + 1) {
      errors.push(
        customError(
          `/attempts/${index}/attempt`,
          "sequence",
          "attempt numbers must be continuous and start at 1",
        ),
      );
    }
    if (index === 0 && attempt?.retry_kind !== "initial") {
      errors.push(
        customError(
          "/attempts/0/retry_kind",
          "initialAttempt",
          "the first retry_kind must be initial",
        ),
      );
    }
    if (index > 0 && attempt?.retry_kind === "initial") {
      errors.push(
        customError(
          `/attempts/${index}/retry_kind`,
          "initialAttempt",
          "only the first retry_kind may be initial",
        ),
      );
    }
    if (index === 0 && attempt?.max_output_tokens !== 6000) {
      errors.push(
        customError(
          "/attempts/0/max_output_tokens",
          "tokenBudget",
          "the initial max_output_tokens must be 6000",
        ),
      );
    }
    if (index > 0) {
      const previous = attempts[index - 1];
      if (
        previous?.max_output_tokens === 6000 &&
        attempt?.max_output_tokens === 8000 &&
        previous?.outcome !== "truncated"
      ) {
        errors.push(
          customError(
            `/attempts/${index}/max_output_tokens`,
            "tokenBudget",
            "the token budget may rise only after truncation",
          ),
        );
      }
      if (
        previous?.max_output_tokens === 8000 &&
        attempt?.max_output_tokens === 6000
      ) {
        errors.push(
          customError(
            `/attempts/${index}/max_output_tokens`,
            "tokenBudget",
            "the token budget must not decrease",
          ),
        );
      }
    }
    if (
      validTimestamp(attempt?.started_at) &&
      validTimestamp(attempt?.finished_at) &&
      Date.parse(attempt.finished_at) < Date.parse(attempt.started_at)
    ) {
      errors.push(
        customError(
          `/attempts/${index}/finished_at`,
          "timeOrder",
          "attempt finished_at must not precede started_at",
        ),
      );
    }
    if (
      record.hashes?.prompt_hash &&
      attempt?.prompt_hash !== record.hashes.prompt_hash
    ) {
      errors.push(
        customError(
          `/attempts/${index}/prompt_hash`,
          "hashLink",
          "attempt prompt_hash must equal the root prompt_hash",
        ),
      );
    }
  });

  if (attempts.length > 0) {
    for (const field of ["fixture_input_hash", "prompt_hash", "schema_hash"]) {
      if (record.hashes?.[field] === null) {
        errors.push(
          customError(
            `/hashes/${field}`,
            "attemptPrerequisite",
            `${field} is required once an attempt has occurred`,
          ),
        );
      }
    }
  }

  const budgetShouldBeExhausted =
    record.status === "failed" && attempts.length === 3;
  if (record.attempt_budget_exhausted !== budgetShouldBeExhausted) {
    errors.push(
      customError(
        "/attempt_budget_exhausted",
        "attemptBudget",
        "attempt_budget_exhausted must reflect three used failed attempts",
      ),
    );
  }

  const expectedPayloadHash =
    attempts.length > 0
      ? hashCanonicalJson(attempts.map((attempt) => attempt.request_payload_hash))
      : null;
  if (record.hashes?.model_payload_hash !== expectedPayloadHash) {
    errors.push(
      customError(
        "/hashes/model_payload_hash",
        "hashLink",
        "model_payload_hash must cover ordered attempt request hashes",
      ),
    );
  }

  if (record.status === "succeeded") {
    const candidateHash = hashCanonicalJson(record.candidate);
    if (record.hashes?.candidate_hash !== candidateHash) {
      errors.push(
        customError(
          "/hashes/candidate_hash",
          "hashLink",
          "candidate_hash must cover candidate",
        ),
      );
    }
    if (record.hashes?.delivered_output_hash !== candidateHash) {
      errors.push(
        customError(
          "/hashes/delivered_output_hash",
          "hashLink",
          "delivered_output_hash must equal the unchanged candidate hash",
        ),
      );
    }
    if (attempts.at(-1)?.outcome !== "completed") {
      errors.push(
        customError(
          "/attempts",
          "successfulAttempt",
          "a successful record must end with a completed attempt",
        ),
      );
    }
    if (attempts.at(-1)?.error_code !== null) {
      errors.push(
        customError(
          `/attempts/${attempts.length - 1}/error_code`,
          "successfulAttempt",
          "a completed successful attempt cannot have an error_code",
        ),
      );
    }
    if (
      record.execution_mode === "deepseek" &&
      (typeof record.model !== "string" || record.model.length === 0)
    ) {
      errors.push(
        customError(
          "/model",
          "successfulModel",
          "a successful DeepSeek record must identify the model",
        ),
      );
    }
  } else if (record.hashes?.delivered_output_hash !== null) {
    errors.push(
      customError(
        "/hashes/delivered_output_hash",
        "failedOutput",
        "a failed run cannot have a delivered output hash",
      ),
    );
  }

  return errors;
}

/** Validate without mutating the supplied record. */
export function validatePhase1RunRecord(record) {
  const schemaValid = validateSchema(record);
  const errors = schemaValid ? [] : publicAjvErrors(validateSchema.errors);
  if (schemaValid) {
    errors.push(...collectContractErrors(record));
  }
  return { valid: errors.length === 0, errors };
}

export class Phase1RunRecordValidationError extends Error {
  constructor(errors) {
    super("phase1 run record does not satisfy phase1-run-record-v1");
    this.name = "Phase1RunRecordValidationError";
    this.code = "record_write_failed";
    this.validationErrors = errors;
  }
}

export function assertValidPhase1RunRecord(record) {
  const result = validatePhase1RunRecord(record);
  if (!result.valid) {
    throw new Phase1RunRecordValidationError(result.errors);
  }
  return record;
}
