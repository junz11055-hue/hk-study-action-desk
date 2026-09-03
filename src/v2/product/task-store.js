import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import { canonicalJsonStringify, hashCanonicalJson } from "../validation/canonical-json.js";
import { validateActionCardV02 } from "./action-card-v02.js";
import {
  assertSafeTaskError,
  hasExactKeys,
  isRfc3339,
  PHASE2AO_DIGEST_PATTERN,
  PHASE2AO_EXECUTION_MODES,
  PHASE2AO_IDEMPOTENCY_KEY_PATTERN,
  PHASE2AO_TASK_ID_PATTERN,
} from "./contracts.js";

const CREATED_VERSION = "phase2ao-task-created-v1";
const RUNNING_VERSION = "phase2ao-task-running-v1";
const TERMINAL_VERSION = "phase2ao-task-terminal-v1";
const IDEMPOTENCY_ALIAS_VERSION = "phase2ao-idempotency-alias-v1";
const RESERVATION_LOCK_VERSION = "phase2ao-reservation-lock-v1";
const MAX_RECORD_BYTES = 512_000;
const RESERVATION_LOCK_RETRIES = 200;
const RESERVATION_LOCK_WAIT_MS = 5;
const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const TASK_TEMPORARY_FILE_PATTERN = new RegExp(
  `^\\.(?:created|running|terminal)\\.json\\.${UUID_PATTERN}\\.tmp$`,
  "u",
);
const CREATED_TEMPORARY_FILE_PATTERN = new RegExp(
  `^\\.created\\.json\\.${UUID_PATTERN}\\.tmp$`,
  "u",
);
const ALIAS_TEMPORARY_FILE_PATTERN = new RegExp(
  `^\\.[0-9a-f]{64}\\.json\\.${UUID_PATTERN}\\.tmp$`,
  "u",
);

export class Phase2aoTaskStoreError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "Phase2aoTaskStoreError";
    this.code = code;
  }
}

