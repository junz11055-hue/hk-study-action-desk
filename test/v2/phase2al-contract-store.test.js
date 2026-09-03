import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { hashCanonicalJson } from "../../src/v2/validation/canonical-json.js";
import {
  assertPhase2alAuthorizationMarker,
  assertPhase2alCandidateCapture,
  assertPhase2alProviderTerminal,
  assertPhase2alRequestIntent,
  assertPhase2alRunIndex,
  assertPhase2alTaskTerminal,
} from "../../src/v2/phase2al/phase2al-capture-contract.js";
import {
  createPhase2alAuthorizationMarker,
  phase2alRunDirectory,
  writePhase2alCandidateCapture,
  writePhase2alProviderTerminal,
  writePhase2alRequestIntent,
  writePhase2alRunIndex,
  writePhase2alTaskTerminal,
} from "../../src/v2/phase2al/phase2al-capture-store.js";
import {
  PHASE2AL_AUTHORIZATION_ID,
  PHASE2AL_AUTHORIZATION_VERSION,
  PHASE2AL_CAPTURE_FILE_VERSION,
  PHASE2AL_REQUEST_DESCRIPTOR,
  PHASE2AL_REQUEST_DESCRIPTOR_HASH,
} from "../../src/v2/phase2al/phase2al-run-contract.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const COMMIT = "a".repeat(40);
const NOW = "2026-09-01T01:00:00.000Z";
const HASH = `sha256:${"b".repeat(64)}`;

async function tempRuntime(t) {
  const created = await mkdtemp(path.join(tmpdir(), "phase2al-store-"));
  const directory = await realpath(created);
  t.after(async () => rm(directory, { recursive: true, force: true }));
  return directory;
}

function marker() {
  return {
    authorization_version: PHASE2AL_AUTHORIZATION_VERSION,
    authorization_id: PHASE2AL_AUTHORIZATION_ID,
    status: "consumed",
    run_id: RUN_ID,
    consumed_at: NOW,
    implementation_commit_sha: COMMIT,
    approval_scope: "phase2al_dev001_one_shot_live_e2e",
    request_descriptor: { ...PHASE2AL_REQUEST_DESCRIPTOR },
    request_descriptor_hash: PHASE2AL_REQUEST_DESCRIPTOR_HASH,
  };
}

function intent(markerHash = HASH) {
  return {
    capture_file_version: PHASE2AL_CAPTURE_FILE_VERSION,
    kind: "request_intent",
    run_id: RUN_ID,
    created_at: NOW,
    implementation_commit_sha: COMMIT,
    authorization_marker_hash: markerHash,
    request_descriptor: { ...PHASE2AL_REQUEST_DESCRIPTOR },
    request_descriptor_hash: PHASE2AL_REQUEST_DESCRIPTOR_HASH,
  };
}

function provider(overrides = {}) {
  return {
    capture_file_version: PHASE2AL_CAPTURE_FILE_VERSION,
    kind: "provider_terminal",
    run_id: RUN_ID,
    recorded_at: NOW,
    request_intent_hash: HASH,
    status: "failed_without_transport",
    transport_attempted: false,
    attempt_count: 0,
    http_status: null,
    provider_status: null,
    duration_ms: null,
    input_tokens: null,
    output_tokens: null,
    response_payload_hash: null,
    candidate_hash: null,
    error_code: "model_configuration_invalid",
    ...overrides,
  };
}

test("Phase 2A-L frozen request descriptor matches historical DEV001", () => {
  assert.equal(PHASE2AL_REQUEST_DESCRIPTOR.model_input_hash, "sha256:5f7e4d9e243e95a0f11ac7736f330252d6939ff845658cd91b04e88177888b5e");
  assert.equal(PHASE2AL_REQUEST_DESCRIPTOR.request_payload_hash, "sha256:44e12abde3db8918112f0a3e2bdd2938d0ab1415ec2acd1ae6aa8691bf922240");
  assert.equal(PHASE2AL_REQUEST_DESCRIPTOR.request_utf8_bytes, 9_424);
  assert.equal(PHASE2AL_REQUEST_DESCRIPTOR.max_requests, 1);
  assert.equal(PHASE2AL_REQUEST_DESCRIPTOR.retries, 0);
  assert.equal(PHASE2AL_REQUEST_DESCRIPTOR.max_output_tokens, 8_000);
  assert.equal(PHASE2AL_REQUEST_DESCRIPTOR.timeout_ms, 90_000);
});

