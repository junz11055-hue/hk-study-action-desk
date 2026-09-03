import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { validatePhase2aoCandidate } from "../../src/v2/product/candidate-validation.js";
import { buildPhase2aoActionCard } from "../../src/v2/product/deterministic-harness.js";
import { createPhase2aoOfflineAnalyzer } from "../../src/v2/product/offline-analyzers.js";
import { PHASE2AO_CONTRACT_BUNDLE_HASH } from "../../src/v2/product/product-contract-manifest.js";
import { loadPhase2aoProductInput } from "../../src/v2/product/product-input-loader.js";
import { createPhase2aoTaskStore } from "../../src/v2/product/task-store.js";

const SESSION_A = `sha256:${"a".repeat(64)}`;
const SESSION_B = `sha256:${"b".repeat(64)}`;
const KEY_A = "11111111-1111-4111-8111-111111111111";
const KEY_B = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-08-30T12:00:00.000Z";

async function privateTempDirectory(t) {
  const created = await mkdtemp(path.join(tmpdir(), "phase2ao-store-"));
  const directory = await realpath(created);
  t.after(async () => rm(directory, { recursive: true, force: true }));
  return directory;
}

function reservation(overrides = {}) {
  return {
    sessionScopeDigest: SESSION_A,
    idempotencyKey: KEY_A,
    caseId: "DEV001",
    executionMode: "synthetic_mock",
    contractBundleHash: PHASE2AO_CONTRACT_BUNDLE_HASH,
    ...overrides,
  };
}

async function approvedCard(executionMode = "synthetic_mock") {
  const productInput = await loadPhase2aoProductInput({ caseId: "DEV001" });
  const analyzer = createPhase2aoOfflineAnalyzer({ executionMode });
  const analyzed = await analyzer.analyze({
    caseId: "DEV001",
    modelInput: productInput.modelInput,
  });
  const accepted = validatePhase2aoCandidate(
    analyzed.candidate,
    productInput.modelInput,
  );
  const card = buildPhase2aoActionCard({
    productInput,
    candidate: accepted.candidate,
    validationEvidence: accepted.validationEvidence,
    executionMode,
    analyzedAt: "2026-09-01T00:00:00.000Z",
  });
  return { card, candidateHash: accepted.candidateHash };
}

test("Task Store atomically coalesces cross-instance reservations and preserves ownership", async (t) => {
  const directory = await privateTempDirectory(t);
  const clock = () => new Date(NOW);
  const storeA = await createPhase2aoTaskStore({ directory, clock });
  const storeB = await createPhase2aoTaskStore({ directory, clock });

  const [first, second] = await Promise.all([
    storeA.reserve(reservation()),
    storeB.reserve(reservation({ idempotencyKey: KEY_B })),
  ]);

  assert.equal(Number(first.created) + Number(second.created), 1);
  assert.equal(first.task.taskId, second.task.taskId);
  assert.equal(first.task.status, "queued");
  assert.equal(second.task.status, "queued");
  const ownerStore = first.created ? storeA : storeB;
  const observerStore = first.created ? storeB : storeA;
  await ownerStore.markRunning(first.task.taskId);
  const observedRunning = await observerStore.get(first.task.taskId, SESSION_A);
  assert.equal(observedRunning.status, "running");
  const otherSession = await observerStore.reserve(
    reservation({ sessionScopeDigest: SESSION_B }),
  );
  assert.equal(otherSession.created, true);
  assert.notEqual(otherSession.task.taskId, first.task.taskId);
  const { card, candidateHash } = await approvedCard();
  await ownerStore.succeed(first.task.taskId, { candidateHash, card });

  const observed = await observerStore.get(first.task.taskId, SESSION_A);
  assert.equal(observed.status, "succeeded");
  assert.equal(observed.resource.card.notification.id, "DEV-NOTIF-PAIR-01");
  assert.equal(await observerStore.get(first.task.taskId, SESSION_B), null);

  await assert.rejects(
    ownerStore.fail(first.task.taskId, {
      code: "TASK_EXECUTION_FAILED",
      message: "不应覆盖终态。",
      retryable: false,
    }),
    { code: "task_transition_invalid" },
  );

  const recovered = await createPhase2aoTaskStore({ directory, clock });
  const replayedAlias = await recovered.reserve(
    reservation({ idempotencyKey: KEY_B }),
  );
  assert.equal(replayedAlias.created, false);
  assert.equal(replayedAlias.cached, true);
  assert.equal(replayedAlias.task.taskId, first.task.taskId);
  assert.equal(replayedAlias.task.status, "succeeded");
});