function fail(code, message, cause) {
  throw new Phase2aoTaskStoreError(code, message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function digest(namespace, ...values) {
  const hash = createHash("sha256");
  hash.update(namespace, "utf8");
  for (const value of values) {
    hash.update("\0", "utf8");
    hash.update(value, "utf8");
  }
  return `sha256:${hash.digest("hex")}`;
}

function isoNow(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("clock must return a valid date");
  return date.toISOString();
}

function monotonicIso(value, floor) {
  const parsed = Date.parse(value);
  const minimum = Date.parse(floor);
  return parsed >= minimum ? value : new Date(minimum).toISOString();
}

async function ensurePrivateDirectory(directory) {
  const resolved = path.resolve(directory);
  if (resolved === path.parse(resolved).root) {
    throw new Error("Task store directory cannot be a filesystem root");
  }
  await mkdir(resolved, { recursive: true, mode: 0o700 });
  const info = await lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Task store path must be a real directory");
  }
  if ((await realpath(resolved)) !== resolved) {
    throw new Error("Task store path must not cross a symlink");
  }
  await chmod(resolved, 0o700);
  return resolved;
}

async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function wait(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertReservationLock(record) {
  if (
    !hasExactKeys(record, [
      "recordVersion",
      "ownerPid",
      "ownerToken",
      "acquiredAt",
    ]) ||
    record.recordVersion !== RESERVATION_LOCK_VERSION ||
    !Number.isInteger(record.ownerPid) ||
    record.ownerPid < 1 ||
    record.ownerPid > 2_147_483_647 ||
    !PHASE2AO_TASK_ID_PATTERN.test(record.ownerToken ?? "") ||
    !isRfc3339(record.acquiredAt)
  ) {
    throw new Error("Task reservation lock record is invalid");
  }
}

function processIsAlive(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

async function acquireReservationLock(lockPath, clock) {
  const ownerToken = randomUUID();
  const record = {
    recordVersion: RESERVATION_LOCK_VERSION,
    ownerPid: process.pid,
    ownerToken,
    acquiredAt: isoNow(clock),
  };
  assertReservationLock(record);
  for (let attempt = 0; attempt < RESERVATION_LOCK_RETRIES; attempt += 1) {
    try {
      await writeNoClobberJson(lockPath, record);
      return async () => {
        const observed = await readPrivateJson(lockPath);
        assertReservationLock(observed);
        if (
          observed.ownerPid !== record.ownerPid ||
          observed.ownerToken !== record.ownerToken
        ) {
          throw new Error("Task reservation lock ownership changed");
        }
        await unlink(lockPath);
        await syncDirectory(path.dirname(lockPath));
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let observed;
      try {
        observed = await readPrivateJson(lockPath);
      } catch (readError) {
        if (readError?.code === "ENOENT") continue;
        throw readError;
      }
      assertReservationLock(observed);
      if (!processIsAlive(observed.ownerPid)) {
        try {
          await unlink(lockPath);
          await syncDirectory(path.dirname(lockPath));
        } catch (unlinkError) {
          if (unlinkError?.code !== "ENOENT") throw unlinkError;
        }
        continue;
      }
      await wait(RESERVATION_LOCK_WAIT_MS);
    }
  }
  throw new Error("Task reservation lock is unavailable");
}

async function writeNoClobberJson(filePath, value) {
  const directory = await ensurePrivateDirectory(path.dirname(filePath));
  const snapshot = JSON.parse(canonicalJsonStringify(value));
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );
  let handle;
  let published = false;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporaryPath, filePath);
    published = true;
    await unlink(temporaryPath);
    await syncDirectory(directory);
    return snapshot;
  } finally {
    await handle?.close().catch(() => undefined);
    if (!published) await unlink(temporaryPath).catch(() => undefined);
  }
}

async function readPrivateJson(filePath) {
  const resolved = path.resolve(filePath);
  const info = await lstat(resolved);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (info.mode & 0o777) !== 0o600 ||
    info.size < 1 ||
    info.size > MAX_RECORD_BYTES ||
    (await realpath(resolved)) !== resolved
  ) {
    throw new Error("Task record must be a bounded private regular file");
  }
  const handle = await open(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.dev !== info.dev ||
      opened.ino !== info.ino ||
      (opened.mode & 0o777) !== 0o600
    ) {
      throw new Error("Task record changed while opening");
    }
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

async function cleanupUnpublishedTaskDirectory(taskDirectory, entries) {
  const directoryInfo = await lstat(taskDirectory);
  if (
    !directoryInfo.isDirectory() ||
    directoryInfo.isSymbolicLink() ||
    (directoryInfo.mode & 0o077) !== 0 ||
    (await realpath(taskDirectory)) !== taskDirectory ||
    entries.some((entry) => !CREATED_TEMPORARY_FILE_PATTERN.test(entry))
  ) {
    return false;
  }
  for (const entry of entries) {
    const temporaryPath = path.join(taskDirectory, entry);
    const info = await lstat(temporaryPath);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (info.mode & 0o777) !== 0o600 ||
      info.size > MAX_RECORD_BYTES ||
      (await realpath(temporaryPath)) !== temporaryPath
    ) {
      return false;
    }
  }
  for (const entry of entries) {
    await unlink(path.join(taskDirectory, entry));
  }
  await rmdir(taskDirectory);
  await syncDirectory(path.dirname(taskDirectory));
  return true;
}

function assertCreated(record) {
  if (
    !hasExactKeys(record, [
      "recordVersion",
      "taskId",
      "caseId",
      "executionMode",
      "sessionScopeDigest",
      "idempotencyDigest",
      "singleFlightDigest",
      "contractBundleHash",
      "createdAt",
    ]) ||
    record.recordVersion !== CREATED_VERSION ||
    !PHASE2AO_TASK_ID_PATTERN.test(record.taskId ?? "") ||
    record.caseId !== "DEV001" ||
    !PHASE2AO_EXECUTION_MODES.includes(record.executionMode) ||
    !PHASE2AO_DIGEST_PATTERN.test(record.sessionScopeDigest ?? "") ||
    !PHASE2AO_DIGEST_PATTERN.test(record.idempotencyDigest ?? "") ||
    !PHASE2AO_DIGEST_PATTERN.test(record.singleFlightDigest ?? "") ||
    !PHASE2AO_DIGEST_PATTERN.test(record.contractBundleHash ?? "") ||
    !isRfc3339(record.createdAt)
  ) {
    throw new Error("Task created record is invalid");
  }
}

