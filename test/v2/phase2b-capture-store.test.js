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
  createPhase2bAuthorizationMarker,
  readPhase2bAuthorizationMarker,
  readPhase2bCaptureFile,
  writePhase2bEvaluationRecord,
} from "../../src/v2/phase2/phase2b-capture-store.js";

const RUN_ID = "33333333-3333-4333-8333-333333333333";

async function tempDirectory(t, prefix) {
  const created = await mkdtemp(path.join(os.tmpdir(), prefix));
  const canonical = await realpath(created);
  t.after(async () => await rm(canonical, { recursive: true, force: true }));
  return canonical;
}

test("Phase 2B authorization marker is private, durable, and no-clobber", async (t) => {
  const runtimeDirectory = await tempDirectory(t, "phase2b-store-");
  const marker = { authorization_version: "test", run_id: RUN_ID };
  const first = await createPhase2bAuthorizationMarker(marker, { runtimeDirectory });
  assert.equal((await stat(runtimeDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(first.path)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(first.path, "utf8")), marker);
  await assert.rejects(
    createPhase2bAuthorizationMarker(marker, { runtimeDirectory }),
    (error) => error.code === "phase2b_authorization_already_consumed",
  );
});

test("Concurrent Phase 2B starts consume the one-shot marker at most once", async (t) => {
  const runtimeDirectory = await tempDirectory(t, "phase2b-concurrent-");
  const outcomes = await Promise.allSettled([
    createPhase2bAuthorizationMarker(
      { authorization_version: "test", run_id: RUN_ID },
      { runtimeDirectory },
    ),
    createPhase2bAuthorizationMarker(
      {
        authorization_version: "test",
        run_id: "44444444-4444-4444-8444-444444444444",
      },
      { runtimeDirectory },
    ),
  ]);
  assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(outcomes.filter(({ status }) => status === "rejected").length, 1);
});

test("Phase 2B store rejects a symlink runtime before writing outside it", async (t) => {
  const parent = await tempDirectory(t, "phase2b-symlink-parent-");
  const outside = await tempDirectory(t, "phase2b-symlink-outside-");
  const linked = path.join(parent, "linked-runtime");
  await symlink(outside, linked, "dir");
  await assert.rejects(
    createPhase2bAuthorizationMarker(
      { authorization_version: "test", run_id: RUN_ID },
      { runtimeDirectory: linked },
    ),
    /could not be persisted/u,
  );
  assert.equal((await lstat(linked)).isSymbolicLink(), true);
  await assert.rejects(stat(path.join(outside, "authorization-consumed.json")));
});

test("Phase 2B readers reject final symlinks before reading their targets", async (t) => {
  const runtimeDirectory = await tempDirectory(t, "phase2b-read-runtime-");
  const outside = await tempDirectory(t, "phase2b-read-outside-");
  const outsideFile = path.join(outside, "outside.json");
  await writeFile(outsideFile, '{"outside":true}\n', { mode: 0o600 });

  const marker = { authorization_version: "test", run_id: RUN_ID };
  const written = await createPhase2bAuthorizationMarker(marker, {
    runtimeDirectory,
  });
  await unlink(written.path);
  await symlink(outsideFile, written.path, "file");

  await assert.rejects(
    readPhase2bAuthorizationMarker({ runtimeDirectory }),
    (error) => error.code === "phase2b_authorization_marker_invalid",
  );
  await assert.rejects(
    readPhase2bCaptureFile(written.path),
    (error) => error.code === "phase2b_capture_read_failed",
  );
});

test("Phase 2B evaluation writer rejects an invalid record before creating a file", async (t) => {
  const runtimeDirectory = await tempDirectory(t, "phase2b-invalid-eval-");
  await assert.rejects(
    writePhase2bEvaluationRecord(
      { run_id: RUN_ID, api_key: "must-not-persist" },
      { runtimeDirectory },
    ),
    (error) => error.code === "phase2b_evaluation_write_failed",
  );
  await assert.rejects(
    stat(path.join(runtimeDirectory, "runs", RUN_ID, "evaluation.json")),
  );
});
