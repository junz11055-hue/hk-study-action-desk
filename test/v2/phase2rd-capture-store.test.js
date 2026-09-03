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
  createPhase2rdAuthorizationMarker,
  phase2rdRunDirectory,
  readPhase2rdAuthorizationMarker,
  readPhase2rdCaptureFile,
  writePhase2rdBatchTerminal,
} from "../../src/v2/phase2rd/phase2rd-capture-store.js";
import {
  createPhase2rdFailedBatchTerminal,
} from "../../src/v2/phase2rd/phase2rd-candidate-capture.js";
import {
  PHASE2RD_AUTHORIZATION_ID,
  PHASE2RD_AUTHORIZATION_VERSION,
  PHASE2RD_BASE_SNAPSHOT_FILE_HASH,
  PHASE2RD_BASE_SNAPSHOT_HASH,
  PHASE2RD_CANDIDATE_SCHEMA_VERSION,
  PHASE2RD_CASE_IDS,
  PHASE2RD_CASE_SET_HASH,
  PHASE2RD_DATA_SCOPE,
  PHASE2RD_DIAGNOSTIC_VERSION,
  PHASE2RD_MAX_OUTPUT_TOKENS,
  PHASE2RD_MAX_REQUESTS,
  PHASE2RD_MODEL,
  PHASE2RD_MODEL_INPUT_SET_HASH,
  PHASE2RD_PROMPT_HASH,
  PHASE2RD_PROMPT_VERSION,
  PHASE2RD_PROVIDER,
  PHASE2RD_REQUESTS_PER_CASE,
  PHASE2RD_RETRIES,
  PHASE2RD_SCHEMA_HASH,
  PHASE2RD_SERIAL,
  PHASE2RD_SOURCE_CONTEXT_FILE_HASH,
  PHASE2RD_SOURCE_CONTEXT_SNAPSHOT_HASH,
  PHASE2RD_TIMEOUT_MS,
} from "../../src/v2/phase2rd/phase2rd-run-contract.js";
import { hashCanonicalJson } from "../../src/v2/validation/canonical-json.js";
import { PHASE2RD_FROZEN_REQUESTS } from "../../src/v2/phase2rd/phase2rd-spec-contract.js";

const RUN_ID = "33333333-3333-4333-8333-333333333333";
const COMMIT = "b".repeat(40);
const REQUEST_DESCRIPTORS = Object.freeze(PHASE2RD_FROZEN_REQUESTS.map((item, index) => ({
  case_id: item.case_id,
  case_index: index,
  model_input_hash: item.model_input_hash,
  prompt_hash: PHASE2RD_PROMPT_HASH,
  schema_hash: PHASE2RD_SCHEMA_HASH,
  request_payload_hash: item.request_payload_hash,
  request_utf8_bytes: item.request_utf8_bytes,
})));

function marker(runId = RUN_ID) {
  return {
    authorization_version: PHASE2RD_AUTHORIZATION_VERSION,
    authorization_id: PHASE2RD_AUTHORIZATION_ID,
    status: "consumed",
    run_id: runId,
    consumed_at: "2026-09-01T00:00:00.000Z",
    implementation_commit_sha: COMMIT,
    case_ids: [...PHASE2RD_CASE_IDS],
    case_set_hash: PHASE2RD_CASE_SET_HASH,
    provider: PHASE2RD_PROVIDER,
    model: PHASE2RD_MODEL,
    prompt_version: PHASE2RD_PROMPT_VERSION,
    prompt_hash: PHASE2RD_PROMPT_HASH,
    candidate_schema_version: PHASE2RD_CANDIDATE_SCHEMA_VERSION,
    schema_hash: PHASE2RD_SCHEMA_HASH,
    diagnostic_version: PHASE2RD_DIAGNOSTIC_VERSION,
    base_snapshot_hash: PHASE2RD_BASE_SNAPSHOT_HASH,
    base_snapshot_file_hash: PHASE2RD_BASE_SNAPSHOT_FILE_HASH,
    model_input_set_hash: PHASE2RD_MODEL_INPUT_SET_HASH,
    source_context_snapshot_hash: PHASE2RD_SOURCE_CONTEXT_SNAPSHOT_HASH,
    source_context_file_hash: PHASE2RD_SOURCE_CONTEXT_FILE_HASH,
    request_descriptors: structuredClone(REQUEST_DESCRIPTORS),
    request_descriptor_set_hash: hashCanonicalJson(REQUEST_DESCRIPTORS),
    max_requests: PHASE2RD_MAX_REQUESTS,
    requests_per_case: PHASE2RD_REQUESTS_PER_CASE,
    serial: PHASE2RD_SERIAL,
    retries: PHASE2RD_RETRIES,
    max_output_tokens: PHASE2RD_MAX_OUTPUT_TOKENS,
    timeout_ms: PHASE2RD_TIMEOUT_MS,
    data_scope: PHASE2RD_DATA_SCOPE,
  };
}

