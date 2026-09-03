export const CORE_CANDIDATE_FAILURE_DIAGNOSTIC_VERSION =
  "core-candidate-failure-diagnostic-v1";

const VALID_REASONS = new Set([
  "schema_invalid",
  "reference_invalid",
  "evidence_invalid",
  "language_invalid",
  "forbidden_field",
  "candidate_unserializable",
  "output_truncated",
  "invalid_json",
  "model_refused",
  "provider_failure",
  "provider_incomplete",
  "harness_failure",
]);

const REASON_BY_CODE = Object.freeze({
  candidate_schema_invalid: "schema_invalid",
  candidate_reference_invalid: "reference_invalid",
  candidate_evidence_invalid: "evidence_invalid",
  candidate_language_invalid: "language_invalid",
  candidate_forbidden_field: "forbidden_field",
  model_refused: "model_refused",
  model_response_invalid: "invalid_json",
  internal_error: "harness_failure",
});

const ROOT_FIELDS = new Set([
  "title_zh",
  "title_claim_refs",
  "summary_zh",
  "summary_claim_refs",
  "topics",
  "applicability",
  "claims",
  "evidence",
  "actions",
  "deadlines",
  "consequence",
]);

const OBJECT_FIELDS = Object.freeze({
  topics: new Set(["label", "claim_refs"]),
  claims: new Set([
    "claim_id",
    "type",
    "text_zh",
    "high_impact",
    "evidence_refs",
  ]),
  evidence: new Set(["evidence_id", "quote"]),
  actions: new Set([
    "action_id",
    "actor_zh",
    "verb_zh",
    "object_zh",
    "obligation",
    "claim_refs",
  ]),
  deadlines: new Set([
    "deadline_id",
    "original_text",
    "role",
    "claim_ref",
  ]),
});

const SINGLE_OBJECT_FIELDS = Object.freeze({
  applicability: new Set([
    "scope",
    "value",
    "reason_zh",
    "claim_ref",
    "profile_field_ids",
  ]),
  consequence: new Set(["level", "reason_zh", "claim_ref"]),
});

function normalizePath(value) {
  if (typeof value !== "string" || !value.startsWith("$.")) return "$.*";
  const arrayMatch = /^\$\.(topics|claims|evidence|actions|deadlines)\[\d+\](?:\.([A-Za-z0-9_]+))?/u.exec(
    value,
  );
  if (arrayMatch) {
    const [, family, field] = arrayMatch;
    if (!field) return `$.${family}[*]`;
    return OBJECT_FIELDS[family].has(field)
      ? `$.${family}[*].${field}`
      : `$.${family}[*].*`;
  }

  const objectMatch = /^\$\.(applicability|consequence)(?:\.([A-Za-z0-9_]+))?/u.exec(
    value,
  );
  if (objectMatch) {
    const [, family, field] = objectMatch;
    if (!field) return `$.${family}`;
    return SINGLE_OBJECT_FIELDS[family].has(field)
      ? `$.${family}.${field}`
      : `$.${family}.*`;
  }

  const rootMatch = /^\$\.([A-Za-z0-9_]+)/u.exec(value);
  if (!rootMatch) return "$.*";
  return ROOT_FIELDS.has(rootMatch[1]) ? `$.${rootMatch[1]}` : "$.*";
}

function normalizedPaths(values) {
  if (!Array.isArray(values)) return Object.freeze([]);
  return Object.freeze(
    [...new Set(values.map(normalizePath))].slice(0, 8),
  );
}

function candidateShape(candidate) {
  if (candidate === null) return Object.freeze({ root_type: "null" });
  if (Array.isArray(candidate)) return Object.freeze({ root_type: "array" });
  if (typeof candidate !== "object") {
    return Object.freeze({ root_type: typeof candidate });
  }
  const counts = {};
  for (const field of ["topics", "claims", "evidence", "actions", "deadlines"]) {
    counts[`${field}_count`] = Array.isArray(candidate[field])
      ? Math.min(candidate[field].length, 1_000)
      : null;
  }
  return Object.freeze({ root_type: "object", ...counts });
}

function normalizedReason(reason, code) {
  if (VALID_REASONS.has(reason)) return reason;
  return REASON_BY_CODE[code] ?? "harness_failure";
}

export function createCandidateFailureDiagnostic({
  candidate,
  code,
  reason,
  jsonPaths = [],
}) {
  return Object.freeze({
    diagnostic_version: CORE_CANDIDATE_FAILURE_DIAGNOSTIC_VERSION,
    stage: "candidate_validation",
    reason: normalizedReason(reason, code),
    field_paths: normalizedPaths(jsonPaths),
    candidate_shape: candidateShape(candidate),
  });
}

export function createProviderFailureDiagnostic({
  outcome,
  code,
  providerStatus = null,
  incompleteReason = null,
}) {
  let reason = "provider_failure";
  if (outcome === "truncated") reason = "output_truncated";
  else if (outcome === "invalid_json") reason = "invalid_json";
  else if (outcome === "refused") reason = "model_refused";
  else if (providerStatus === "incomplete") reason = "provider_incomplete";
  else if (outcome === "harness_error" || code === "internal_error") {
    reason = "harness_failure";
  } else if (code === "model_refused") reason = "model_refused";
  return Object.freeze({
    diagnostic_version: CORE_CANDIDATE_FAILURE_DIAGNOSTIC_VERSION,
    stage: "provider_response",
    reason,
    field_paths: Object.freeze([]),
    candidate_shape: null,
  });
}
