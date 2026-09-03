import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Phase1RunRecordValidationError } from "../../src/v2/contracts/phase1-run-record-v1.schema.js";
import {
  listPhase1RunRecordTempFiles,
  Phase1RunRecordWriteError,
  writePhase1RunRecord,
} from "../../src/v2/phase1/run-record-writer.js";
import {
  hashCanonicalJson,
  hashUtf8,
} from "../../src/v2/validation/canonical-json.js";

function successRecord() {
  const promptHash = hashUtf8("phase1 prompt");
  const requestPayloadHash = hashCanonicalJson({ input: "synthetic" });
  const candidate = { notification_id: "DEV-NOTIF-PAIR-01", claims: [] };
  const candidateHash = hashCanonicalJson(candidate);
  return {
    record_schema_version: "phase1-run-record-v1",
    run_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    case_id: "DEV001",
    dataset_split: "development",
    execution_mode: "mock",
    status: "succeeded",
    started_at: "2026-08-30T10:00:00.000Z",
    finished_at: "2026-08-30T10:00:01.000Z",
    provider: "mock",
    model: null,
    prompt_version: "notification-candidate-prompt-p1-v1",
    candidate_schema_version: "notification-analysis-candidate-p1-v1",
    schema_dialect: "https://json-schema.org/draft/2020-12/schema",
    attempt_budget_exhausted: false,
    decoding: {
      max_attempts: 3,
      initial_max_output_tokens: 6000,
      truncation_max_output_tokens: 8000,
      timeout_ms: 90000,
    },
    attempts: [
      {
        attempt: 1,
        started_at: "2026-08-30T10:00:00.000Z",
        finished_at: "2026-08-30T10:00:01.000Z",
        outcome: "completed",
        http_status: null,
        input_tokens: 100,
        output_tokens: 200,
        duration_ms: 1000,
        retry_kind: "initial",
        max_output_tokens: 6000,
        prompt_hash: promptHash,
        request_payload_hash: requestPayloadHash,
        error_code: null,
      },
    ],
    hashes: {
      fixture_input_hash: hashCanonicalJson({ case_id: "DEV001" }),
      prompt_hash: promptHash,
      schema_hash: hashCanonicalJson({ type: "object" }),
      model_payload_hash: hashCanonicalJson([requestPayloadHash]),
      candidate_hash: candidateHash,
      delivered_output_hash: candidateHash,
    },
    validation: {
      schema_valid: true,
      references_closed: true,
      locator_quotes_exact: true,
      forbidden_fields_absent: true,
      candidate_unchanged: true,
    },
    candidate,
    error: null,
  };
}

async function privateTempDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "phase1-record-test-"));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test("writer validates, fsyncs, renames, and applies private permissions", async (t) => {
  const runsDirectory = await privateTempDirectory(t);
  const record = successRecord();
  const result = await writePhase1RunRecord(record, { runsDirectory });

  assert.equal(result.runId, record.run_id);
  assert.equal(result.recordPath, path.join(runsDirectory, `${record.run_id}.json`));
  assert.deepEqual(result.staleTempFiles, []);
  assert.deepEqual(JSON.parse(await readFile(result.recordPath, "utf8")), record);
  assert.deepEqual(await listPhase1RunRecordTempFiles({ runsDirectory }), []);

  const directoryMode = (await stat(runsDirectory)).mode & 0o777;
  const recordMode = (await stat(result.recordPath)).mode & 0o777;
  assert.equal(directoryMode, 0o700);
  assert.equal(recordMode, 0o600);
});

test("orphaned tmp files are reported and never parsed, deleted, or treated as success", async (t) => {
  const runsDirectory = await privateTempDirectory(t);
  const orphanPath = path.join(runsDirectory, "interrupted-run.tmp");
  await writeFile(orphanPath, "not valid JSON and not a success", { mode: 0o600 });

  const record = successRecord();
  record.run_id = "11111111-2222-4333-8444-555555555555";
  const result = await writePhase1RunRecord(record, { runsDirectory });

  assert.deepEqual(result.staleTempFiles, [orphanPath]);
  assert.equal(await readFile(orphanPath, "utf8"), "not valid JSON and not a success");
  assert.deepEqual(await listPhase1RunRecordTempFiles({ runsDirectory }), [
    orphanPath,
  ]);
  assert.notEqual(result.recordPath, orphanPath);
});

test("invalid records are rejected before a success file can be written", async (t) => {
  const runsDirectory = await privateTempDirectory(t);
  const record = successRecord();
  record.status = "queued";

  await assert.rejects(
    writePhase1RunRecord(record, { runsDirectory }),
    Phase1RunRecordValidationError,
  );
  assert.deepEqual(await listPhase1RunRecordTempFiles({ runsDirectory }), []);
});

test("a run_id cannot overwrite an existing final record", async (t) => {
  const runsDirectory = await privateTempDirectory(t);
  const record = successRecord();
  const first = await writePhase1RunRecord(record, { runsDirectory });
  const original = await readFile(first.recordPath, "utf8");

  await assert.rejects(
    writePhase1RunRecord(record, { runsDirectory }),
    (error) =>
      error instanceof Phase1RunRecordWriteError &&
      error.code === "record_write_failed",
  );
  assert.equal(await readFile(first.recordPath, "utf8"), original);
});
