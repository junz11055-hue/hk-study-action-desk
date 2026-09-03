import {
  derivePhase2CoreValidationEvidence,
  validatePhase2CoreCandidate,
} from "../validation/phase2-core-candidate-validator.js";
import {
  toPhase2LegacyModelInput,
  validatePhase2rModelInput,
} from "./phase2r-model-input-validator.js";

function legacyContext(modelInput) {
  validatePhase2rModelInput(modelInput);
  return toPhase2LegacyModelInput(modelInput);
}

export function validatePhase2rCoreCandidate(candidate, modelInput) {
  return validatePhase2CoreCandidate(candidate, legacyContext(modelInput));
}

export function derivePhase2rCoreValidationEvidence(candidate, modelInput) {
  return derivePhase2CoreValidationEvidence(candidate, legacyContext(modelInput));
}
