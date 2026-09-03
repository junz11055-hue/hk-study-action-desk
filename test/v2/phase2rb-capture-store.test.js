import assert from "node:assert/strict";
import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createPhase2rbAuthorizationMarker,
  phase2rbRunDirectory,
  readPhase2rbAuthorizationMarker,
  readPhase2rbCaptureFile,
  writePhase2rbBatchTerminal,
} from "../../src/v2/phase2rb/phase2rb-capture-store.js";
import {
  createPhase2rbFailedBatchTerminal,
} from "../../src/v2/phase2rb/phase2rb-candidate-capture.js";
import {
  PHASE2RB_AUTHORIZATION_ID,
  PHASE2RB_AUTHORIZATION_VERSION,
  PHASE2RB_BASE_SNAPSHOT_FILE_HASH,
  PHASE2RB_BASE_SNAPSHOT_HASH,
  PHASE2RB_CANDIDATE_SCHEMA_VERSION,
  PHASE2RB_CASE_IDS,
  PHASE2RB_CASE_SET_HASH,
  PHASE2RB_DATA_SCOPE,
  PHASE2RB_DIAGNOSTIC_VERSION,
  PHASE2RB_MAX_OUTPUT_TOKENS,
  PHASE2RB_MAX_REQUESTS,
  PHASE2RB_MODEL,
  PHASE2RB_MODEL_INPUT_SET_HASH,
  PHASE2RB_PROMPT_HASH,
  PHASE2RB_PROMPT_VERSION,
  PHASE2RB_PROVIDER,
  PHASE2RB_REQUESTS_PER_CASE,
  PHASE2RB_RETRIES,
  PHASE2RB_SCHEMA_HASH,
  PHASE2RB_SERIAL,
  PHASE2RB_SOURCE_CONTEXT_FILE_HASH,
  PHASE2RB_SOURCE_CONTEXT_SNAPSHOT_HASH,
  PHASE2RB_TIMEOUT_MS,
} from "../../src/v2/phase2rb/phase2rb-run-contract.js";
import { hashCanonicalJson } from "../../src/v2/validation/canonical-json.js";

const RUN_ID = "33333333-3333-4333-8333-333333333333";
const COMMIT = "b".repeat(40);
const REQUEST_DESCRIPTORS = Object.freeze([
  [
    "DEV001",
    "sha256:5f7e4d9e243e95a0f11ac7736f330252d6939ff845658cd91b04e88177888b5e",
    "sha256:44e12abde3db8918112f0a3e2bdd2938d0ab1415ec2acd1ae6aa8691bf922240",
    9_424,
  ],
  [
    "DEV006",
    "sha256:de34434353a0dc6c5b7a1b0fe2ffe05ed1bbacee416bb75b225dfb9db452ea60",
    "sha256:c77e3b59f59f817e6d1b894d930908f352115545a71c61a4385cf3f7bcad7fbc",
    9_316,
  ],
  [
    "DEV008",
    "sha256:32044ff58a2eb6ddce131c90e366573b91271f1673d94a0d59f697537b03799f",
    "sha256:1b8112e2d4b5bfd725ed36420a2836b035f8f0c93a768140ade06b79728d56ec",
    9_401,
  ],
  [
    "DEV010",
    "sha256:a861e6f89ecdb970611d49b2efe97cb423a2f7e1070667cb318fd428b0855ef0",
    "sha256:40632fdc91277efbacbf6374ab9bb1294d69a3cf3b0e9d853e69be8989b0536d",
    9_481,
  ],
].map(([caseId, modelInputHash, requestPayloadHash, requestUtf8Bytes], index) => ({
  case_id: caseId,
  case_index: index,
  model_input_hash: modelInputHash,
  prompt_hash: PHASE2RB_PROMPT_HASH,
  schema_hash: PHASE2RB_SCHEMA_HASH,
  request_payload_hash: requestPayloadHash,
  request_utf8_bytes: requestUtf8Bytes,
})));

