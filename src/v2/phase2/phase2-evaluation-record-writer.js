import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertValidPhase2EvaluationRecord,
  Phase2EvaluationRecordValidationError,
} from "../contracts/phase2-evaluation-record-v1.schema.js";
import { canonicalJsonStringify } from "../validation/canonical-json.js";

export const DEFAULT_PHASE2A_EVALUATION_RECORDS_DIRECTORY = fileURLToPath(
  new URL("../../../.runtime/phase-2a/evaluations/", import.meta.url),
);
const PHASE2_PROJECT_ROOT_DIRECTORY = fileURLToPath(
  new URL("../../../", import.meta.url),
);

export class Phase2EvaluationRecordWriteError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "Phase2EvaluationRecordWriteError";
    this.code = "record_write_failed";
  }
}

export function resolvePhase2EvaluationRecordsDirectory(recordsDirectory) {
  if (recordsDirectory instanceof URL) {
    if (recordsDirectory.protocol !== "file:") {
      throw new TypeError("recordsDirectory URL must use file:");
    }
    return fileURLToPath(recordsDirectory);
  }
  if (recordsDirectory === undefined) {
    return DEFAULT_PHASE2A_EVALUATION_RECORDS_DIRECTORY;
  }
  if (typeof recordsDirectory !== "string" || recordsDirectory.length === 0) {
    throw new TypeError("recordsDirectory must be a non-empty path or file URL");
  }
  return path.resolve(recordsDirectory);
}

async function assertExistingDirectoryIsReal(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("records path contains a non-directory or symlink");
  }
}

async function assertDefaultPathPrefixIsReal(directory) {
  const projectRoot = path.resolve(PHASE2_PROJECT_ROOT_DIRECTORY);
  const target = path.resolve(directory);
  const relative = path.relative(projectRoot, target);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("default records directory escaped the project root");
  }

  let current = projectRoot;
  await assertExistingDirectoryIsReal(current);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      await assertExistingDirectoryIsReal(current);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
  }
}

async function assertNearestExistingParentIsReal(directory) {
  let current = path.dirname(directory);
  while (true) {
    try {
      await assertExistingDirectoryIsReal(current);
      if ((await realpath(current)) !== path.resolve(current)) {
        throw new Error("custom records path contains a symlink ancestor");
      }
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

async function ensurePrivateDirectory(
  directory,
  { requireProjectContainment = false } = {},
) {
  if (requireProjectContainment) {
    await assertDefaultPathPrefixIsReal(directory);
  } else {
    await assertNearestExistingParentIsReal(directory);
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (requireProjectContainment) {
    await assertDefaultPathPrefixIsReal(directory);
  } else if ((await realpath(directory)) !== path.resolve(directory)) {
    throw new Error("custom records directory is not a canonical real path");
  }
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new Error("records directory must be a real directory");
  }
  if (requireProjectContainment) {
    const [projectRoot, resolvedDirectory] = await Promise.all([
      realpath(PHASE2_PROJECT_ROOT_DIRECTORY),
      realpath(directory),
    ]);
    if (
      resolvedDirectory !== projectRoot &&
      !resolvedDirectory.startsWith(`${projectRoot}${path.sep}`)
    ) {
      throw new Error("default records directory escaped the project root");
    }
  }
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

export async function listPhase2EvaluationRecordTempFiles({
  recordsDirectory,
} = {}) {
  const directory = resolvePhase2EvaluationRecordsDirectory(recordsDirectory);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tmp"))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

/** Validate and atomically persist one terminal, redacted Phase 2 record. */
export async function writePhase2EvaluationRecord(
  record,
  { recordsDirectory } = {},
) {
  let snapshot;
  try {
    // This synchronous snapshot happens before the first await, preventing a
    // caller from changing the persisted record while filesystem work runs.
    snapshot = JSON.parse(canonicalJsonStringify(record));
    assertValidPhase2EvaluationRecord(snapshot);
  } catch (error) {
    if (error instanceof Phase2EvaluationRecordValidationError) throw error;
    throw new Phase2EvaluationRecordWriteError(
      "evaluation record validation failed",
      { cause: error },
    );
  }

  const directory = resolvePhase2EvaluationRecordsDirectory(recordsDirectory);
  const tempPath = path.join(directory, `${snapshot.run_id}.tmp`);
  const recordPath = path.join(directory, `${snapshot.run_id}.json`);
  let fileHandle;

  try {
    await ensurePrivateDirectory(directory, {
      requireProjectContainment: recordsDirectory === undefined,
    });
    const staleTempFiles = await listPhase2EvaluationRecordTempFiles({
      recordsDirectory: directory,
    });

    fileHandle = await open(tempPath, "wx", 0o600);
    await fileHandle.chmod(0o600);
    await fileHandle.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = undefined;
    // A hard-link publish is atomic and, unlike rename(), never overwrites an
    // independently created final record. The temp and final paths share the
    // same directory and therefore the same filesystem.
    await link(tempPath, recordPath);
    let retainedOwnTemp = false;
    try {
      await unlink(tempPath);
    } catch {
      retainedOwnTemp = true;
    }
    await syncDirectory(directory);
    return {
      recordPath,
      runId: snapshot.run_id,
      staleTempFiles: retainedOwnTemp
        ? [...staleTempFiles, tempPath].sort()
        : staleTempFiles,
    };
  } catch (error) {
    try {
      await fileHandle?.close();
    } catch {
      // Keep the interrupted temp file for diagnosis and preserve root cause.
    }
    if (error instanceof Phase2EvaluationRecordWriteError) throw error;
    throw new Phase2EvaluationRecordWriteError(
      "phase2 evaluation record could not be written",
      { cause: error },
    );
  }
}
