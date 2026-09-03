import Ajv2020 from "ajv/dist/2020.js";

import {
  canonicalJsonStringify,
  hashCanonicalJson,
} from "../validation/canonical-json.js";
import { NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA } from "./notification-analysis-core-candidate-p1-v2.schema.js";
import { assertCoreCandidateSafeStructure } from "../validation/core-candidate-validator.js";

export const PHASE1_CORE_RUN_RECORD_SCHEMA_VERSION = "phase1-core-run-record-v2";
export const PHASE1_CORE_PROMPT_VERSION = "notification-analysis-core-prompt-p1-v2";
export const PHASE1_CORE_CANDIDATE_SCHEMA_VERSION =
  "notification-analysis-core-candidate-p1-v2";
export const PHASE1_CORE_SCHEMA_DIALECT =
  "https://json-schema.org/draft/2020-12/schema";

export const PHASE1_CORE_RUN_ERROR_CODES = Object.freeze([
  "invalid_cli_input",
  "fixture_not_allowed",
  "fixture_invalid",
  "model_not_configured",
  "model_auth_failed",
  "model_timeout",
  "model_rate_limited",
  "model_transport_failed",
  "model_refused",
  "model_response_invalid",
  "candidate_schema_invalid",
  "candidate_reference_invalid",
  "candidate_evidence_invalid",
  "candidate_language_invalid",
  "candidate_forbidden_field",
  "duplicate_payload_blocked",
  "smoke_lock_unavailable",
  "implementation_not_frozen",
  "model_configuration_invalid",
  "record_write_failed",
  "internal_error",
]);

export const PHASE1_CORE_SAFE_ERROR_MESSAGES = Object.freeze({
  invalid_cli_input: "Only --case DEV001 is accepted.",
  fixture_not_allowed: "The requested fixture is not allowed in Core Phase 1.",
  fixture_invalid: "The approved development fixture is invalid.",
  model_not_configured: "DeepSeek is not configured.",
  model_auth_failed: "DeepSeek authentication failed.",
  model_timeout: "The model request timed out.",
  model_rate_limited: "The model request was rate limited.",
  model_transport_failed: "The model transport failed.",
  model_refused: "The model refused the structured request.",
  model_response_invalid: "The model response was not valid JSON output.",
  candidate_schema_invalid: "The candidate did not match the Core v2 schema.",
  candidate_reference_invalid: "The candidate contained an invalid reference.",
  candidate_evidence_invalid: "The candidate evidence did not uniquely match the body.",
  candidate_language_invalid: "The candidate Chinese fields did not meet the minimum language contract.",
  candidate_forbidden_field: "The candidate crossed a Harness ownership boundary.",
  duplicate_payload_blocked: "A repeated content-failure payload was blocked.",
  smoke_lock_unavailable: "Another Core smoke run holds the exclusive lock.",
  implementation_not_frozen: "The Core implementation is not frozen in a clean Git commit.",
  model_configuration_invalid: "The Core DeepSeek configuration is not the approved fixed configuration.",
  record_write_failed: "The terminal Core v2 run record could not be written.",
  internal_error: "The Core v2 run failed internally.",
});

const SHA256_PATTERN = "^sha256:[0-9a-f]{64}$";
const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
const RFC3339_PATTERN =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?(?:Z|[+-]\\d{2}:\\d{2})$";
const GIT_COMMIT_PATTERN = "^(?:[0-9a-f]{40}|[0-9a-f]{64})$";

const nullableHash = {
  type: ["string", "null"],
  pattern: SHA256_PATTERN,
};