function assertIdempotencyAlias(record) {
  if (
    !hasExactKeys(record, [
      "recordVersion",
      "idempotencyDigest",
      "taskId",
      "createdAt",
    ]) ||
    record.recordVersion !== IDEMPOTENCY_ALIAS_VERSION ||
    !PHASE2AO_DIGEST_PATTERN.test(record.idempotencyDigest ?? "") ||
    !PHASE2AO_TASK_ID_PATTERN.test(record.taskId ?? "") ||
    !isRfc3339(record.createdAt)
  ) {
    throw new Error("Idempotency alias is invalid");
  }
}

function assertRunning(record, created) {
  if (
    !hasExactKeys(record, ["recordVersion", "taskId", "status", "startedAt"]) ||
    record.recordVersion !== RUNNING_VERSION ||
    record.taskId !== created.taskId ||
    record.status !== "running" ||
    !isRfc3339(record.startedAt) ||
    Date.parse(record.startedAt) < Date.parse(created.createdAt)
  ) {
    throw new Error("Task running record is invalid");
  }
}

function assertTerminal(record, created, running) {
  if (
    !hasExactKeys(record, [
      "recordVersion",
      "taskId",
      "status",
      "finishedAt",
      "candidateHash",
      "actionCardHash",
      "resource",
      "error",
    ]) ||
    record.recordVersion !== TERMINAL_VERSION ||
    record.taskId !== created.taskId ||
    !["succeeded", "failed", "stale"].includes(record.status) ||
    !isRfc3339(record.finishedAt) ||
    Date.parse(record.finishedAt) <
      Date.parse(running?.startedAt ?? created.createdAt)
  ) {
    throw new Error("Task terminal record is invalid");
  }
  if (record.status === "succeeded") {
    if (
      !PHASE2AO_DIGEST_PATTERN.test(record.candidateHash ?? "") ||
      !PHASE2AO_DIGEST_PATTERN.test(record.actionCardHash ?? "") ||
      !hasExactKeys(record.resource, ["status", "card", "error"]) ||
      record.resource.status !== "succeeded" ||
      record.resource.error !== null ||
      record.error !== null
    ) {
      throw new Error("Successful terminal record is invalid");
    }
    validateActionCardV02(record.resource.card);
    if (hashCanonicalJson(record.resource.card) !== record.actionCardHash) {
      throw new Error("Persisted Action Card hash mismatch");
    }
  } else {
    if (
      record.candidateHash !== null ||
      record.actionCardHash !== null ||
      record.resource !== null ||
      record.error === null
    ) {
      throw new Error("Failed terminal record is invalid");
    }
    assertSafeTaskError(record.error);
  }
}

function taskView(task) {
  const { created, running, terminal } = task;
  const status = terminal?.status ?? running?.status ?? "queued";
  const updatedAt = terminal?.finishedAt ?? running?.startedAt ?? created.createdAt;
  return Object.freeze({
    taskId: created.taskId,
    caseId: created.caseId,
    executionMode: created.executionMode,
    sessionScopeDigest: created.sessionScopeDigest,
    contractBundleHash: created.contractBundleHash,
    status,
    createdAt: created.createdAt,
    updatedAt,
    finishedAt: terminal?.finishedAt ?? null,
    resource: terminal?.resource ?? null,
    error: terminal?.error ?? null,
    candidateHash: terminal?.candidateHash ?? null,
    actionCardHash: terminal?.actionCardHash ?? null,
  });
}

function terminalRecord({ taskId, status, finishedAt, candidateHash, card, error }) {
  return {
    recordVersion: TERMINAL_VERSION,
    taskId,
    status,
    finishedAt,
    candidateHash: status === "succeeded" ? candidateHash : null,
    actionCardHash: status === "succeeded" ? hashCanonicalJson(card) : null,
    resource:
      status === "succeeded"
        ? { status: "succeeded", card: structuredClone(card), error: null }
        : null,
    error: status === "succeeded" ? null : structuredClone(error),
  };
}