test("Task Store marks orphaned queued work stale after restart without rerunning it", async (t) => {
  const directory = await privateTempDirectory(t);
  const clock = () => new Date(NOW);
  const firstStore = await createPhase2aoTaskStore({ directory, clock });
  const reserved = await firstStore.reserve(reservation());
  assert.equal(reserved.task.status, "queued");

  const restarted = await createPhase2aoTaskStore({ directory, clock });
  const stale = await restarted.get(reserved.task.taskId, SESSION_A);
  assert.equal(stale.status, "stale");
  assert.equal(stale.resource, null);
  assert.deepEqual(stale.error, {
    code: "TASK_STALE",
    message: "分析任务在服务重启后已失去执行租约，请明确新建任务。",
    retryable: true,
  });

  const replayed = await restarted.reserve(reservation());
  assert.equal(replayed.created, false);
  assert.equal(replayed.task.taskId, reserved.task.taskId);
  assert.equal(replayed.task.status, "stale");
});

test("Task Store persists only private append-only records and digests raw keys", async (t) => {
  const directory = await privateTempDirectory(t);
  const store = await createPhase2aoTaskStore({
    directory,
    clock: () => new Date(NOW),
  });
  const reserved = await store.reserve(reservation());
  const taskDirectory = path.join(directory, "tasks", reserved.task.taskId);
  const createdPath = path.join(taskDirectory, "created.json");
  const [rootInfo, taskInfo, recordInfo, source] = await Promise.all([
    lstat(directory),
    lstat(taskDirectory),
    lstat(createdPath),
    readFile(createdPath, "utf8"),
  ]);

  assert.equal(rootInfo.mode & 0o777, 0o700);
  assert.equal(taskInfo.mode & 0o777, 0o700);
  assert.equal(recordInfo.mode & 0o777, 0o600);
  assert.equal(source.includes(KEY_A), false);
  assert.equal(source.includes("X-Product-Api-Token"), false);
  assert.equal(source.includes("invite"), false);
  const parsed = JSON.parse(source);
  assert.match(parsed.idempotencyDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(parsed.singleFlightDigest, /^sha256:[0-9a-f]{64}$/);
});

test("Task Store atomically recovers a reservation lock left by a dead process", async (t) => {
  const directory = await privateTempDirectory(t);
  const lockPath = path.join(directory, ".reservation-lock.json");
  await writeFile(
    lockPath,
    `${JSON.stringify({
      recordVersion: "phase2ao-reservation-lock-v1",
      ownerPid: 2_147_483_647,
      ownerToken: "33333333-3333-4333-8333-333333333333",
      acquiredAt: NOW,
    })}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  const store = await createPhase2aoTaskStore({
    directory,
    clock: () => new Date(NOW),
  });
  const reserved = await store.reserve(reservation());
  assert.equal(reserved.created, true);
  assert.equal(reserved.task.status, "queued");
  await assert.rejects(lstat(lockPath), { code: "ENOENT" });
});

test("Task Store removes only unpublished task directories from the create-record crash window", async (t) => {
  for (const withTemporaryFile of [false, true]) {
    await t.test(withTemporaryFile ? "created temp only" : "empty directory", async () => {
      const directory = await privateTempDirectory(t);
      await createPhase2aoTaskStore({ directory });
      const orphanId = withTemporaryFile
        ? "44444444-4444-4444-8444-444444444444"
        : "55555555-5555-4555-8555-555555555555";
      const orphanDirectory = path.join(directory, "tasks", orphanId);
      await mkdir(orphanDirectory, { mode: 0o700 });
      if (withTemporaryFile) {
        await writeFile(
          path.join(
            orphanDirectory,
            ".created.json.66666666-6666-4666-8666-666666666666.tmp",
          ),
          "partial unpublished record",
          { encoding: "utf8", flag: "wx", mode: 0o600 },
        );
      }

      const recovered = await createPhase2aoTaskStore({ directory });
      await assert.rejects(lstat(orphanDirectory), { code: "ENOENT" });
      const reserved = await recovered.reserve(reservation());
      assert.equal(reserved.created, true);
    });
  }
});

test("Task Store preserves and rejects a non-empty damaged task directory", async (t) => {
  const directory = await privateTempDirectory(t);
  await createPhase2aoTaskStore({ directory });
  const damagedId = "77777777-7777-4777-8777-777777777777";
  const damagedDirectory = path.join(directory, "tasks", damagedId);
  const unexpectedPath = path.join(damagedDirectory, "unexpected.json");
  await mkdir(damagedDirectory, { mode: 0o700 });
  await writeFile(unexpectedPath, "{}\n", {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  await assert.rejects(createPhase2aoTaskStore({ directory }), {
    code: "task_store_invalid",
  });
  assert.equal((await lstat(unexpectedPath)).isFile(), true);
});