const nullableTokenCount = {
  type: ["integer", "null"],
  minimum: 0,
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
    "reasoning_tokens",
    "output_text_tokens",
    "duration_ms",
    "max_output_tokens",
    "prompt_hash",
    "request_payload_hash",
    "provider_status",
    "incomplete_reason",
    "output_item_types",
    "output_item_count",
    "partial_output_present",
    "partial_output_bytes",
    "partial_output_hash",
    "error_code",
  ],
  properties: {
    attempt: { type: "integer", const: 1 },
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
        "harness_error",
        "refused",
      ],
    },
    http_status: {
      type: ["integer", "null"],
      minimum: 100,
      maximum: 599,
    },
    input_tokens: nullableTokenCount,
    output_tokens: nullableTokenCount,
    reasoning_tokens: nullableTokenCount,
    output_text_tokens: nullableTokenCount,
    duration_ms: { type: "integer", minimum: 0 },
    max_output_tokens: { type: "integer", const: 8000 },
    prompt_hash: { type: "string", pattern: SHA256_PATTERN },
    request_payload_hash: { type: "string", pattern: SHA256_PATTERN },
    provider_status: {
      type: ["string", "null"],
      enum: [
        "cancelled",
        "completed",
        "failed",
        "in_progress",
        "incomplete",
        "queued",
        "refused",
        null,
      ],
    },
    incomplete_reason: {
      type: ["string", "null"],
      enum: ["max_output_tokens", "content_filter", "unknown", null],
    },
    output_item_types: {
      type: "array",
      maxItems: 16,
      items: {
        type: "string",
        minLength: 1,
        maxLength: 64,
        pattern: "^[a-z][a-z0-9_]*$",
      },
    },
    output_item_count: { type: "integer", minimum: 0, maximum: 1024 },
    partial_output_present: { type: "boolean" },
    partial_output_bytes: { type: "integer", minimum: 0 },
    partial_output_hash: nullableHash,
    error_code: {
      type: ["string", "null"],
      enum: [null, ...PHASE1_CORE_RUN_ERROR_CODES],
    },
  },
};

const errorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "message"],
  properties: {
    code: { type: "string", enum: PHASE1_CORE_RUN_ERROR_CODES },
    message: { type: "string", minLength: 1, maxLength: 500 },
  },
};

