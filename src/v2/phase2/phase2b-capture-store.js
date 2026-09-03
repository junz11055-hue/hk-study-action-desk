import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertValidPhase2bEvaluationRecord } from "../contracts/phase2b-evaluation-record-v1.schema.js";
import { canonicalJsonStringify, hashCanonicalJson } from "../validation/canonical-json.js";

export const PHASE2B_AUTHORIZATION_VERSION = "phase2b-one-shot-authorization-v1";
export const PHASE2B_CAPTURE_FILE_VERSION = "phase2b-capture-file-v1";
export const DEFAULT_PHASE2B_RUNTIME_DIRECTORY = fileURLToPath(
  new URL("../../../.runtime/phase-2b/", import.meta.url),
);
export const DEFAULT_PHASE2B_AUTHORIZATION_PATH = path.join(
  DEFAULT_PHASE2B_RUNTIME_DIRECTORY,
  "authorization-consumed.json",
);
const PROJECT_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CASE_ID_PATTERN = /^DEV\d{3}$/u;
const MAX_CAPTURE_FILE_BYTES = 2_000_000;

export class Phase2bCaptureStoreError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "Phase2bCaptureStoreError";
    this.code = code;
  }
}

async function assertRealDirectory(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("runtime path contains a non-directory or symlink");
  }
}

