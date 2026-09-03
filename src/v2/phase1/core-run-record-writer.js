import {
  chmod,
  mkdir,
  open,
  readdir,
  rename,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertValidPhase1CoreRunRecord,
  Phase1CoreRunRecordValidationError,
} from "../contracts/phase1-core-run-record-v2.schema.js";
import { canonicalJsonStringify } from "../validation/canonical-json.js";

export const DEFAULT_PHASE1_CORE_RUNS_DIRECTORY = fileURLToPath(
  new URL("../../../.runtime/phase-1-core-v2/runs/", import.meta.url),
);

export class Phase1CoreRunRecordWriteError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "Phase1CoreRunRecordWriteError";
    this.code = "record_write_failed";
  }
}

export function resolvePhase1CoreRunsDirectory(runsDirectory) {
  if (runsDirectory instanceof URL) {
    if (runsDirectory.protocol !== "file:") {
      throw new TypeError("runsDirectory URL must use file:");
    }
    return fileURLToPath(runsDirectory);
  }
  if (runsDirectory === undefined) return DEFAULT_PHASE1_CORE_RUNS_DIRECTORY;
  if (typeof runsDirectory !== "string" || runsDirectory.length === 0) {
    throw new TypeError("runsDirectory must be a non-empty path or file URL");
  }
  return path.resolve(runsDirectory);
}

async function ensurePrivateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
}

export async function listPhase1CoreRunRecordTempFiles({ runsDirectory } = {}) {
  const directory = resolvePhase1CoreRunsDirectory(runsDirectory);
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

async function finalRecordExists(finalPath) {
  try {
    await stat(finalPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

/** Validate and atomically persist one terminal Core v2 record. */
export async function writePhase1CoreRunRecord(record, { runsDirectory } = {}) {
  let snapshot;
  try {
    snapshot = JSON.parse(canonicalJsonStringify(record));
    assertValidPhase1CoreRunRecord(snapshot);
  } catch (error) {
    if (error instanceof Phase1CoreRunRecordValidationError) throw error;
    throw new Phase1CoreRunRecordWriteError("run record validation failed", {
      cause: error,
    });
  }

  const directory = resolvePhase1CoreRunsDirectory(runsDirectory);
  const tempPath = path.join(directory, `${snapshot.run_id}.tmp`);
  const recordPath = path.join(directory, `${snapshot.run_id}.json`);
  let fileHandle;

  try {
    await ensurePrivateDirectory(directory);
    const staleTempFiles = await listPhase1CoreRunRecordTempFiles({
      runsDirectory: directory,
    });
    if (await finalRecordExists(recordPath)) {
      throw new Error("a final record with this run_id already exists");
    }

    fileHandle = await open(tempPath, "wx", 0o600);
    await fileHandle.chmod(0o600);
    await fileHandle.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = undefined;
    await rename(tempPath, recordPath);
    return { recordPath, runId: snapshot.run_id, staleTempFiles };
  } catch (error) {
    try {
      await fileHandle?.close();
    } catch {
      // Preserve the original error and any interrupted temp file for review.
    }
    if (error instanceof Phase1CoreRunRecordWriteError) throw error;
    throw new Phase1CoreRunRecordWriteError(
      "phase1 core run record could not be written",
      { cause: error },
    );
  }
}
