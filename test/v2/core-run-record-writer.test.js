import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { validatePhase1CoreRunRecord } from "../../src/v2/contracts/phase1-core-run-record-v2.schema.js";
import {
  listPhase1CoreRunRecordTempFiles,
  Phase1CoreRunRecordWriteError,
  writePhase1CoreRunRecord,
} from "../../src/v2/phase1/core-run-record-writer.js";
import { makeCoreSuccessRecord } from "./phase1-core-run-record-fixtures.js";

async function privateTempDirectory(t) {
  const root = await mkdtemp(path.join(tmpdir(), "phase1-core-writer-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return path.join(root, "runs");
}

test("Core writer atomically stores a valid 0600 record in a 0700 directory", async (t) => {
  const runsDirectory = await privateTempDirectory(t);
  const record = makeCoreSuccessRecord();
  const written = await writePhase1CoreRunRecord(record, { runsDirectory });

  assert.equal(path.basename(written.recordPath), `${record.run_id}.json`);
  assert.deepEqual(written.staleTempFiles, []);
  assert.equal((await stat(runsDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(written.recordPath)).mode & 0o777, 0o600);
  const parsed = JSON.parse(await readFile(written.recordPath, "utf8"));
  assert.deepEqual(parsed, record);
  assert.equal(validatePhase1CoreRunRecord(parsed).valid, true);
  assert.deepEqual(await listPhase1CoreRunRecordTempFiles({ runsDirectory }), []);
});

test("Core writer reports but never parses or deletes stale temp files", async (t) => {
  const runsDirectory = await privateTempDirectory(t);
  await mkdir(runsDirectory, { recursive: true, mode: 0o700 });
  await chmod(runsDirectory, 0o700);
  const stalePath = path.join(runsDirectory, "stale.tmp");
  await writeFile(stalePath, "not-json and not-success", { mode: 0o600 });

  const written = await writePhase1CoreRunRecord(makeCoreSuccessRecord(), {
    runsDirectory,
  });
  assert.deepEqual(written.staleTempFiles, [stalePath]);
  assert.equal(await readFile(stalePath, "utf8"), "not-json and not-success");
});

test("Core writer rejects invalid records before creating a final file", async (t) => {
  const runsDirectory = await privateTempDirectory(t);
  const record = makeCoreSuccessRecord();
  record.decoding.max_attempts = 2;

  await assert.rejects(
    writePhase1CoreRunRecord(record, { runsDirectory }),
    { code: "record_write_failed" },
  );
  await assert.rejects(stat(path.join(runsDirectory, `${record.run_id}.json`)), {
    code: "ENOENT",
  });
});

test("Core writer never overwrites an existing terminal record", async (t) => {
  const runsDirectory = await privateTempDirectory(t);
  const record = makeCoreSuccessRecord();
  await writePhase1CoreRunRecord(record, { runsDirectory });
  await assert.rejects(
    writePhase1CoreRunRecord(record, { runsDirectory }),
    (error) =>
      error instanceof Phase1CoreRunRecordWriteError &&
      error.code === "record_write_failed",
  );
});

test("Core writer snapshots before its first await and cannot persist caller mutation", async (t) => {
  const runsDirectory = await privateTempDirectory(t);
  const record = makeCoreSuccessRecord({
    run_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  const originalTitle = record.candidate.title_zh;
  const writing = writePhase1CoreRunRecord(record, { runsDirectory });
  record.candidate.title_zh = "调用方并发篡改";
  const written = await writing;
  const persisted = JSON.parse(await readFile(written.recordPath, "utf8"));

  assert.equal(persisted.candidate.title_zh, originalTitle);
  assert.equal(validatePhase1CoreRunRecord(persisted).valid, true);
});
