import {
  chmod,
  mkdir,
  open,
  readdir,
  rename,
  stat,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  assertValidPhase1RunRecord,
  Phase1RunRecordValidationError,
} from "../contracts/phase1-run-record-v1.schema.js";

export const DEFAULT_PHASE1_RUNS_DIRECTORY = fileURLToPath(
  new URL("../../../.runtime/phase-1/runs/", import.meta.url),
);

export class Phase1RunRecordWriteError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "Phase1RunRecordWriteError";
    this.code = "record_write_failed";
  }
}

function resolveRunsDirectory(runsDirectory) {
  if (runsDirectory instanceof URL) {
    if (runsDirectory.protocol !== "file:") {
      throw new TypeError("runsDirectory URL must use file:");
    }
    return fileURLToPath(runsDirectory);
  }
  if (runsDirectory === undefined) {
    return DEFAULT_PHASE1_RUNS_DIRECTORY;
  }
  if (typeof runsDirectory !== "string" || runsDirectory.length === 0) {
    throw new TypeError("runsDirectory must be a non-empty path or file URL");
  }
  return path.resolve(runsDirectory);
}

async function ensurePrivateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
}

/** Report, but never parse, delete, or treat orphaned .tmp files as success. */
export async function listPhase1RunRecordTempFiles({ runsDirectory } = {}) {
  const directory = resolveRunsDirectory(runsDirectory);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
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
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * Validate and atomically persist one terminal run record. The temp file is
 * deliberately retained on interruption/error for explicit human review.
 */
export async function writePhase1RunRecord(record, { runsDirectory } = {}) {
  try {
    assertValidPhase1RunRecord(record);
  } catch (error) {
    if (error instanceof Phase1RunRecordValidationError) {
      throw error;
    }
    throw new Phase1RunRecordWriteError("run record validation failed", {
      cause: error,
    });
  }

  const directory = resolveRunsDirectory(runsDirectory);
  const runId = record.run_id;
  const tempPath = path.join(directory, `${runId}.tmp`);
  const recordPath = path.join(directory, `${runId}.json`);
  let fileHandle;

  try {
    await ensurePrivateDirectory(directory);
    const staleTempFiles = await listPhase1RunRecordTempFiles({
      runsDirectory: directory,
    });
    if (await finalRecordExists(recordPath)) {
      throw new Error("a final record with this run_id already exists");
    }

    fileHandle = await open(tempPath, "wx", 0o600);
    await fileHandle.chmod(0o600);
    await fileHandle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = undefined;

    await rename(tempPath, recordPath);
    return { recordPath, runId, staleTempFiles };
  } catch (error) {
    try {
      await fileHandle?.close();
    } catch {
      // Preserve the original write error. The temp file remains for review.
    }
    if (error instanceof Phase1RunRecordWriteError) {
      throw error;
    }
    throw new Phase1RunRecordWriteError("phase1 run record could not be written", {
      cause: error,
    });
  }
}
