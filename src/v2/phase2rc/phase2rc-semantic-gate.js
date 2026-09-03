import {
  validatePhase2rCoreCandidate,
} from "../phase2r/phase2r-core-candidate-validator.js";

const HIGH_CONSEQUENCE_LEVELS = new Set(["medium", "high"]);
const UNSUPPORTED_RECOVERY_LANGUAGE = /(?:不可?|未必可?)(?:恢复|挽回)|可恢复|可挽回/u;
const EXPLICIT_NO_ACTION = /\bno action is required\b|无需(?:采取)?(?:任何)?(?:行动|操作)|毋須(?:採取)?(?:任何)?行動/iu;
const LABORATORY_INDUCTION = /(?:laborator(?:y|ies).*\binduction\b|\binduction\b.*laborator(?:y|ies))/iu;

export class Phase2rcSemanticGateError extends Error {
  constructor(issues) {
    super("The Candidate failed the Phase 2R-C offline semantic gate.");
    this.name = "Phase2rcSemanticGateError";
    this.code = "candidate_semantic_gate_failed";
    this.issues = Object.freeze(
      issues.map((issue) => Object.freeze({ ...issue })),
    );
  }
}

function addIssue(issues, code, path) {
  issues.push(Object.freeze({ code, path }));
}

function citedQuotes(claim, evidenceById) {
  return claim.evidence_refs.map((id) => evidenceById.get(id)?.quote ?? "");
}

function assertClaimType(issues, claim, expectedType, path) {
  if (claim !== undefined && claim.type !== expectedType) {
    addIssue(issues, `${expectedType}_claim_type_invalid`, path);
  }
}

function candidateChineseText(candidate) {
  return [
    candidate.title_zh,
    candidate.summary_zh,
    candidate.applicability.reason_zh,
    ...candidate.claims.map((claim) => claim.text_zh),
    ...candidate.actions.flatMap((action) => [
      action.actor_zh,
      action.verb_zh,
      action.object_zh,
    ]),
    candidate.consequence.reason_zh,
  ].join("\n");
}

/**
 * Adds deterministic structural/lexical checks for the semantic failures found
 * in the Phase 2R-B manual review. It validates and rejects; it never repairs.
 */
export function validatePhase2rcSemanticCandidate(candidate, modelInput) {
  validatePhase2rCoreCandidate(candidate, modelInput);

  const issues = [];
  const claimsById = new Map(
    candidate.claims.map((claim) => [claim.claim_id, claim]),
  );
  const evidenceById = new Map(
    candidate.evidence.map((evidence) => [evidence.evidence_id, evidence]),
  );
  const applicabilityClaim =
    candidate.applicability.claim_ref === null
      ? undefined
      : claimsById.get(candidate.applicability.claim_ref);
  const consequenceClaim =
    candidate.consequence.claim_ref === null
      ? undefined
      : claimsById.get(candidate.consequence.claim_ref);

  if (candidate.applicability.value === "not_applicable") {
    assertClaimType(
      issues,
      applicabilityClaim,
      "audience",
      "$.applicability.claim_ref",
    );
  }

  const mandatoryActions = [];
  candidate.actions.forEach((action, actionIndex) => {
    const actionClaims = action.claim_refs
      .map((claimId) => claimsById.get(claimId))
      .filter(Boolean);
    if (!actionClaims.some((claim) => claim.type === "action")) {
      addIssue(
        issues,
        "action_claim_missing",
        `$.actions[${actionIndex}].claim_refs`,
      );
    }
    if (action.obligation === "mandatory") {
      mandatoryActions.push(action);
      actionClaims.forEach((claim) => {
        if (claim.high_impact !== true) {
          addIssue(
            issues,
            "mandatory_claim_not_high_impact",
            `$.claims[${candidate.claims.indexOf(claim)}].high_impact`,
          );
        }
      });
    }
  });

  if (
    mandatoryActions.length > 0 &&
    applicabilityClaim !== undefined &&
    applicabilityClaim.high_impact !== true
  ) {
    addIssue(
      issues,
      "mandatory_audience_not_high_impact",
      `$.claims[${candidate.claims.indexOf(applicabilityClaim)}].high_impact`,
    );
  }

  if (
    HIGH_CONSEQUENCE_LEVELS.has(candidate.consequence.level) &&
    consequenceClaim !== undefined &&
    consequenceClaim.high_impact !== true
  ) {
    addIssue(
      issues,
      "consequence_claim_not_high_impact",
      `$.claims[${candidate.claims.indexOf(consequenceClaim)}].high_impact`,
    );
  }

  const senderSchoolName = modelInput.source_context.sender_school_name;
  if (senderSchoolName !== null) {
    candidate.claims.forEach((claim, claimIndex) => {
      const support = citedQuotes(claim, evidenceById).join("\n");
      if (
        claim.text_zh.includes(senderSchoolName) &&
        !support.includes(senderSchoolName)
      ) {
        addIssue(
          issues,
          "source_context_not_body_evidenced",
          `$.claims[${claimIndex}].text_zh`,
        );
      }
    });
  }

  if (EXPLICIT_NO_ACTION.test(modelInput.message.body)) {
    const noActionClaims = candidate.claims.filter((claim) =>
      citedQuotes(claim, evidenceById).some((quote) => EXPLICIT_NO_ACTION.test(quote)),
    );
    if (noActionClaims.length === 0) {
      addIssue(
        issues,
        "explicit_no_action_evidence_missing",
        "$.claims",
      );
    } else if (
      !noActionClaims.some(
        (claim) =>
          claim.type === "action" &&
          claim.high_impact === false &&
          candidate.summary_claim_refs.includes(claim.claim_id),
      )
    ) {
      addIssue(
        issues,
        "explicit_no_action_summary_binding_invalid",
        "$.summary_claim_refs",
      );
    }
    if (candidate.actions.length !== 0) {
      addIssue(issues, "explicit_no_action_has_action", "$.actions");
    }
    if (
      candidate.applicability.value === "not_applicable" &&
      consequenceClaim !== undefined &&
      !citedQuotes(consequenceClaim, evidenceById).some((quote) =>
        EXPLICIT_NO_ACTION.test(quote),
      )
    ) {
      addIssue(
        issues,
        "explicit_no_action_consequence_binding_invalid",
        "$.consequence.claim_ref",
      );
    }
  }

  if (LABORATORY_INDUCTION.test(modelInput.message.body)) {
    if (/导修/u.test(candidateChineseText(candidate))) {
      addIssue(issues, "laboratory_induction_translation_invalid", "$.*");
    }
    if (
      !candidate.actions.some(
        (action) => /实验室/u.test(action.object_zh) && /培训/u.test(action.object_zh),
      )
    ) {
      addIssue(
        issues,
        "laboratory_induction_action_object_invalid",
        "$.actions[*].object_zh",
      );
    }
  }

  if (
    consequenceClaim !== undefined &&
    UNSUPPORTED_RECOVERY_LANGUAGE.test(candidate.consequence.reason_zh) &&
    !citedQuotes(consequenceClaim, evidenceById).some((quote) =>
      UNSUPPORTED_RECOVERY_LANGUAGE.test(quote),
    )
  ) {
    addIssue(
      issues,
      "consequence_reason_recovery_unsupported",
      "$.consequence.reason_zh",
    );
  }

  if (issues.length > 0) throw new Phase2rcSemanticGateError(issues);
  return candidate;
}