async function loadTaskDirectory(taskDirectory, taskId) {
  const info = await lstat(taskDirectory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw new Error("Task path must be a private real directory");
  }
  const entries = await readdir(taskDirectory);
  const allowed = new Set(["created.json", "running.json", "terminal.json"]);
  if (
    entries.some(
      (entry) =>
        !allowed.has(entry) && !TASK_TEMPORARY_FILE_PATTERN.test(entry),
    ) ||
    !entries.includes("created.json")
  ) {
    throw new Error("Task directory contains an unexpected record");
  }
  const created = await readPrivateJson(path.join(taskDirectory, "created.json"));
  assertCreated(created);
  if (created.taskId !== taskId) throw new Error("Task directory ID mismatch");
  const running = entries.includes("running.json")
    ? await readPrivateJson(path.join(taskDirectory, "running.json"))
    : null;
  if (running !== null) assertRunning(running, created);
  const terminal = entries.includes("terminal.json")
    ? await readPrivateJson(path.join(taskDirectory, "terminal.json"))
    : null;
  if (terminal !== null) assertTerminal(terminal, created, running);
  return { created, running, terminal };
}

export async function createPhase2aoTaskStore({
  directory,
  clock = () => new Date(),
  createTaskId = randomUUID,
} = {}) {
  if (typeof directory !== "string" || directory.length < 1) {
    throw new TypeError("directory is required");
  }
  if (typeof clock !== "function" || typeof createTaskId !== "function") {
    throw new TypeError("clock and createTaskId must be functions");
  }
  const root = await ensurePrivateDirectory(directory);
  const tasksDirectory = await ensurePrivateDirectory(path.join(root, "tasks"));
  const aliasesDirectory = await ensurePrivateDirectory(
    path.join(root, "idempotency"),
  );
  const reservationLockPath = path.join(root, ".reservation-lock.json");
  const tasks = new Map();
  const idempotency = new Map();
  const refreshTasks = async () => {
    const entries = await readdir(tasksDirectory, { withFileTypes: true });
    const observedPrimary = new Map();
    for (const entry of entries) {
      if (!entry.isDirectory() || !PHASE2AO_TASK_ID_PATTERN.test(entry.name)) {
        fail("task_store_invalid", "The task store contains an invalid entry.");
      }
      const persistedTaskDirectory = path.join(tasksDirectory, entry.name);
      const taskEntries = await readdir(persistedTaskDirectory);
      if (
        !taskEntries.includes("created.json") &&
        (await cleanupUnpublishedTaskDirectory(
          persistedTaskDirectory,
          taskEntries,
        ))
      ) {
        continue;
      }
      const task = await loadTaskDirectory(
        persistedTaskDirectory,
        entry.name,
      ).catch((error) =>
        fail("task_store_invalid", "A persisted task record is invalid.", error),
      );
      const duplicate = observedPrimary.get(task.created.idempotencyDigest);
      if (duplicate !== undefined && duplicate !== entry.name) {
        fail("task_store_invalid", "The task store contains duplicate idempotency records.");
      }
      observedPrimary.set(task.created.idempotencyDigest, entry.name);
      tasks.set(entry.name, task);
      idempotency.set(task.created.idempotencyDigest, entry.name);
    }
  };
  const refreshAliases = async () => {
    const aliasEntries = await readdir(aliasesDirectory, { withFileTypes: true });
    for (const entry of aliasEntries) {
      if (entry.isFile() && ALIAS_TEMPORARY_FILE_PATTERN.test(entry.name)) {
        continue;
      }
      if (!entry.isFile() || !/^[0-9a-f]{64}\.json$/u.test(entry.name)) {
        fail("task_store_invalid", "The idempotency store contains an invalid entry.");
      }
      const alias = await readPrivateJson(path.join(aliasesDirectory, entry.name)).catch(
        (error) => fail("task_store_invalid", "An idempotency alias is invalid.", error),
      );
      assertIdempotencyAlias(alias);
      if (
        entry.name !== `${alias.idempotencyDigest.slice(7)}.json` ||
        !tasks.has(alias.taskId) ||
        (idempotency.has(alias.idempotencyDigest) &&
          idempotency.get(alias.idempotencyDigest) !== alias.taskId)
      ) {
        fail("task_store_invalid", "An idempotency alias does not resolve safely.");
      }
      idempotency.set(alias.idempotencyDigest, alias.taskId);
    }
  };
  let releaseInitializationLock;
  try {
    releaseInitializationLock = await acquireReservationLock(
      reservationLockPath,
      clock,
    );
    await refreshTasks();
    await refreshAliases();
  } catch (error) {
    if (error instanceof Phase2aoTaskStoreError) throw error;
    fail("task_store_invalid", "The task store could not be initialized safely.", error);
  } finally {
    await releaseInitializationLock?.().catch((error) =>
      fail("task_store_invalid", "The initialization lock could not be released.", error),
    );
  }

  let queue = Promise.resolve();
  const locked = (operation) => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => undefined);
    return result;
  };
  const taskDirectory = (taskId) => path.join(tasksDirectory, taskId);
  const appendTerminal = async (task, record) => {
    assertTerminal(record, task.created, task.running);
    await writeNoClobberJson(
      path.join(taskDirectory(task.created.taskId), "terminal.json"),
      record,
    );
    task.terminal = record;
  };

  // A process restart cannot prove ownership of an old lease. Fail closed and
  // preserve the old task as an immutable stale terminal before serving reads.
  for (const task of tasks.values()) {
    if (task.terminal !== null) continue;
    const observed = isoNow(clock);
    const floor = task.running?.startedAt ?? task.created.createdAt;
    await appendTerminal(
      task,
      terminalRecord({
        taskId: task.created.taskId,
        status: "stale",
        finishedAt: monotonicIso(observed, floor),
        candidateHash: null,
        card: null,
        error: {
          code: "TASK_STALE",
          message: "分析任务在服务重启后已失去执行租约，请明确新建任务。",
          retryable: true,
        },
      }),
    );
  }

  return Object.freeze({
    directory: root,
    async reserve({
      sessionScopeDigest,
      idempotencyKey,
      caseId,
      executionMode,
      contractBundleHash,
    } = {}) {
      return await locked(async () => {
        if (
          !PHASE2AO_DIGEST_PATTERN.test(sessionScopeDigest ?? "") ||
          !PHASE2AO_IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey ?? "") ||
          caseId !== "DEV001" ||
          !PHASE2AO_EXECUTION_MODES.includes(executionMode) ||
          !PHASE2AO_DIGEST_PATTERN.test(contractBundleHash ?? "")
        ) {
          fail("task_reservation_invalid", "Task reservation fields are invalid.");
        }
        const idempotencyDigest = digest(
          "phase2ao-idempotency-v1",
          sessionScopeDigest,
          idempotencyKey,
        );
        const singleFlightDigest = digest(
          "phase2ao-single-flight-v1",
          sessionScopeDigest,
          caseId,
          executionMode,
          contractBundleHash,
        );
        let release;
        try {
          release = await acquireReservationLock(reservationLockPath, clock);
          // Another Store instance may have published a reservation or alias
          // after this instance started. Rescan only while holding the shared
          // filesystem lock, then make the decision and publish atomically.
          await refreshTasks();
          await refreshAliases();
          const existingId = idempotency.get(idempotencyDigest);
          if (existingId !== undefined) {
            return Object.freeze({ created: false, cached: true, task: taskView(tasks.get(existingId)) });
          }
          for (const task of tasks.values()) {
            if (
              task.created.singleFlightDigest === singleFlightDigest &&
              task.terminal === null
            ) {
              const alias = {
                recordVersion: IDEMPOTENCY_ALIAS_VERSION,
                idempotencyDigest,
                taskId: task.created.taskId,
                createdAt: monotonicIso(isoNow(clock), task.created.createdAt),
              };
              assertIdempotencyAlias(alias);
              await writeNoClobberJson(
                path.join(aliasesDirectory, `${idempotencyDigest.slice(7)}.json`),
                alias,
              );
              idempotency.set(idempotencyDigest, task.created.taskId);
              return Object.freeze({ created: false, cached: true, task: taskView(task) });
            }
          }

          let taskId;
          let target;
          for (let attempt = 0; attempt < 3; attempt += 1) {
            taskId = createTaskId();
            if (!PHASE2AO_TASK_ID_PATTERN.test(taskId ?? "")) {
              fail("task_id_invalid", "Task ID generation failed.");
            }
            target = taskDirectory(taskId);
            try {
              await mkdir(target, { mode: 0o700 });
              await chmod(target, 0o700);
              break;
            } catch (error) {
              if (error?.code !== "EEXIST" || attempt === 2) {
                fail("task_store_write_failed", "The task could not be reserved.", error);
              }
            }
          }
          const created = {
            recordVersion: CREATED_VERSION,
            taskId,
            caseId,
            executionMode,
            sessionScopeDigest,
            idempotencyDigest,
            singleFlightDigest,
            contractBundleHash,
            createdAt: isoNow(clock),
          };
          assertCreated(created);
          await writeNoClobberJson(path.join(target, "created.json"), created).catch(
            (error) => fail("task_store_write_failed", "The task could not be persisted.", error),
          );
          const task = { created, running: null, terminal: null };
          tasks.set(taskId, task);
          idempotency.set(idempotencyDigest, taskId);
          return Object.freeze({ created: true, cached: false, task: taskView(task) });
        } catch (error) {
          if (error instanceof Phase2aoTaskStoreError) throw error;
          fail("task_store_write_failed", "The task could not be reserved.", error);
        } finally {
          await release?.().catch((error) =>
            fail("task_store_write_failed", "The task reservation lock could not be released.", error),
          );
        }
      });
    },

    async markRunning(taskId) {
      return await locked(async () => {
        const task = tasks.get(taskId);
        if (task === undefined || task.running !== null || task.terminal !== null) {
          fail("task_transition_invalid", "The task cannot enter running state.");
        }
        const startedAt = monotonicIso(isoNow(clock), task.created.createdAt);
        const running = {
          recordVersion: RUNNING_VERSION,
          taskId,
          status: "running",
          startedAt,
        };
        assertRunning(running, task.created);
        await writeNoClobberJson(
          path.join(taskDirectory(taskId), "running.json"),
          running,
        );
        task.running = running;
        return taskView(task);
      });
    },

    async succeed(taskId, { candidateHash, card } = {}) {
      return await locked(async () => {
        const task = tasks.get(taskId);
        if (task?.running === null || task?.running === undefined || task.terminal !== null) {
          fail("task_transition_invalid", "The task cannot succeed from its current state.");
        }
        if (!PHASE2AO_DIGEST_PATTERN.test(candidateHash ?? "")) {
          fail("task_terminal_invalid", "Candidate hash is invalid.");
        }
        validateActionCardV02(card);
        const record = terminalRecord({
          taskId,
          status: "succeeded",
          finishedAt: monotonicIso(isoNow(clock), task.running.startedAt),
          candidateHash,
          card,
          error: null,
        });
        await appendTerminal(task, record);
        return taskView(task);
      });
    },

    async fail(taskId, error) {
      return await locked(async () => {
        const task = tasks.get(taskId);
        if (task === undefined || task.terminal !== null) {
          fail("task_transition_invalid", "The task cannot fail from its current state.");
        }
        assertSafeTaskError(error);
        const floor = task.running?.startedAt ?? task.created.createdAt;
        const record = terminalRecord({
          taskId,
          status: "failed",
          finishedAt: monotonicIso(isoNow(clock), floor),
          candidateHash: null,
          card: null,
          error,
        });
        await appendTerminal(task, record);
        return taskView(task);
      });
    },

    async get(taskId, sessionScopeDigest) {
      return await locked(async () => {
        if (
          !PHASE2AO_TASK_ID_PATTERN.test(taskId ?? "") ||
          !PHASE2AO_DIGEST_PATTERN.test(sessionScopeDigest ?? "")
        ) {
          return null;
        }
        let refreshed = null;
        try {
          refreshed = await loadTaskDirectory(taskDirectory(taskId), taskId);
        } catch (error) {
          if (error?.code !== "ENOENT") {
            fail("task_store_invalid", "A persisted task record is invalid.", error);
          }
        }
        if (refreshed !== null) {
          tasks.set(taskId, refreshed);
          idempotency.set(
            refreshed.created.idempotencyDigest,
            refreshed.created.taskId,
          );
        }
        const task = tasks.get(taskId);
        if (task?.created.sessionScopeDigest !== sessionScopeDigest) return null;
        return taskView(task);
      });
    },
  });
}