function marker(runId = RUN_ID) {
  return {
    authorization_version: PHASE2RB_AUTHORIZATION_VERSION,
    authorization_id: PHASE2RB_AUTHORIZATION_ID,
    status: "consumed",
    run_id: runId,
    consumed_at: "2026-09-01T00:00:00.000Z",
    implementation_commit_sha: COMMIT,
    case_ids: [...PHASE2RB_CASE_IDS],
    case_set_hash: PHASE2RB_CASE_SET_HASH,
    provider: PHASE2RB_PROVIDER,
    model: PHASE2RB_MODEL,
    prompt_version: PHASE2RB_PROMPT_VERSION,
    prompt_hash: PHASE2RB_PROMPT_HASH,
    candidate_schema_version: PHASE2RB_CANDIDATE_SCHEMA_VERSION,
    schema_hash: PHASE2RB_SCHEMA_HASH,
    diagnostic_version: PHASE2RB_DIAGNOSTIC_VERSION,
    base_snapshot_hash: PHASE2RB_BASE_SNAPSHOT_HASH,
    base_snapshot_file_hash: PHASE2RB_BASE_SNAPSHOT_FILE_HASH,
    model_input_set_hash: PHASE2RB_MODEL_INPUT_SET_HASH,
    source_context_snapshot_hash: PHASE2RB_SOURCE_CONTEXT_SNAPSHOT_HASH,
    source_context_file_hash: PHASE2RB_SOURCE_CONTEXT_FILE_HASH,
    request_descriptors: structuredClone(REQUEST_DESCRIPTORS),
    request_descriptor_set_hash: hashCanonicalJson(REQUEST_DESCRIPTORS),
    max_requests: PHASE2RB_MAX_REQUESTS,
    requests_per_case: PHASE2RB_REQUESTS_PER_CASE,
    serial: PHASE2RB_SERIAL,
    retries: PHASE2RB_RETRIES,
    max_output_tokens: PHASE2RB_MAX_OUTPUT_TOKENS,
    timeout_ms: PHASE2RB_TIMEOUT_MS,
    data_scope: PHASE2RB_DATA_SCOPE,
  };
}

async function tempDirectory(t, prefix) {
  const created = await mkdtemp(path.join(os.tmpdir(), prefix));
  const canonical = await realpath(created);
  t.after(async () => await rm(canonical, { recursive: true, force: true }));
  return canonical;
}

test("Phase 2R-B marker is private, durable, and immutable", async (t) => {
  const runtimeDirectory = await tempDirectory(t, "phase2rb-store-");
  const authorization = marker();
  const first = await createPhase2rbAuthorizationMarker(authorization, {
    runtimeDirectory,
  });

  assert.equal((await stat(runtimeDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(first.path)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(first.path, "utf8")), authorization);
  await assert.rejects(
    createPhase2rbAuthorizationMarker(authorization, { runtimeDirectory }),
    (error) => error.code === "phase2rb_authorization_already_consumed",
  );
});

test("Concurrent Phase 2R-B starts consume the marker at most once", async (t) => {
  const runtimeDirectory = await tempDirectory(t, "phase2rb-concurrent-");
  const outcomes = await Promise.allSettled([
    createPhase2rbAuthorizationMarker(marker(), { runtimeDirectory }),
    createPhase2rbAuthorizationMarker(
      marker("44444444-4444-4444-8444-444444444444"),
      { runtimeDirectory },
    ),
  ]);

  assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(outcomes.filter(({ status }) => status === "rejected").length, 1);
});

test("Phase 2R-B run artifacts are private and no-clobber", async (t) => {
  const runtimeDirectory = await tempDirectory(t, "phase2rb-run-files-");
  const batch = createPhase2rbFailedBatchTerminal({
    runId: RUN_ID,
    implementationCommitSha: COMMIT,
    errorCode: "model_configuration_invalid",
    clock: () => new Date("2026-09-01T00:00:00.000Z"),
  });
  const written = await writePhase2rbBatchTerminal(batch, { runtimeDirectory });

  const runDirectory = phase2rbRunDirectory(RUN_ID, { runtimeDirectory });
  assert.equal((await stat(runDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(written.path)).mode & 0o777, 0o600);
  await assert.rejects(
    writePhase2rbBatchTerminal(batch, { runtimeDirectory }),
    (error) => error.code === "phase2rb_batch_terminal_already_exists",
  );
});

test("Phase 2R-B store rejects a symlink runtime before writing outside", async (t) => {
  const parent = await tempDirectory(t, "phase2rb-symlink-parent-");
  const outside = await tempDirectory(t, "phase2rb-symlink-outside-");
  const linked = path.join(parent, "linked-runtime");
  await symlink(outside, linked, "dir");

  await assert.rejects(
    createPhase2rbAuthorizationMarker(
      marker(),
      { runtimeDirectory: linked },
    ),
    (error) => error.code === "phase2rb_authorization_marker_failed",
  );
  assert.equal((await lstat(linked)).isSymbolicLink(), true);
  await assert.rejects(stat(path.join(outside, "authorization-consumed.json")));
});

test("Phase 2R-B readers reject final symlinks and unsafe permissions", async (t) => {
  const runtimeDirectory = await tempDirectory(t, "phase2rb-read-runtime-");
  const outside = await tempDirectory(t, "phase2rb-read-outside-");
  const outsideFile = path.join(outside, "outside.json");
  await writeFile(outsideFile, '{"outside":true}\n', { mode: 0o600 });

  const written = await createPhase2rbAuthorizationMarker(marker(), {
    runtimeDirectory,
  });
  await unlink(written.path);
  await symlink(outsideFile, written.path, "file");

  await assert.rejects(
    readPhase2rbAuthorizationMarker({ runtimeDirectory }),
    (error) => error.code === "phase2rb_authorization_marker_invalid",
  );
  await assert.rejects(
    readPhase2rbCaptureFile(written.path),
    (error) => error.code === "phase2rb_capture_read_failed",
  );
});
