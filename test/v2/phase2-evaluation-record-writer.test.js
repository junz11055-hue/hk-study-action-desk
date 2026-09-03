import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  computePhase2EvaluationHash,
  PHASE2A_FAILURE_CLAIMS,
  PHASE2A_SAFETY_ASSURANCE,
  PHASE2_AUTOMATIC_DIMENSION_NAMES,
  PHASE2_CANDIDATE_SCHEMA_HASH,
  PHASE2_CANDIDATE_SCHEMA_VERSION,
  PHASE2_CASE_SET_VERSION,
  PHASE2_DEVELOPMENT_CASE_IDS,
  PHASE2_EVALUATION_RECORD_SCHEMA_VERSION,
  PHASE2_EVALUATOR_VERSION,
  PHASE2_INPUT_PROJECTION_VERSION,
  PHASE2_ORACLE_VERSION,
  validatePhase2EvaluationRecord,
} from "../../src/v2/contracts/phase2-evaluation-record-v1.schema.js";
import {
  DEFAULT_PHASE2A_EVALUATION_RECORDS_DIRECTORY,
  listPhase2EvaluationRecordTempFiles,
  Phase2EvaluationRecordWriteError,
  resolvePhase2EvaluationRecordsDirectory,
  writePhase2EvaluationRecord,
} from "../../src/v2/phase2/phase2-evaluation-record-writer.js";

function zeroDimensionTotals() {
  return Object.fromEntries(
    PHASE2_AUTOMATIC_DIMENSION_NAMES.map((name) => [
      name,
      { cases_total: 0, cases_exact: 0, tp: 0, fp: 0, fn: 0 },
    ]),
  );
}

function makeTerminalFailureRecord(overrides = {}) {
  const record = {
    record_schema_version: PHASE2_EVALUATION_RECORD_SCHEMA_VERSION,
    run_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    phase: "phase2a",
    execution_mode: "offline_reference",
    status: "failed",
    started_at: "2026-08-31T08:00:00.000Z",
    finished_at: "2026-08-31T08:00:00.100Z",
    provider: "offline_reference",
    model: null,
    prompt_version: "offline_reference",
    safety: {
      provider_requests: 0,
      network_connections: 0,
      locked_file_accesses: 0,
      secret_reads: 0,
      listening_ports: 0,
      real_data_records: 0,
    },
    safety_assurance: structuredClone(PHASE2A_SAFETY_ASSURANCE),
    evaluation: {
      dataset_split: "development",
      case_set_version: PHASE2_CASE_SET_VERSION,
      case_ids: [...PHASE2_DEVELOPMENT_CASE_IDS],
      input_projection_version: PHASE2_INPUT_PROJECTION_VERSION,
      oracle_version: PHASE2_ORACLE_VERSION,
      evaluator_version: PHASE2_EVALUATOR_VERSION,
      candidate_schema_version: PHASE2_CANDIDATE_SCHEMA_VERSION,
      candidate_schema_hash: PHASE2_CANDIDATE_SCHEMA_HASH,
      case_results: [],
      summary: {
        planned_case_count: 16,
        evaluated_case_count: 0,
        automatic_passed_case_count: 0,
        automatic_failed_case_count: 0,
        technical_invalid_case_count: 0,
        dimension_totals: zeroDimensionTotals(),
        errors: { P0: 0, P1: 0, observation: 0 },
        reviews: { pending: 0, pass: 0, fail: 0 },
        excluded_field_count: 0,
        slices: [],
      },
      claims: structuredClone(PHASE2A_FAILURE_CLAIMS),
    },
    canonical_evaluation_hash: "",
    error: {
      code: "offline_evaluation_failed",
      message: "The offline reference evaluation did not complete.",
    },
    ...overrides,
  };
  record.canonical_evaluation_hash = computePhase2EvaluationHash(record);
  return record;
}

async function privateTempDirectory(t) {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "phase2-record-writer-"),
  );
  t.after(async () => rm(root, { recursive: true, force: true }));
  return path.join(root, "evaluations");
}

test("Phase 2 writer defaults inside .runtime/phase-2a/evaluations", () => {
  assert.equal(
    resolvePhase2EvaluationRecordsDirectory(),
    DEFAULT_PHASE2A_EVALUATION_RECORDS_DIRECTORY,
  );
  assert.match(
    DEFAULT_PHASE2A_EVALUATION_RECORDS_DIRECTORY,
    /[\\/]\.runtime[\\/]phase-2a[\\/]evaluations[\\/]?$/u,
  );
});