async function tempDirectory(t, prefix) {
  const created = await mkdtemp(path.join(os.tmpdir(), prefix));
  const canonical = await realpath(created);
  t.after(async () => await rm(canonical, { recursive: true, force: true }));
  return canonical;
}

test("Phase 2R-D marker is private, durable, and immutable", async (t) => {
  const runtimeDirectory = await tempDirectory(t, "phase2rd-store-");
  const authorization = marker();
  const first = await createPhase2rdAuthorizationMarker(authorization, {
    runtimeDirectory,
  });

  assert.equal((await stat(runtimeDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(first.path)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(first.path, "utf8")), authorization);
  await assert.rejects(
    createPhase2rdAuthorizationMarker(authorization, { runtimeDirectory }),
    (error) => error.code === "phase2rd_authorization_already_consumed",
  );
});

test("Concurrent Phase 2R-D starts consume the marker at most once", async (t) => {
  const runtimeDirectory = await tempDirectory(t, "phase2rd-concurrent-");
  const outcomes = await Promise.allSettled([
    createPhase2rdAuthorizationMarker(marker(), { runtimeDirectory }),
    createPhase2rdAuthorizationMarker(
      marker("44444444-4444-4444-8444-444444444444"),
      { runtimeDirectory },
    ),
  ]);

  assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(outcomes.filter(({ status }) => status === "rejected").length, 1);
});

test("Phase 2R-D run artifacts are private and no-clobber", async (t) => {
  const runtimeDirectory = await tempDirectory(t, "phase2rd-run-files-");
  const batch = createPhase2rdFailedBatchTerminal({
    runId: RUN_ID,
    implementationCommitSha: COMMIT,
    errorCode: "model_configuration_invalid",
    clock: () => new Date("2026-09-01T00:00:00.000Z"),
  });
  const written = await writePhase2rdBatchTerminal(batch, { runtimeDirectory });

  const runDirectory = phase2rdRunDirectory(RUN_ID, { runtimeDirectory });
  assert.equal((await stat(runDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(written.path)).mode & 0o777, 0o600);
  await assert.rejects(
    writePhase2rdBatchTerminal(batch, { runtimeDirectory }),
    (error) => error.code === "phase2rd_batch_terminal_already_exists",
  );
});

test("Phase 2R-D store rejects a symlink runtime before writing outside", async (t) => {
  const parent = await tempDirectory(t, "phase2rd-symlink-parent-");
  const outside = await tempDirectory(t, "phase2rd-symlink-outside-");
  const linked = path.join(parent, "linked-runtime");
  await symlink(outside, linked, "dir");

  await assert.rejects(
    createPhase2rdAuthorizationMarker(
      marker(),
      { runtimeDirectory: linked },
    ),
    (error) => error.code === "phase2rd_authorization_marker_failed",
  );
  assert.equal((await lstat(linked)).isSymbolicLink(), true);
  await assert.rejects(stat(path.join(outside, "authorization-consumed.json")));
});

test("Phase 2R-D readers reject final symlinks and unsafe permissions", async (t) => {
  const runtimeDirectory = await tempDirectory(t, "phase2rd-read-runtime-");
  const outside = await tempDirectory(t, "phase2rd-read-outside-");
  const outsideFile = path.join(outside, "outside.json");
  await writeFile(outsideFile, '{"outside":true}\n', { mode: 0o600 });

  const written = await createPhase2rdAuthorizationMarker(marker(), {
    runtimeDirectory,
  });
  await unlink(written.path);
  await symlink(outsideFile, written.path, "file");

  await assert.rejects(
    readPhase2rdAuthorizationMarker({ runtimeDirectory }),
    (error) => error.code === "phase2rd_authorization_marker_invalid",
  );
  await assert.rejects(
    readPhase2rdCaptureFile(written.path),
    (error) => error.code === "phase2rd_capture_read_failed",
  );
});
