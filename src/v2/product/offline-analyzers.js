import { hashCanonicalJson } from "../validation/canonical-json.js";
import {
  DEV001_CAPTURED_REPLAY_CANDIDATE,
  DEV001_CAPTURED_REPLAY_CANDIDATE_HASH,
  DEV001_SYNTHETIC_MOCK_CANDIDATE,
} from "./fixtures/offline-candidates.js";
import {
  PHASE2AO_CASE_ID,
  PHASE2AO_MODEL_INPUT_HASH,
} from "./product-input-loader.js";

export const DEV001_SYNTHETIC_MOCK_CANDIDATE_HASH =
  "sha256:d584ef728eaf0eab32fe0735544551a390f2a5b0520c51175e11e80cd0594ded";

const CANDIDATES = Object.freeze({
  synthetic_mock: Object.freeze({
    candidate: DEV001_SYNTHETIC_MOCK_CANDIDATE,
    hash: DEV001_SYNTHETIC_MOCK_CANDIDATE_HASH,
  }),
  captured_replay: Object.freeze({
    candidate: DEV001_CAPTURED_REPLAY_CANDIDATE,
    hash: DEV001_CAPTURED_REPLAY_CANDIDATE_HASH,
  }),
});

export class Phase2aoAnalyzerError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "Phase2aoAnalyzerError";
    this.code = code;
  }
}
function assertPinnedCandidate(mode, record) {
  if (hashCanonicalJson(record.candidate) !== record.hash) {
    throw new Phase2aoAnalyzerError(
      "offline_candidate_integrity_error",
      `The pinned ${mode} Candidate drifted.`,
    );
  }
}

for (const [mode, record] of Object.entries(CANDIDATES)) {
  assertPinnedCandidate(mode, record);
}

/**
 * Create an offline-only Analyzer. It has no provider, environment, fetch, or
 * dynamic-import path. The returned Candidate is a fresh JSON clone so tests
 * and callers cannot mutate the pinned fixture.
 */
export function createPhase2aoOfflineAnalyzer({
  executionMode,
  onAnalyze = undefined,
} = {}) {
  const record = CANDIDATES[executionMode];
  if (record === undefined) {
    throw new Phase2aoAnalyzerError(
      "execution_mode_not_offline",
      "Phase 2A-O only supports synthetic Mock or captured Replay.",
    );
  }
  if (onAnalyze !== undefined && typeof onAnalyze !== "function") {
    throw new TypeError("onAnalyze must be a function");
  }
  let callCount = 0;

  return Object.freeze({
    executionMode,
    get callCount() {
      return callCount;
    },
    async analyze({ caseId, modelInput } = {}) {
      if (
        caseId !== PHASE2AO_CASE_ID ||
        hashCanonicalJson(modelInput) !== PHASE2AO_MODEL_INPUT_HASH
      ) {
        throw new Phase2aoAnalyzerError(
          "analyzer_input_invalid",
          "The offline Analyzer received an unapproved Product Input.",
        );
      }
      callCount += 1;
      await onAnalyze?.({ caseId, executionMode, callCount });
      assertPinnedCandidate(executionMode, record);
      return Object.freeze({
        executionMode,
        candidate: structuredClone(record.candidate),
        candidateFixtureHash: record.hash,
      });
    },
  });
}
