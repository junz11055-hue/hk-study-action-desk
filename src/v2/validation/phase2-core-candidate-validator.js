import {
  assertCoreCandidateSafeStructure,
  CoreCandidateValidationError,
} from "./core-candidate-validator.js";
import { validatePhase2ModelInput } from "../phase2/phase2-model-input-validator.js";

const PROFILE_REQUIRED_SCOPES = new Set([
  "current_user",
  "confirmed_course",
  "programme",
  "cohort",
  "department",
]);

function fail(code, message, jsonPaths = []) {
  throw new CoreCandidateValidationError(code, message, jsonPaths);
}

function childPath(parent, key) {
  return typeof key === "number" ? `${parent}[${key}]` : `${parent}.${key}`;
}

function assertUnique(values, path) {
  if (new Set(values).size !== values.length) {
    fail("candidate_reference_invalid", `${path} must not contain duplicates`, [path]);
  }
}

function indexUnique(items, idKey, path) {
  const indexed = new Map();
  for (let index = 0; index < items.length; index += 1) {
    const id = items[index][idKey];
    if (indexed.has(id)) {
      fail(
        "candidate_reference_invalid",
        `${path} contains duplicate ID`,
        [`${path}[${index}].${idKey}`],
      );
    }
    indexed.set(id, items[index]);
  }
  return indexed;
}

function assertReferences(values, target, path) {
  assertUnique(values, path);
  if (values.some((value) => !target.has(value))) {
    fail(
      "candidate_reference_invalid",
      `${path} contains an unknown reference`,
      [path],
    );
  }
}

function locateUniqueBodyQuote(quote, body, path) {
  const start = body.indexOf(quote);
  if (start === -1) {
    fail(
      "candidate_evidence_invalid",
      "Evidence quote is not an exact message.body substring",
      [path],
    );
  }
  if (body.indexOf(quote, start + 1) !== -1) {
    fail(
      "candidate_evidence_invalid",
      "Evidence quote must occur exactly once in message.body",
      [path],
    );
  }
  return { start, end: start + quote.length };
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function validateAndDerive(candidate, modelInput) {
  assertCoreCandidateSafeStructure(candidate);
  validatePhase2ModelInput(modelInput);

  const claims = indexUnique(candidate.claims, "claim_id", "$.claims");
  const evidence = indexUnique(candidate.evidence, "evidence_id", "$.evidence");
  const profileRefs = indexUnique(
    modelInput.profile_refs,
    "profile_field_id",
    "$.profile_refs",
  );
  indexUnique(candidate.actions, "action_id", "$.actions");
  indexUnique(candidate.deadlines, "deadline_id", "$.deadlines");
  assertUnique(
    candidate.topics.map((topic) => topic.label),
    "$.topics",
  );

  assertReferences(candidate.title_claim_refs, claims, "$.title_claim_refs");
  assertReferences(candidate.summary_claim_refs, claims, "$.summary_claim_refs");
  candidate.topics.forEach((topic, index) =>
    assertReferences(topic.claim_refs, claims, `$.topics[${index}].claim_refs`),
  );
  candidate.claims.forEach((claim, index) =>
    assertReferences(
      claim.evidence_refs,
      evidence,
      `$.claims[${index}].evidence_refs`,
    ),
  );

  const bodyEvidenceLocations = candidate.evidence.map((item, index) => {
    const location = locateUniqueBodyQuote(
      item.quote,
      modelInput.message.body,
      `$.evidence[${index}].quote`,
    );
    return {
      evidence_id: item.evidence_id,
      source: "body",
      locator: {
        kind: "utf16_range",
        start: location.start,
        end: location.end,
      },
    };
  });

  const applicability = candidate.applicability;
  if (applicability.claim_ref !== null) {
    assertReferences(
      [applicability.claim_ref],
      claims,
      "$.applicability.claim_ref",
    );
  }
  assertReferences(
    applicability.profile_field_ids,
    profileRefs,
    "$.applicability.profile_field_ids",
  );
  if (applicability.value === "applies") {
    if (applicability.claim_ref === null) {
      fail(
        "candidate_reference_invalid",
        "Applicable Core Candidate requires a supporting Claim",
        ["$.applicability.claim_ref"],
      );
    }
    if (
      PROFILE_REQUIRED_SCOPES.has(applicability.scope) &&
      applicability.profile_field_ids.length === 0
    ) {
      fail(
        "candidate_reference_invalid",
        "Applicable profile scope requires a projected profile reference",
        ["$.applicability.profile_field_ids"],
      );
    }
  }
  if (
    (applicability.scope === "not_applicable") !==
    (applicability.value === "not_applicable")
  ) {
    fail(
      "candidate_reference_invalid",
      "not_applicable scope and value must agree",
      ["$.applicability.scope", "$.applicability.value"],
    );
  }

  candidate.actions.forEach((action, index) =>
    assertReferences(action.claim_refs, claims, `$.actions[${index}].claim_refs`),
  );

  candidate.deadlines.forEach((deadline, index) => {
    const path = `$.deadlines[${index}]`;
    assertReferences([deadline.claim_ref], claims, `${path}.claim_ref`);
    const claim = claims.get(deadline.claim_ref);
    const supported = claim.evidence_refs.some((evidenceId) =>
      evidence.get(evidenceId).quote.includes(deadline.original_text),
    );
    if (!supported) {
      fail(
        "candidate_evidence_invalid",
        "Deadline original_text is not supported by its Claim evidence",
        [`${path}.original_text`, `${path}.claim_ref`],
      );
    }
  });

  if (candidate.consequence.claim_ref !== null) {
    assertReferences(
      [candidate.consequence.claim_ref],
      claims,
      "$.consequence.claim_ref",
    );
  } else if (candidate.consequence.level !== "unknown") {
    fail(
      "candidate_reference_invalid",
      "A known consequence level requires a supporting Claim",
      ["$.consequence.claim_ref"],
    );
  }

  return deepFreeze({
    body_evidence_locations: bodyEvidenceLocations,
    profile_ref_matches: applicability.profile_field_ids.map((id) => ({
      profile_field_id: id,
      field_type: profileRefs.get(id).field_type,
      value: profileRefs.get(id).value,
    })),
  });
}

/**
 * Validate a Core Candidate against the broader Phase 2 model-input context.
 * The accepted Candidate is returned by identity and is never repaired.
 */
export function validatePhase2CoreCandidate(candidate, modelInput) {
  validateAndDerive(candidate, modelInput);
  return candidate;
}

/** Derive trusted locators and profile matches without modifying Candidate. */
export function derivePhase2CoreValidationEvidence(candidate, modelInput) {
  return validateAndDerive(candidate, modelInput);
}

export { CoreCandidateValidationError };
