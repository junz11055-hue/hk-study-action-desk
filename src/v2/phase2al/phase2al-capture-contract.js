import { hashCanonicalJson } from "../validation/canonical-json.js";
import {
  PHASE2AL_AUTHORIZATION_ID,
  PHASE2AL_AUTHORIZATION_VERSION,
  PHASE2AL_CAPTURE_FILE_VERSION,
  PHASE2AL_REQUEST_DESCRIPTOR,
  PHASE2AL_REQUEST_DESCRIPTOR_HASH,
} from "./phase2al-run-contract.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,95}$/u;
const TASK_ID_PATTERN = UUID_PATTERN;

const MARKER_KEYS = Object.freeze([
  "authorization_version",
  "authorization_id",
  "status",
  "run_id",
  "consumed_at",
  "implementation_commit_sha",
  "approval_scope",
  "request_descriptor",
  "request_descriptor_hash",
]);
const INTENT_KEYS = Object.freeze([
  "capture_file_version",
  "kind",
  "run_id",
  "created_at",
  "implementation_commit_sha",
  "authorization_marker_hash",
  "request_descriptor",
  "request_descriptor_hash",
]);
const PROVIDER_TERMINAL_KEYS = Object.freeze([
  "capture_file_version",
  "kind",
  "run_id",
  "recorded_at",
  "request_intent_hash",
  "status",
  "transport_attempted",
  "attempt_count",
  "http_status",
  "provider_status",
  "duration_ms",
  "input_tokens",
  "output_tokens",
  "response_payload_hash",
  "candidate_hash",
  "error_code",
]);
const CANDIDATE_CAPTURE_KEYS = Object.freeze([
  "capture_file_version",
  "kind",
  "run_id",
  "captured_at",
  "provider_terminal_hash",
  "candidate_hash",
  "candidate",
]);
const TASK_TERMINAL_KEYS = Object.freeze([
  "capture_file_version",
  "kind",
  "run_id",
  "recorded_at",
  "task_id",
  "status",
  "provider_terminal_hash",
  "candidate_capture_hash",
  "candidate_hash",
  "action_card_hash",
  "error_code",
]);
const RUN_INDEX_KEYS = Object.freeze([
  "capture_file_version",
  "kind",
  "run_id",
  "completed_at",
  "authorization_marker_hash",
  "request_intent_hash",
  "provider_terminal_hash",
  "candidate_capture_hash",
  "task_terminal_hash",
  "provider_attempt_count",
  "final_status",
]);

export class Phase2alCaptureContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "Phase2alCaptureContractError";
    this.code = "phase2al_capture_contract_invalid";
  }
}