export const PHASE1_CORE_RUN_RECORD_SCHEMA = Object.freeze({
  $schema: PHASE1_CORE_SCHEMA_DIALECT,
  $id: "https://local.invalid/schemas/phase1-core-run-record-v2.schema.json",
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
    "provider_endpoint",
    "implementation_commit_sha",
    "implementation_git_clean",
    "prompt_version",
    "candidate_schema_version",
    "schema_dialect",
    "attempt_budget_exhausted",
    "decoding",
    "attempts",
    "hashes",
    "validation",
    "validation_evidence",
    "candidate",
    "error",
  ],
  properties: {
    record_schema_version: {
      type: "string",
      const: PHASE1_CORE_RUN_RECORD_SCHEMA_VERSION,
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
    provider_endpoint: {
      type: ["string", "null"],
      minLength: 1,
      maxLength: 200,
    },
    implementation_commit_sha: {
      type: ["string", "null"],
      pattern: GIT_COMMIT_PATTERN,
    },
    implementation_git_clean: { type: ["boolean", "null"] },
    prompt_version: { type: "string", const: PHASE1_CORE_PROMPT_VERSION },
    candidate_schema_version: {
      type: "string",
      const: PHASE1_CORE_CANDIDATE_SCHEMA_VERSION,
    },
    schema_dialect: { type: "string", const: PHASE1_CORE_SCHEMA_DIALECT },
    attempt_budget_exhausted: { type: "boolean" },
    decoding: {
      type: "object",
      additionalProperties: false,
      required: ["max_attempts", "max_output_tokens", "timeout_ms"],
      properties: {
        max_attempts: { type: "integer", const: 1 },
        max_output_tokens: { type: "integer", const: 8000 },
        timeout_ms: { type: "integer", const: 90000 },
      },
    },
    attempts: {
      type: "array",
      maxItems: 1,
      items: attemptSchema,
    },
    hashes: {
      type: "object",
      additionalProperties: false,
      required: [
        "fixture_input_hash",
        "model_input_hash",
        "prompt_hash",
        "schema_hash",
        "model_payload_hash",
        "candidate_hash",
        "delivered_output_hash",
        "blocked_payload_hash",
      ],
      properties: {
        fixture_input_hash: nullableHash,
        model_input_hash: nullableHash,
        prompt_hash: nullableHash,
        schema_hash: nullableHash,
        model_payload_hash: nullableHash,
        candidate_hash: nullableHash,
        delivered_output_hash: nullableHash,
        blocked_payload_hash: nullableHash,
      },
    },
    validation: {
      type: "object",
      additionalProperties: false,
      required: [
        "schema_valid",
        "references_closed",
        "quote_unique",
        "profile_refs_allowed",
        "forbidden_fields_absent",
        "candidate_unchanged",
      ],
      properties: {
        schema_valid: { type: "boolean" },
        references_closed: { type: "boolean" },
        quote_unique: { type: "boolean" },
        profile_refs_allowed: { type: "boolean" },
        forbidden_fields_absent: { type: "boolean" },
        candidate_unchanged: { type: "boolean" },
      },
    },
    validation_evidence: {
      type: "object",
      additionalProperties: false,
      required: ["evidence_locators", "profile_refs"],
      properties: {
        evidence_locators: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["evidence_id", "kind", "start", "end"],
            properties: {
              evidence_id: { type: "string", minLength: 1, maxLength: 64 },
              kind: { type: "string", const: "utf16_range" },
              start: { type: "integer", minimum: 0, maximum: 50000 },
              end: { type: "integer", minimum: 1, maximum: 50000 },
            },
          },
        },
        profile_refs: {
          type: "array",
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "profile_field_id",
              "source",
              "confirmation_status",
              "valid_until",
              "course_status",
            ],
            properties: {
              profile_field_id: { type: "string", minLength: 1, maxLength: 64 },
              source: { type: "string", minLength: 1, maxLength: 200 },
              confirmation_status: {
                type: "string",
                enum: ["confirmed", "candidate", "unconfirmed"],
              },
              valid_until: { type: "string", minLength: 1, maxLength: 200 },
              course_status: {
                type: ["string", "null"],
                enum: ["confirmed", "candidate", "removed", "expired", null],
              },
            },
          },
        },
      },
    },
    candidate: {
      anyOf: [
        { type: "null" },
        NOTIFICATION_ANALYSIS_CORE_CANDIDATE_P1_V2_SCHEMA,
      ],
    },
    error: { anyOf: [{ type: "null" }, errorSchema] },
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
          provider_endpoint: { type: "null" },
          implementation_commit_sha: { type: "null" },
          implementation_git_clean: { type: "null" },
        },
      },
      else: {
        properties: {
          provider: { const: "deepseek" },
          model: { type: ["string", "null"], minLength: 1 },
          provider_endpoint: { type: ["string", "null"], minLength: 1 },
        },
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
          model: {
            anyOf: [
              { type: "null" },
              { type: "string", const: "deepseek-v4-flash" },
            ],
          },
          provider_endpoint: {
            anyOf: [
              { type: "null" },
              { type: "string", const: "https://api.deepseek.com" },
            ],
          },
          attempts: { type: "array", minItems: 1, maxItems: 1 },
          validation: {
            type: "object",
            properties: {
              schema_valid: { const: true },
              references_closed: { const: true },
              quote_unique: { const: true },
              profile_refs_allowed: { const: true },
              forbidden_fields_absent: { const: true },
              candidate_unchanged: { const: true },
            },
          },
          hashes: {
            type: "object",
            properties: {
              fixture_input_hash: { type: "string", pattern: SHA256_PATTERN },
              model_input_hash: { type: "string", pattern: SHA256_PATTERN },
              prompt_hash: { type: "string", pattern: SHA256_PATTERN },
              schema_hash: { type: "string", pattern: SHA256_PATTERN },
              model_payload_hash: { type: "string", pattern: SHA256_PATTERN },
              candidate_hash: { type: "string", pattern: SHA256_PATTERN },
              delivered_output_hash: { type: "string", pattern: SHA256_PATTERN },
            },
          },
          validation_evidence: {
            type: "object",
            properties: {
              evidence_locators: { type: "array", minItems: 1 },
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
const validateSchema = ajv.compile(PHASE1_CORE_RUN_RECORD_SCHEMA);

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
  return (
    typeof value === "string" &&
    new RegExp(RFC3339_PATTERN, "u").test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function pushReferenceErrors(errors, values, target, instancePath) {
  if (new Set(values).size !== values.length) {
    errors.push(
      customError(instancePath, "referenceClosure", "references must be unique"),
    );
  }
  if (values.some((value) => !target.has(value))) {
    errors.push(
      customError(instancePath, "referenceClosure", "references must resolve"),
    );
  }
}

function uniqueIndex(errors, items, idKey, instancePath) {
  const indexed = new Map();
  for (let index = 0; index < items.length; index += 1) {
    const id = items[index][idKey];
    if (indexed.has(id)) {
      errors.push(
        customError(
          `${instancePath}/${index}/${idKey}`,
          "referenceClosure",
          "IDs must be unique",
        ),
      );
    }
    indexed.set(id, items[index]);
  }
  return indexed;
}

function collectSuccessfulCandidateErrors(record) {
  const errors = [];
  const candidate = record.candidate;
  if (!candidate || typeof candidate !== "object") return errors;

  try {
    assertCoreCandidateSafeStructure(candidate);
  } catch {
    errors.push(
      customError(
        "/candidate",
        "candidateSafety",
        "successful candidate must pass the Core safety boundary",
      ),
    );
    return errors;
  }

  const claims = uniqueIndex(errors, candidate.claims, "claim_id", "/candidate/claims");
  const evidence = uniqueIndex(
    errors,
    candidate.evidence,
    "evidence_id",
    "/candidate/evidence",
  );
  uniqueIndex(errors, candidate.actions, "action_id", "/candidate/actions");
  uniqueIndex(errors, candidate.deadlines, "deadline_id", "/candidate/deadlines");
  if (new Set(candidate.topics.map((topic) => topic.label)).size !== candidate.topics.length) {
    errors.push(
      customError(
        "/candidate/topics",
        "referenceClosure",
        "topic labels must be unique",
      ),
    );
  }

  pushReferenceErrors(errors, candidate.title_claim_refs, claims, "/candidate/title_claim_refs");
  pushReferenceErrors(
    errors,
    candidate.summary_claim_refs,
    claims,
    "/candidate/summary_claim_refs",
  );
  candidate.topics.forEach((topic, index) =>
    pushReferenceErrors(
      errors,
      topic.claim_refs,
      claims,
      `/candidate/topics/${index}/claim_refs`,
    ),
  );
  candidate.claims.forEach((claim, index) =>
    pushReferenceErrors(
      errors,
      claim.evidence_refs,
      evidence,
      `/candidate/claims/${index}/evidence_refs`,
    ),
  );

  const applicability = candidate.applicability;
  if (applicability.claim_ref !== null) {
    pushReferenceErrors(
      errors,
      [applicability.claim_ref],
      claims,
      "/candidate/applicability/claim_ref",
    );
  }
  if (new Set(applicability.profile_field_ids).size !== applicability.profile_field_ids.length) {
    errors.push(
      customError(
        "/candidate/applicability/profile_field_ids",
        "referenceClosure",
        "profile references must be unique",
      ),
    );
  }
  if (applicability.value === "applies" && applicability.claim_ref === null) {
    errors.push(
      customError(
        "/candidate/applicability/claim_ref",
        "crossField",
        "applicable output requires a supporting claim",
      ),
    );
  }
  if (
    applicability.value === "applies" &&
    ["current_user", "confirmed_course", "programme", "cohort", "department"].includes(
      applicability.scope,
    ) &&
    applicability.profile_field_ids.length === 0
  ) {
    errors.push(
      customError(
        "/candidate/applicability/profile_field_ids",
        "crossField",
        "applicable profile scope requires trusted profile evidence",
      ),
    );
  }
  if (
    (applicability.scope === "not_applicable") !==
    (applicability.value === "not_applicable")
  ) {
    errors.push(
      customError(
        "/candidate/applicability",
        "crossField",
        "not_applicable scope and value must agree",
      ),
    );
  }

  candidate.actions.forEach((action, index) =>
    pushReferenceErrors(
      errors,
      action.claim_refs,
      claims,
      `/candidate/actions/${index}/claim_refs`,
    ),
  );
  candidate.deadlines.forEach((deadline, index) => {
    pushReferenceErrors(
      errors,
      [deadline.claim_ref],
      claims,
      `/candidate/deadlines/${index}/claim_ref`,
    );
    const claim = claims.get(deadline.claim_ref);
    const supported = claim?.evidence_refs.some((evidenceId) =>
      evidence.get(evidenceId)?.quote.includes(deadline.original_text),
    );
    if (!supported) {
      errors.push(
        customError(
          `/candidate/deadlines/${index}/original_text`,
          "evidenceLink",
          "deadline text must be supported by referenced evidence",
        ),
      );
    }
  });
  if (candidate.consequence.claim_ref !== null) {
    pushReferenceErrors(
      errors,
      [candidate.consequence.claim_ref],
      claims,
      "/candidate/consequence/claim_ref",
    );
  } else if (candidate.consequence.level !== "unknown") {
    errors.push(
      customError(
        "/candidate/consequence/claim_ref",
        "crossField",
        "known consequence requires a supporting claim",
      ),
    );
  }

  const locators = record.validation_evidence.evidence_locators;
  if (locators.length !== candidate.evidence.length) {
    errors.push(
      customError(
        "/validation_evidence/evidence_locators",
        "evidenceLink",
        "every Candidate evidence item requires exactly one locator",
      ),
    );
  }
  candidate.evidence.forEach((item, index) => {
    const locator = locators[index];
    if (
      !locator ||
      locator.evidence_id !== item.evidence_id ||
      locator.end <= locator.start ||
      locator.end - locator.start !== item.quote.length
    ) {
      errors.push(
        customError(
          `/validation_evidence/evidence_locators/${index}`,
          "evidenceLink",
          "locator identity and UTF-16 width must match Candidate evidence",
        ),
      );
    }
  });

  const profileRefs = record.validation_evidence.profile_refs;
  if (profileRefs.length !== applicability.profile_field_ids.length) {
    errors.push(
      customError(
        "/validation_evidence/profile_refs",
        "profileLink",
        "validated profile evidence must match Candidate profile references",
      ),
    );
  }
  applicability.profile_field_ids.forEach((id, index) => {
    const profile = profileRefs[index];
    if (
      !profile ||
      profile.profile_field_id !== id ||
      profile.profile_field_id !== "pf-dev001-course-comp7101" ||
      profile.source !== "synthetic_user_confirmed" ||
      profile.confirmation_status !== "confirmed" ||
      profile.course_status !== "confirmed" ||
      profile.valid_until !== "2026-12-31"
    ) {
      errors.push(
        customError(
          `/validation_evidence/profile_refs/${index}`,
          "profileLink",
          "profile evidence must be current, confirmed, and identity-linked",
        ),
      );
    }
  });

  return errors;
}

function providerOutcomeIsConsistent(attempt, executionMode) {
  const status = attempt.provider_status;
  const outcome = attempt.outcome;
  if (status === "incomplete" && attempt.incomplete_reason === null) return false;
  if (outcome === "completed") return status === "completed";
  if (outcome === "refused") return status === "refused";
  if (outcome === "truncated") {
    return status === "incomplete" && attempt.incomplete_reason === "max_output_tokens";
  }
  if (["timeout", "rate_limited", "transient_error"].includes(outcome)) {
    return status === null;
  }
  if (["candidate_invalid", "invalid_json"].includes(outcome)) {
    return status === "completed" || (executionMode === "mock" && status === null);
  }
  if (outcome === "harness_error") return status !== null;
  if (outcome === "permanent_error") {
    return [null, "failed", "cancelled", "incomplete"].includes(status);
  }
  return false;
}

function failedValidationIsConservative(record) {
  const values = record.validation;
  if (values.candidate_unchanged !== false) return false;
  const allowedTrue = new Set();
  if (
    [
      "candidate_reference_invalid",
      "candidate_evidence_invalid",
      "candidate_language_invalid",
    ].includes(record.error?.code)
  ) {
    allowedTrue.add("schema_valid");
    allowedTrue.add("forbidden_fields_absent");
  }
  return Object.entries(values).every(
    ([key, value]) => value === false || (value === true && allowedTrue.has(key)),
  );
}

function errorCodeMatchesOutcome(attempt) {
  const byOutcome = {
    completed: new Set([null]),
    timeout: new Set(["model_timeout"]),
    rate_limited: new Set(["model_rate_limited"]),
    transient_error: new Set(["model_transport_failed"]),
    permanent_error: new Set([
      "model_auth_failed",
      "model_transport_failed",
      "model_response_invalid",
      "internal_error",
    ]),
    truncated: new Set(["model_response_invalid"]),
    invalid_json: new Set(["model_response_invalid"]),
    candidate_invalid: new Set([
      "candidate_schema_invalid",
      "candidate_reference_invalid",
      "candidate_evidence_invalid",
      "candidate_language_invalid",
      "candidate_forbidden_field",
      "internal_error",
    ]),
    harness_error: new Set(["internal_error"]),
    refused: new Set(["model_refused"]),
  };
  return byOutcome[attempt.outcome]?.has(attempt.error_code) === true;
}

function collectContractErrors(record) {
  const errors = [];
  try {
    canonicalJsonStringify(record);
  } catch {
    return [
      customError("", "jsonValue", "record must contain only JSON-compatible data"),
    ];
  }

  if (
    record.error &&
    record.error.message !== PHASE1_CORE_SAFE_ERROR_MESSAGES[record.error.code]
  ) {
    errors.push(
      customError(
        "/error/message",
        "safeError",
        "error message must be the fixed safe message for its code",
      ),
    );
  }

  if (
    validTimestamp(record.started_at) &&
    validTimestamp(record.finished_at) &&
    Date.parse(record.finished_at) < Date.parse(record.started_at)
  ) {
    errors.push(
      customError("/finished_at", "timeOrder", "finished_at must not precede started_at"),
    );
  }

  const attempts = Array.isArray(record.attempts) ? record.attempts : [];
  const attempt = attempts[0];
  if (attempt) {
    if (
      validTimestamp(attempt.started_at) &&
      validTimestamp(attempt.finished_at) &&
      Date.parse(attempt.finished_at) < Date.parse(attempt.started_at)
    ) {
      errors.push(
        customError(
          "/attempts/0/finished_at",
          "timeOrder",
          "attempt finished_at must not precede started_at",
        ),
      );
    }
    if (
      validTimestamp(record.started_at) &&
      validTimestamp(record.finished_at) &&
      validTimestamp(attempt.started_at) &&
      validTimestamp(attempt.finished_at) &&
      (Date.parse(attempt.started_at) < Date.parse(record.started_at) ||
        Date.parse(attempt.finished_at) > Date.parse(record.finished_at))
    ) {
      errors.push(
        customError(
          "/attempts/0",
          "timeEnvelope",
          "attempt timestamps must remain inside the root run interval",
        ),
      );
    }
    if (attempt.prompt_hash !== record.hashes?.prompt_hash) {
      errors.push(
        customError(
          "/attempts/0/prompt_hash",
          "hashLink",
          "attempt prompt_hash must equal root prompt_hash",
        ),
      );
    }
    if (record.hashes?.model_payload_hash !== attempt.request_payload_hash) {
      errors.push(
        customError(
          "/hashes/model_payload_hash",
          "hashLink",
          "model_payload_hash must equal the single request payload hash",
        ),
      );
    }
    if (attempt.output_item_count < attempt.output_item_types.length) {
      errors.push(
        customError(
          "/attempts/0/output_item_count",
          "diagnosticCount",
          "output_item_count must cover the retained normalized output item types",
        ),
      );
    }
    if (attempt.partial_output_present) {
      if (attempt.partial_output_bytes < 1 || attempt.partial_output_hash === null) {
        errors.push(
          customError(
            "/attempts/0/partial_output_present",
            "partialOutput",
            "present partial output requires positive bytes and a hash",
          ),
        );
      }
    } else if (attempt.partial_output_bytes !== 0 || attempt.partial_output_hash !== null) {
      errors.push(
        customError(
          "/attempts/0/partial_output_present",
          "partialOutput",
          "absent partial output requires zero bytes and null hash",
        ),
      );
    }
    if (attempt.incomplete_reason !== null && attempt.provider_status !== "incomplete") {
      errors.push(
        customError(
          "/attempts/0/incomplete_reason",
          "diagnosticStatus",
          "incomplete_reason requires provider_status incomplete",
        ),
      );
    }
    if (
      attempt.outcome === "truncated" &&
      (attempt.provider_status !== "incomplete" ||
        attempt.incomplete_reason !== "max_output_tokens")
    ) {
      errors.push(
        customError(
          "/attempts/0/outcome",
          "diagnosticStatus",
          "truncated outcome requires max_output_tokens incomplete diagnostics",
        ),
      );
    }
    if (!providerOutcomeIsConsistent(attempt, record.execution_mode)) {
      errors.push(
        customError(
          "/attempts/0",
          "diagnosticStatus",
          "provider status and attempt outcome must describe one consistent terminal state",
        ),
      );
    }
    if (!errorCodeMatchesOutcome(attempt)) {
      errors.push(
        customError(
          "/attempts/0/error_code",
          "diagnosticCode",
          "attempt error_code must match its normalized outcome",
        ),
      );
    }
    if (attempt.outcome === "refused" && attempt.provider_status !== "refused") {
      errors.push(
        customError(
          "/attempts/0/provider_status",
          "diagnosticStatus",
          "refused outcome requires provider_status refused",
        ),
      );
    }

    for (const field of [
      "fixture_input_hash",
      "model_input_hash",
      "prompt_hash",
      "schema_hash",
    ]) {
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
    if (record.execution_mode === "deepseek") {
      if (record.model !== "deepseek-v4-flash") {
        errors.push(
          customError(
            "/model",
            "providerFreeze",
            "a DeepSeek attempt requires the frozen deepseek-v4-flash model",
          ),
        );
      }
      if (record.provider_endpoint !== "https://api.deepseek.com") {
        errors.push(
          customError(
            "/provider_endpoint",
            "providerFreeze",
            "a DeepSeek attempt requires the official API root",
          ),
        );
      }
      if (
        typeof record.implementation_commit_sha !== "string" ||
        !new RegExp(GIT_COMMIT_PATTERN, "u").test(record.implementation_commit_sha)
      ) {
        errors.push(
          customError(
            "/implementation_commit_sha",
            "implementationFreeze",
            "a DeepSeek attempt requires a frozen implementation commit",
          ),
        );
      }
      if (record.implementation_git_clean !== true) {
        errors.push(
          customError(
            "/implementation_git_clean",
            "implementationFreeze",
            "a DeepSeek attempt requires a clean frozen implementation",
          ),
        );
      }
    }
  } else if (record.hashes?.model_payload_hash !== null) {
    errors.push(
      customError(
        "/hashes/model_payload_hash",
        "hashLink",
        "a run without an attempt cannot have a model payload hash",
      ),
    );
  }

  const exhausted = record.status === "failed" && attempts.length === 1;
  if (record.attempt_budget_exhausted !== exhausted) {
    errors.push(
      customError(
        "/attempt_budget_exhausted",
        "attemptBudget",
        "attempt_budget_exhausted must reflect one used failed attempt",
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
          "delivered_output_hash must equal unchanged candidate hash",
        ),
      );
    }
    if (attempt?.outcome !== "completed" || attempt?.error_code !== null) {
      errors.push(
        customError(
          "/attempts/0",
          "successfulAttempt",
          "a successful record requires one completed error-free attempt",
        ),
      );
    }
    if (
      attempt?.provider_status !== "completed" ||
      attempt?.partial_output_present !== false
    ) {
      errors.push(
        customError(
          "/attempts/0/provider_status",
          "successfulAttempt",
          "a successful attempt requires completed status and no partial-output diagnostic",
        ),
      );
    }
    if (
      record.execution_mode === "deepseek" &&
      (!Number.isInteger(attempt?.http_status) ||
        attempt.http_status < 200 ||
        attempt.http_status > 299)
    ) {
      errors.push(
        customError(
          "/attempts/0/http_status",
          "successfulAttempt",
          "a successful DeepSeek attempt requires a 2xx HTTP status",
        ),
      );
    }
    if (record.hashes?.blocked_payload_hash !== null) {
      errors.push(
        customError(
          "/hashes/blocked_payload_hash",
          "blockedPayload",
          "a successful run cannot contain a blocked payload hash",
        ),
      );
    }
    errors.push(...collectSuccessfulCandidateErrors(record));
  } else {
    if (record.hashes?.delivered_output_hash !== null) {
      errors.push(
        customError(
          "/hashes/delivered_output_hash",
          "failedOutput",
          "a failed run cannot have a delivered output hash",
        ),
      );
    }
    if (record.candidate !== null) {
      errors.push(
        customError("/candidate", "failedOutput", "a failed run cannot deliver a candidate"),
      );
    }
    if (
      record.validation_evidence?.evidence_locators.length !== 0 ||
      record.validation_evidence?.profile_refs.length !== 0
    ) {
      errors.push(
        customError(
          "/validation_evidence",
          "failedOutput",
          "a failed run cannot retain validation evidence",
        ),
      );
    }
    if (!failedValidationIsConservative(record)) {
      errors.push(
        customError(
          "/validation",
          "failedValidation",
          "failed validation flags must remain conservative for the error stage",
        ),
      );
    }
    if (
      attempts.length === 1 &&
      (attempts[0].outcome === "completed" ||
        attempts[0].error_code === null ||
        attempts[0].error_code !== record.error?.code)
    ) {
      errors.push(
        customError(
          "/attempts/0",
          "failedAttempt",
          "a failed record requires one non-completed attempt with the same error code",
        ),
      );
    }
    if (record.error?.code === "duplicate_payload_blocked") {
      if (record.hashes?.blocked_payload_hash === null || attempts.length !== 0) {
        errors.push(
          customError(
            "/hashes/blocked_payload_hash",
            "blockedPayload",
            "duplicate blocking requires a hash and zero provider attempts",
          ),
        );
      }
    } else if (record.hashes?.blocked_payload_hash !== null) {
      errors.push(
        customError(
          "/hashes/blocked_payload_hash",
          "blockedPayload",
          "blocked_payload_hash is only valid for duplicate blocking",
        ),
      );
    }
  }

  return errors;
}

export function validatePhase1CoreRunRecord(record) {
  const schemaValid = validateSchema(record);
  const errors = schemaValid ? [] : publicAjvErrors(validateSchema.errors);
  if (schemaValid) errors.push(...collectContractErrors(record));
  return { valid: errors.length === 0, errors };
}

export class Phase1CoreRunRecordValidationError extends Error {
  constructor(errors) {
    super("phase1 core run record does not satisfy phase1-core-run-record-v2");
    this.name = "Phase1CoreRunRecordValidationError";
    this.code = "record_write_failed";
    this.validationErrors = errors;
  }
}

export function assertValidPhase1CoreRunRecord(record) {
  const result = validatePhase1CoreRunRecord(record);
  if (!result.valid) throw new Phase1CoreRunRecordValidationError(result.errors);
  return record;
}
