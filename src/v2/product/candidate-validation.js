import {
  derivePhase2rCoreValidationEvidence,
  validatePhase2rCoreCandidate,
} from "../phase2r/phase2r-core-candidate-validator.js";
import { hashCanonicalJson } from "../validation/canonical-json.js";

export class Phase2aoCandidateGateError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "Phase2aoCandidateGateError";
    this.code = code;
  }
}

/** Accept by identity and prove the frozen Candidate was not repaired. */
export function validatePhase2aoCandidate(candidate, modelInput) {
  let beforeHash;
  try {
    beforeHash = hashCanonicalJson(candidate);
  } catch (error) {
    throw new Phase2aoCandidateGateError(
      "candidate_invalid",
      "The Analyzer Candidate is not canonical JSON.",
      { cause: error },
    );
  }

  let accepted;
  let evidence;
  try {
    accepted = validatePhase2rCoreCandidate(candidate, modelInput);
    evidence = derivePhase2rCoreValidationEvidence(candidate, modelInput);
  } catch (error) {
    throw new Phase2aoCandidateGateError(
      "candidate_invalid",
      "The Analyzer Candidate failed the frozen Candidate v2 gate.",
      { cause: error },
    );
  }
  const afterHash = hashCanonicalJson(candidate);
  if (accepted !== candidate || beforeHash !== afterHash) {
    throw new Phase2aoCandidateGateError(
      "candidate_mutated",
      "The Candidate gate changed the Analyzer Candidate.",
    );
  }
  return Object.freeze({
    candidate,
    candidateHash: beforeHash,
    validationEvidence: evidence,
  });
}