test("Capture contracts reject unknown fields and inconsistent attempt claims", () => {
  assert.doesNotThrow(() => assertPhase2alAuthorizationMarker(marker()));
  assert.doesNotThrow(() => assertPhase2alRequestIntent(intent()));
  assert.doesNotThrow(() => assertPhase2alProviderTerminal(provider()));

  const unknown = { ...marker(), api_key: "forbidden" };
  assert.throws(() => assertPhase2alAuthorizationMarker(unknown));
  assert.throws(() =>
    assertPhase2alProviderTerminal(provider({ attempt_count: 1 })),
  );
});
test("Private store consumes authorization once and writes a closed hash chain", async (t) => {
  const runtimeDirectory = await tempRuntime(t);
  const [first, second] = await Promise.allSettled([
    createPhase2alAuthorizationMarker(marker(), { runtimeDirectory }),
    createPhase2alAuthorizationMarker(marker(), { runtimeDirectory }),
  ]);
  assert.deepEqual([first.status, second.status].sort(), ["fulfilled", "rejected"]);
  const markerWrite = first.status === "fulfilled" ? first.value : second.value;
  const rejection = first.status === "rejected" ? first.reason : second.reason;
  assert.equal(rejection.code, "phase2al_authorization_already_consumed");

  const intentWrite = await writePhase2alRequestIntent(intent(markerWrite.hash), {
    runtimeDirectory,
  });
  const terminalWrite = await writePhase2alProviderTerminal(
    provider({ request_intent_hash: intentWrite.hash }),
    { runtimeDirectory },
  );
  const taskTerminal = {
    capture_file_version: PHASE2AL_CAPTURE_FILE_VERSION,
    kind: "task_terminal",
    run_id: RUN_ID,
    recorded_at: NOW,
    task_id: TASK_ID,
    status: "failed",
    provider_terminal_hash: terminalWrite.hash,
    candidate_capture_hash: null,
    candidate_hash: null,
    action_card_hash: null,
    error_code: "ANALYZER_FAILED",
  };
  assertPhase2alTaskTerminal(taskTerminal);
  const taskWrite = await writePhase2alTaskTerminal(taskTerminal, {
    runtimeDirectory,
  });
  const index = {
    capture_file_version: PHASE2AL_CAPTURE_FILE_VERSION,
    kind: "run_index",
    run_id: RUN_ID,
    completed_at: NOW,
    authorization_marker_hash: markerWrite.hash,
    request_intent_hash: intentWrite.hash,
    provider_terminal_hash: terminalWrite.hash,
    candidate_capture_hash: null,
    task_terminal_hash: taskWrite.hash,
    provider_attempt_count: 0,
    final_status: "failed",
  };
  assertPhase2alRunIndex(index);
  await writePhase2alRunIndex(index, { runtimeDirectory });

  const rootMode = (await lstat(runtimeDirectory)).mode & 0o777;
  const runMode = (await lstat(phase2alRunDirectory(RUN_ID, { runtimeDirectory }))).mode & 0o777;
  assert.equal(rootMode, 0o700);
  assert.equal(runMode, 0o700);
  for (const file of [
    path.join(runtimeDirectory, "authorization-consumed.json"),
    path.join(phase2alRunDirectory(RUN_ID, { runtimeDirectory }), "request-intent.json"),
    path.join(phase2alRunDirectory(RUN_ID, { runtimeDirectory }), "provider-terminal.json"),
    path.join(phase2alRunDirectory(RUN_ID, { runtimeDirectory }), "task-terminal.json"),
    path.join(phase2alRunDirectory(RUN_ID, { runtimeDirectory }), "run-index.json"),
  ]) {
    assert.equal((await lstat(file)).mode & 0o777, 0o600);
    assert.doesNotMatch(await readFile(file, "utf8"), /api[_-]?key|authorization:\s*bearer/iu);
  }
});

test("Candidate capture is canonical, bounded, and immutable", async (t) => {
  const runtimeDirectory = await tempRuntime(t);
  const candidate = { title_zh: "合成候选" };
  const capture = {
    capture_file_version: PHASE2AL_CAPTURE_FILE_VERSION,
    kind: "candidate_capture",
    run_id: RUN_ID,
    captured_at: NOW,
    provider_terminal_hash: HASH,
    candidate_hash: hashCanonicalJson(candidate),
    candidate,
  };
  assertPhase2alCandidateCapture(capture);
  await writePhase2alCandidateCapture(capture, { runtimeDirectory });
  await assert.rejects(
    writePhase2alCandidateCapture(capture, { runtimeDirectory }),
    { code: "phase2al_candidate_capture_failed_already_exists" },
  );
});