function fail(message) {
  throw new Phase2alCaptureContractError(message);
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  if (!plain(value)) return false;
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function timestamp(value) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function nullableHash(value) {
  return value === null || HASH_PATTERN.test(value ?? "");
}

function nullableCount(value) {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}

function descriptorMatches(value) {
  return (
    plain(value) &&
    hashCanonicalJson(value) === PHASE2AL_REQUEST_DESCRIPTOR_HASH &&
    hashCanonicalJson(value) === hashCanonicalJson(PHASE2AL_REQUEST_DESCRIPTOR)
  );
}

export function assertPhase2alAuthorizationMarker(value) {
  if (
    !exactKeys(value, MARKER_KEYS) ||
    value.authorization_version !== PHASE2AL_AUTHORIZATION_VERSION ||
    value.authorization_id !== PHASE2AL_AUTHORIZATION_ID ||
    value.status !== "consumed" ||
    !UUID_PATTERN.test(value.run_id ?? "") ||
    !timestamp(value.consumed_at) ||
    !COMMIT_PATTERN.test(value.implementation_commit_sha ?? "") ||
    value.approval_scope !== "phase2al_dev001_one_shot_live_e2e" ||
    !descriptorMatches(value.request_descriptor) ||
    value.request_descriptor_hash !== PHASE2AL_REQUEST_DESCRIPTOR_HASH
  ) {
    fail("Phase 2A-L authorization marker drifted.");
  }
  return value;
}

export function assertPhase2alRequestIntent(value) {
  if (
    !exactKeys(value, INTENT_KEYS) ||
    value.capture_file_version !== PHASE2AL_CAPTURE_FILE_VERSION ||
    value.kind !== "request_intent" ||
    !UUID_PATTERN.test(value.run_id ?? "") ||
    !timestamp(value.created_at) ||
    !COMMIT_PATTERN.test(value.implementation_commit_sha ?? "") ||
    !HASH_PATTERN.test(value.authorization_marker_hash ?? "") ||
    !descriptorMatches(value.request_descriptor) ||
    value.request_descriptor_hash !== PHASE2AL_REQUEST_DESCRIPTOR_HASH
  ) {
    fail("Phase 2A-L request intent drifted.");
  }
  return value;
}

export function assertPhase2alProviderTerminal(value) {
  const completed = value?.status === "completed";
  const noTransport = value?.status === "failed_without_transport";
  const attemptedFailure = value?.status === "request_failed";
  if (
    !exactKeys(value, PROVIDER_TERMINAL_KEYS) ||
    value.capture_file_version !== PHASE2AL_CAPTURE_FILE_VERSION ||
    value.kind !== "provider_terminal" ||
    !UUID_PATTERN.test(value.run_id ?? "") ||
    !timestamp(value.recorded_at) ||
    !HASH_PATTERN.test(value.request_intent_hash ?? "") ||
    !["completed", "failed_without_transport", "request_failed"].includes(value.status) ||
    typeof value.transport_attempted !== "boolean" ||
    ![0, 1].includes(value.attempt_count) ||
    value.transport_attempted !== (value.attempt_count === 1) ||
    !(value.http_status === null || (Number.isInteger(value.http_status) && value.http_status >= 100 && value.http_status <= 599)) ||
    !(value.provider_status === null || /^[a-z][a-z_]{0,31}$/u.test(value.provider_status)) ||
    !nullableCount(value.duration_ms) ||
    !nullableCount(value.input_tokens) ||
    !nullableCount(value.output_tokens) ||
    !nullableHash(value.response_payload_hash) ||
    !nullableHash(value.candidate_hash) ||
    !(value.error_code === null || ERROR_CODE_PATTERN.test(value.error_code ?? "")) ||
    (completed &&
      (!value.transport_attempted ||
        value.attempt_count !== 1 ||
        value.provider_status !== "completed" ||
        value.candidate_hash === null ||
        value.error_code !== null)) ||
    (noTransport &&
      (value.transport_attempted ||
        value.attempt_count !== 0 ||
        value.http_status !== null ||
        value.response_payload_hash !== null ||
        value.candidate_hash !== null ||
        value.error_code === null)) ||
    (attemptedFailure &&
      (!value.transport_attempted ||
        value.attempt_count !== 1 ||
        value.candidate_hash !== null ||
        value.error_code === null))
  ) {
    fail("Phase 2A-L provider terminal drifted.");
  }
  return value;
}

export function assertPhase2alCandidateCapture(value) {
  let candidateHash = null;
  try {
    candidateHash = hashCanonicalJson(value?.candidate);
  } catch {
    // Closed below.
  }
  if (
    !exactKeys(value, CANDIDATE_CAPTURE_KEYS) ||
    value.capture_file_version !== PHASE2AL_CAPTURE_FILE_VERSION ||
    value.kind !== "candidate_capture" ||
    !UUID_PATTERN.test(value.run_id ?? "") ||
    !timestamp(value.captured_at) ||
    !HASH_PATTERN.test(value.provider_terminal_hash ?? "") ||
    !HASH_PATTERN.test(value.candidate_hash ?? "") ||
    value.candidate_hash !== candidateHash ||
    Buffer.byteLength(JSON.stringify(value.candidate), "utf8") > 1_000_000
  ) {
    fail("Phase 2A-L Candidate capture drifted.");
  }
  return value;
}

export function assertPhase2alTaskTerminal(value) {
  const succeeded = value?.status === "succeeded";
  if (
    !exactKeys(value, TASK_TERMINAL_KEYS) ||
    value.capture_file_version !== PHASE2AL_CAPTURE_FILE_VERSION ||
    value.kind !== "task_terminal" ||
    !UUID_PATTERN.test(value.run_id ?? "") ||
    !timestamp(value.recorded_at) ||
    !TASK_ID_PATTERN.test(value.task_id ?? "") ||
    !["succeeded", "failed"].includes(value.status) ||
    !HASH_PATTERN.test(value.provider_terminal_hash ?? "") ||
    !nullableHash(value.candidate_capture_hash) ||
    !nullableHash(value.candidate_hash) ||
    !nullableHash(value.action_card_hash) ||
    !(value.error_code === null || /^[A-Z][A-Z0-9_]{0,63}$/u.test(value.error_code ?? "")) ||
    (succeeded &&
      (value.candidate_capture_hash === null ||
        value.candidate_hash === null ||
        value.action_card_hash === null ||
        value.error_code !== null)) ||
    (!succeeded && (value.action_card_hash !== null || value.error_code === null))
  ) {
    fail("Phase 2A-L task terminal drifted.");
  }
  return value;
}

export function assertPhase2alRunIndex(value) {
  if (
    !exactKeys(value, RUN_INDEX_KEYS) ||
    value.capture_file_version !== PHASE2AL_CAPTURE_FILE_VERSION ||
    value.kind !== "run_index" ||
    !UUID_PATTERN.test(value.run_id ?? "") ||
    !timestamp(value.completed_at) ||
    !HASH_PATTERN.test(value.authorization_marker_hash ?? "") ||
    !HASH_PATTERN.test(value.request_intent_hash ?? "") ||
    !HASH_PATTERN.test(value.provider_terminal_hash ?? "") ||
    !nullableHash(value.candidate_capture_hash) ||
    !HASH_PATTERN.test(value.task_terminal_hash ?? "") ||
    ![0, 1].includes(value.provider_attempt_count) ||
    !["succeeded", "failed"].includes(value.final_status)
  ) {
    fail("Phase 2A-L run index drifted.");
  }
  return value;
}
