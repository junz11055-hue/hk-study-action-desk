import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadPhase1CoreContentFailureHashes,
  Phase1CorePayloadHistoryError,
} from "../../src/v2/phase1/core-content-payload-history.js";
import { writePhase1CoreRunRecord } from "../../src/v2/phase1/core-run-record-writer.js";
import {
  CORE_RECORD_HASHES,
  makeCoreFailureRecord,
  makeCoreSuccessRecord,
} from "./phase1-core-run-record-fixtures.js";

async function privateRunsDirectory(t) {
  const root = await mkdtemp(path.join(tmpdir(), "phase1-core-history-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return path.join(root, "runs");
}

test("Core payload history returns empty for a missing runs directory", async (t) => {
  const runsDirectory = await privateRunsDirectory(t);
  assert.deepEqual(
    await loadPhase1CoreContentFailureHashes({ runsDirectory }),
    [],
  );
});

test("Core payload history restores only validated content-failure hashes", async (t) => {
  const runsDirectory = await privateRunsDirectory(t);
  await writePhase1CoreRunRecord(
    makeCoreFailureRecord({
      run_id: "66666666-6666-4666-8666-666666666666",
    }),
    { runsDirectory },
  );
  await writePhase1CoreRunRecord(
    makeCoreSuccessRecord({
      run_id: "77777777-7777-4777-8777-777777777777",
    }),
    { runsDirectory },
  );

  assert.deepEqual(
    await loadPhase1CoreContentFailureHashes({ runsDirectory }),
    [CORE_RECORD_HASHES.request],
  );
});

test("Core payload history preserves a validated duplicate-block audit hash", async (t) => {
  const runsDirectory = await privateRunsDirectory(t);
  const record = makeCoreFailureRecord({
    run_id: "99999999-9999-4999-8999-999999999999",
    attempt_budget_exhausted: false,
    attempts: [],
    hashes: {
      ...makeCoreFailureRecord().hashes,
      model_payload_hash: null,
      blocked_payload_hash: CORE_RECORD_HASHES.request,
    },
    error: {
      code: "duplicate_payload_blocked",
      message: "A repeated content-failure payload was blocked.",
    },
  });
  await writePhase1CoreRunRecord(record, { runsDirectory });

  assert.deepEqual(
    await loadPhase1CoreContentFailureHashes({ runsDirectory }),
    [CORE_RECORD_HASHES.request],
  );
});

for (const [name, fileName, contents] of [
  ["stale temp record", "interrupted.tmp", "pending"],
  ["malformed JSON", "malformed.json", "{"],
  ["invalid terminal record", "invalid.json", "{}"],
]) {
  test(`Core payload history fails closed on ${name}`, async (t) => {
    const runsDirectory = await privateRunsDirectory(t);
    await mkdir(runsDirectory, { recursive: true });
    await writeFile(path.join(runsDirectory, fileName), contents, "utf8");

    await assert.rejects(
      loadPhase1CoreContentFailureHashes({ runsDirectory }),
      Phase1CorePayloadHistoryError,
    );
  });
}