async function assertSafeDirectoryPrefix(directory, { projectContained }) {
  const target = path.resolve(directory);
  if (projectContained) {
    const projectRoot = path.resolve(PROJECT_ROOT);
    const relative = path.relative(projectRoot, target);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error("Phase 2B runtime escaped the project root");
    }
  }

  let current = target;
  while (true) {
    try {
      await assertRealDirectory(current);
      if ((await realpath(current)) !== path.resolve(current)) {
        throw new Error("Phase 2B runtime contains a symlink ancestor");
      }
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

async function ensurePrivateDirectory(directory, options) {
  await assertSafeDirectoryPrefix(directory, options);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertSafeDirectoryPrefix(directory, options);
  await assertRealDirectory(directory);
  await chmod(directory, 0o700);
}

async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function jsonSnapshot(value) {
  return JSON.parse(canonicalJsonStringify(value));
}

async function writeNoClobberJson(value, filePath, options) {
  const snapshot = jsonSnapshot(value);
  const directory = path.dirname(filePath);
  await ensurePrivateDirectory(directory, options);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(tempPath, "wx", 0o600);
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(tempPath, filePath);
    await unlink(tempPath);
    await syncDirectory(directory);
    return Object.freeze({
      path: filePath,
      hash: hashCanonicalJson(snapshot),
      snapshot,
    });
  } catch (error) {
    try {
      await handle?.close();
    } catch {
      // Preserve the original no-clobber failure.
    }
    throw error;
  }
}

async function readPrivateNoFollowJson(filePath) {
  const resolvedPath = path.resolve(filePath);
  const directory = path.dirname(resolvedPath);
  let handle;
  try {
    await assertSafeDirectoryPrefix(directory, { projectContained: false });
    const directoryInfo = await lstat(directory);
    if (
      !directoryInfo.isDirectory() ||
      directoryInfo.isSymbolicLink() ||
      (directoryInfo.mode & 0o077) !== 0
    ) {
      throw new Error("capture directory must be private and real");
    }

    const pathInfo = await lstat(resolvedPath);
    if (
      !pathInfo.isFile() ||
      pathInfo.isSymbolicLink() ||
      (pathInfo.mode & 0o777) !== 0o600 ||
      pathInfo.size < 1 ||
      pathInfo.size > MAX_CAPTURE_FILE_BYTES
    ) {
      throw new Error("capture file must be a bounded private regular file");
    }

    handle = await open(
      resolvedPath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    const openedInfo = await handle.stat();
    if (
      !openedInfo.isFile() ||
      openedInfo.dev !== pathInfo.dev ||
      openedInfo.ino !== pathInfo.ino ||
      openedInfo.size !== pathInfo.size ||
      (openedInfo.mode & 0o777) !== 0o600 ||
      (await realpath(resolvedPath)) !== resolvedPath
    ) {
      throw new Error("capture file changed or crossed a symlink boundary");
    }
    const source = await handle.readFile("utf8");
    return JSON.parse(source);
  } finally {
    await handle?.close();
  }
}

function runtimeOptions(runtimeDirectory) {
  return {
    projectContained:
      path.resolve(runtimeDirectory) === path.resolve(DEFAULT_PHASE2B_RUNTIME_DIRECTORY),
  };
}

function assertRunId(runId) {
  if (!UUID_PATTERN.test(runId ?? "")) {
    throw new TypeError("runId must be a UUID v4");
  }
}

function assertCase(caseId, caseIndex) {
  if (!CASE_ID_PATTERN.test(caseId ?? "")) {
    throw new TypeError("caseId must be a frozen development ID");
  }
  if (!Number.isInteger(caseIndex) || caseIndex < 0 || caseIndex > 15) {
    throw new TypeError("caseIndex must be between 0 and 15");
  }
}

export function phase2bRunDirectory(
  runId,
  { runtimeDirectory = DEFAULT_PHASE2B_RUNTIME_DIRECTORY } = {},
) {
  assertRunId(runId);
  return path.join(path.resolve(runtimeDirectory), "runs", runId);
}

export async function createPhase2bAuthorizationMarker(
  marker,
  { runtimeDirectory = DEFAULT_PHASE2B_RUNTIME_DIRECTORY } = {},
) {
  assertRunId(marker?.run_id);
  const authorizationPath = path.join(
    path.resolve(runtimeDirectory),
    "authorization-consumed.json",
  );
  try {
    return await writeNoClobberJson(
      marker,
      authorizationPath,
      runtimeOptions(runtimeDirectory),
    );
  } catch (error) {
    throw new Phase2bCaptureStoreError(
      error?.code === "EEXIST"
        ? "phase2b_authorization_already_consumed"
        : "phase2b_authorization_marker_failed",
      error?.code === "EEXIST"
        ? "The approved Phase 2B one-shot batch was already consumed."
        : "The Phase 2B authorization marker could not be persisted.",
      { cause: error },
    );
  }
}

function caseFileName(caseId, caseIndex, suffix) {
  assertCase(caseId, caseIndex);
  return `${String(caseIndex + 1).padStart(2, "0")}-${caseId}.${suffix}.json`;
}

export async function writePhase2bRequestIntent(
  intent,
  { runtimeDirectory = DEFAULT_PHASE2B_RUNTIME_DIRECTORY } = {},
) {
  assertRunId(intent?.run_id);
  const runDirectory = phase2bRunDirectory(intent.run_id, { runtimeDirectory });
  const filePath = path.join(
    runDirectory,
    caseFileName(intent.case_id, intent.case_index, "intent"),
  );
  try {
    return await writeNoClobberJson(
      intent,
      filePath,
      runtimeOptions(runtimeDirectory),
    );
  } catch (error) {
    throw new Phase2bCaptureStoreError(
      "phase2b_intent_write_failed",
      "A Phase 2B request intent could not be persisted before transport.",
      { cause: error },
    );
  }
}

export async function writePhase2bCaseTerminal(
  terminal,
  { runtimeDirectory = DEFAULT_PHASE2B_RUNTIME_DIRECTORY } = {},
) {
  assertRunId(terminal?.run_id);
  const runDirectory = phase2bRunDirectory(terminal.run_id, { runtimeDirectory });
  const filePath = path.join(
    runDirectory,
    caseFileName(terminal.case_id, terminal.case_index, "terminal"),
  );
  try {
    return await writeNoClobberJson(
      terminal,
      filePath,
      runtimeOptions(runtimeDirectory),
    );
  } catch (error) {
    throw new Phase2bCaptureStoreError(
      "phase2b_terminal_write_failed",
      "A Phase 2B case terminal could not be persisted.",
      { cause: error },
    );
  }
}

export async function writePhase2bCaptureIndex(
  index,
  { runtimeDirectory = DEFAULT_PHASE2B_RUNTIME_DIRECTORY } = {},
) {
  assertRunId(index?.run_id);
  const filePath = path.join(
    phase2bRunDirectory(index.run_id, { runtimeDirectory }),
    "capture-index.json",
  );
  try {
    return await writeNoClobberJson(
      index,
      filePath,
      runtimeOptions(runtimeDirectory),
    );
  } catch (error) {
    throw new Phase2bCaptureStoreError(
      "phase2b_capture_index_write_failed",
      "The Phase 2B capture index could not be persisted.",
      { cause: error },
    );
  }
}

export async function writePhase2bBatchTerminal(
  terminal,
  { runtimeDirectory = DEFAULT_PHASE2B_RUNTIME_DIRECTORY } = {},
) {
  assertRunId(terminal?.run_id);
  const filePath = path.join(
    phase2bRunDirectory(terminal.run_id, { runtimeDirectory }),
    "batch-terminal.json",
  );
  try {
    return await writeNoClobberJson(
      terminal,
      filePath,
      runtimeOptions(runtimeDirectory),
    );
  } catch (error) {
    throw new Phase2bCaptureStoreError(
      error?.code === "EEXIST"
        ? "phase2b_batch_terminal_already_exists"
        : "phase2b_batch_terminal_write_failed",
      error?.code === "EEXIST"
        ? "The Phase 2B batch already has an immutable terminal record."
        : "The Phase 2B batch terminal could not be persisted.",
      { cause: error },
    );
  }
}

export async function writePhase2bEvaluationRecord(
  record,
  { runtimeDirectory = DEFAULT_PHASE2B_RUNTIME_DIRECTORY } = {},
) {
  try {
    assertValidPhase2bEvaluationRecord(record);
    assertRunId(record?.run_id);
  } catch (error) {
    throw new Phase2bCaptureStoreError(
      "phase2b_evaluation_write_failed",
      "The Phase 2B evaluation record failed validation before persistence.",
      { cause: error },
    );
  }
  const filePath = path.join(
    phase2bRunDirectory(record.run_id, { runtimeDirectory }),
    "evaluation.json",
  );
  try {
    return await writeNoClobberJson(
      record,
      filePath,
      runtimeOptions(runtimeDirectory),
    );
  } catch (error) {
    throw new Phase2bCaptureStoreError(
      "phase2b_evaluation_write_failed",
      "The Phase 2B evaluation record could not be persisted.",
      { cause: error },
    );
  }
}

export async function readPhase2bAuthorizationMarker({
  runtimeDirectory = DEFAULT_PHASE2B_RUNTIME_DIRECTORY,
} = {}) {
  try {
    return await readPrivateNoFollowJson(
      path.join(path.resolve(runtimeDirectory), "authorization-consumed.json"),
    );
  } catch (error) {
    throw new Phase2bCaptureStoreError(
      "phase2b_authorization_marker_invalid",
      "The durable Phase 2B authorization marker is unavailable or unsafe.",
      { cause: error },
    );
  }
}

export async function readPhase2bCaptureFile(filePath) {
  try {
    return await readPrivateNoFollowJson(filePath);
  } catch (error) {
    throw new Phase2bCaptureStoreError(
      "phase2b_capture_read_failed",
      "A Phase 2B capture file is unavailable or unsafe.",
      { cause: error },
    );
  }
}