test("Phase 2 writer atomically stores a valid 0600 record in a 0700 directory", async (t) => {
  const recordsDirectory = await privateTempDirectory(t);
  const record = makeTerminalFailureRecord();
  const written = await writePhase2EvaluationRecord(record, {
    recordsDirectory,
  });

  assert.equal(path.basename(written.recordPath), `${record.run_id}.json`);
  assert.deepEqual(written.staleTempFiles, []);
  assert.equal((await stat(recordsDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(written.recordPath)).mode & 0o777, 0o600);
  const persisted = JSON.parse(await readFile(written.recordPath, "utf8"));
  assert.deepEqual(persisted, record);
  assert.equal(validatePhase2EvaluationRecord(persisted).valid, true);
  assert.deepEqual(
    await listPhase2EvaluationRecordTempFiles({ recordsDirectory }),
    [],
  );
});

test("Phase 2 writer reports but never parses or deletes stale temp files", async (t) => {
  const recordsDirectory = await privateTempDirectory(t);
  await mkdir(recordsDirectory, { recursive: true, mode: 0o700 });
  await chmod(recordsDirectory, 0o700);
  const stalePath = path.join(recordsDirectory, "interrupted.tmp");
  await writeFile(stalePath, "redacted interrupted bytes", { mode: 0o600 });

  const written = await writePhase2EvaluationRecord(
    makeTerminalFailureRecord(),
    { recordsDirectory },
  );
  assert.deepEqual(written.staleTempFiles, [stalePath]);
  assert.equal(
    await readFile(stalePath, "utf8"),
    "redacted interrupted bytes",
  );
});

test("Phase 2 writer rejects invalid records before creating files", async (t) => {
  const recordsDirectory = await privateTempDirectory(t);
  const record = makeTerminalFailureRecord();
  record.safety.provider_requests = 1;

  await assert.rejects(
    writePhase2EvaluationRecord(record, { recordsDirectory }),
    { code: "record_write_failed" },
  );
  await assert.rejects(
    stat(path.join(recordsDirectory, `${record.run_id}.json`)),
    { code: "ENOENT" },
  );
});

test("Phase 2 writer never overwrites an existing terminal record", async (t) => {
  const recordsDirectory = await privateTempDirectory(t);
  const record = makeTerminalFailureRecord();
  await writePhase2EvaluationRecord(record, { recordsDirectory });

  await assert.rejects(
    writePhase2EvaluationRecord(record, { recordsDirectory }),
    (error) =>
      error instanceof Phase2EvaluationRecordWriteError &&
      error.code === "record_write_failed",
  );
});

test("Phase 2 writer publishes at most one concurrent final record", async (t) => {
  const recordsDirectory = await privateTempDirectory(t);
  const record = makeTerminalFailureRecord();
  const results = await Promise.allSettled([
    writePhase2EvaluationRecord(record, { recordsDirectory }),
    writePhase2EvaluationRecord(record, { recordsDirectory }),
  ]);

  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
  const finalPath = path.join(recordsDirectory, `${record.run_id}.json`);
  assert.deepEqual(JSON.parse(await readFile(finalPath, "utf8")), record);
});

test("Phase 2 writer rejects a symlink records directory", async (t) => {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "phase2-record-symlink-"),
  );
  t.after(async () => rm(root, { recursive: true, force: true }));
  const target = path.join(root, "target");
  const linkedDirectory = path.join(root, "linked-evaluations");
  await mkdir(target, { mode: 0o700 });
  await symlink(target, linkedDirectory, "dir");

  await assert.rejects(
    writePhase2EvaluationRecord(makeTerminalFailureRecord(), {
      recordsDirectory: linkedDirectory,
    }),
    (error) =>
      error instanceof Phase2EvaluationRecordWriteError &&
      error.code === "record_write_failed",
  );
});

test("Phase 2 writer rejects a symlink parent before creating outside it", async (t) => {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "phase2-record-parent-symlink-"),
  );
  t.after(async () => rm(root, { recursive: true, force: true }));
  const target = path.join(root, "target");
  const linkedParent = path.join(root, "linked-parent");
  const escapedDirectory = path.join(linkedParent, "new", "evaluations");
  await mkdir(path.join(target, "new"), { recursive: true, mode: 0o700 });
  await symlink(target, linkedParent, "dir");

  await assert.rejects(
    writePhase2EvaluationRecord(makeTerminalFailureRecord(), {
      recordsDirectory: escapedDirectory,
    }),
    (error) =>
      error instanceof Phase2EvaluationRecordWriteError &&
      error.code === "record_write_failed",
  );
  await assert.rejects(stat(path.join(target, "new", "evaluations")), {
    code: "ENOENT",
  });
});

test("Phase 2 writer snapshots synchronously before caller mutation", async (t) => {
  const recordsDirectory = await privateTempDirectory(t);
  const record = makeTerminalFailureRecord({
    run_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  });
  const originalMessage = record.error.message;
  const writing = writePhase2EvaluationRecord(record, { recordsDirectory });
  record.error.message = "Caller changed this after write began.";
  const written = await writing;
  const persisted = JSON.parse(await readFile(written.recordPath, "utf8"));

  assert.equal(persisted.error.message, originalMessage);
  assert.equal(validatePhase2EvaluationRecord(persisted).valid, true);
});
