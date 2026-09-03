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

import { assertValidPhase2rdEvaluationRecord } from "../contracts/phase2rd-evaluation-record-v1.schema.js";
import { canonicalJsonStringify, hashCanonicalJson } from "../validation/canonical-json.js";
import {
  assertValidPhase2rdAuthorizationMarker,
  assertValidPhase2rdBatchTerminal,
  assertValidPhase2rdCaptureFile,
  assertValidPhase2rdCaptureIndex,
  assertValidPhase2rdCaseTerminal,
  assertValidPhase2rdRequestIntent,
} from "./phase2rd-capture-contract.js";
import { PHASE2RD_CASE_IDS } from "./phase2rd-run-contract.js";

export const DEFAULT_PHASE2RD_RUNTIME_DIRECTORY = fileURLToPath(
  new URL("../../../.runtime/phase-2rd/", import.meta.url),
);
export const DEFAULT_PHASE2RD_AUTHORIZATION_PATH = path.join(
  DEFAULT_PHASE2RD_RUNTIME_DIRECTORY,
  "authorization-consumed.json",
);

const PROJECT_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_CAPTURE_FILE_BYTES = 2_000_000;

export class Phase2rdCaptureStoreError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "Phase2rdCaptureStoreError";
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
      throw new Error("Phase 2R-D runtime escaped the project root");
    }
  }

  let current = target;
  while (true) {
    try {
      await assertRealDirectory(current);
      if ((await realpath(current)) !== path.resolve(current)) {
        throw new Error("Phase 2R-D runtime contains a symlink ancestor");
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
  let linked = false;
  try {
    handle = await open(tempPath, "wx", 0o600);
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(tempPath, filePath);
    linked = true;
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
    if (!linked) {
      try {
        await unlink(tempPath);
      } catch {
        // A private temp file is safer than masking the original failure.
      }
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
      path.resolve(runtimeDirectory) ===
      path.resolve(DEFAULT_PHASE2RD_RUNTIME_DIRECTORY),
  };
}

function assertRunId(runId) {
  if (!UUID_PATTERN.test(runId ?? "")) {
    throw new TypeError("runId must be a UUID v4");
  }
}

function assertCase(caseId, caseIndex) {
  if (
    !Number.isInteger(caseIndex) ||
    caseIndex < 0 ||
    caseIndex >= PHASE2RD_CASE_IDS.length ||
    caseId !== PHASE2RD_CASE_IDS[caseIndex]
  ) {
    throw new TypeError("caseId and caseIndex must match the frozen Phase 2R-D order");
  }
}

export function phase2rdRunDirectory(
  runId,
  { runtimeDirectory = DEFAULT_PHASE2RD_RUNTIME_DIRECTORY } = {},
) {
  assertRunId(runId);
  return path.join(path.resolve(runtimeDirectory), "runs", runId);
}

export async function createPhase2rdAuthorizationMarker(
  marker,
  { runtimeDirectory = DEFAULT_PHASE2RD_RUNTIME_DIRECTORY } = {},
) {
  try {
    assertValidPhase2rdAuthorizationMarker(marker);
    assertRunId(marker?.run_id);
  } catch (error) {
    throw new Phase2rdCaptureStoreError(
      "phase2rd_authorization_marker_failed",
      "The Phase 2R-D authorization marker failed validation.",
      { cause: error },
    );
  }
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
    throw new Phase2rdCaptureStoreError(
      error?.code === "EEXIST"
        ? "phase2rd_authorization_already_consumed"
        : "phase2rd_authorization_marker_failed",
      error?.code === "EEXIST"
        ? "The approved Phase 2R-D one-shot batch was already consumed."
        : "The Phase 2R-D authorization marker could not be persisted.",
      { cause: error },
    );
  }
}

function caseFileName(caseId, caseIndex, suffix) {
  assertCase(caseId, caseIndex);
  return `${String(caseIndex + 1).padStart(2, "0")}-${caseId}.${suffix}.json`;
}

async function writeRunFile(value, fileName, runtimeDirectory, code, message) {
  assertRunId(value?.run_id);
  const filePath = path.join(
    phase2rdRunDirectory(value.run_id, { runtimeDirectory }),
    fileName,
  );
  try {
    return await writeNoClobberJson(
      value,
      filePath,
      runtimeOptions(runtimeDirectory),
    );
  } catch (error) {
    throw new Phase2rdCaptureStoreError(code, message, { cause: error });
  }
}

export async function writePhase2rdRequestIntent(
  intent,
  { runtimeDirectory = DEFAULT_PHASE2RD_RUNTIME_DIRECTORY } = {},
) {
  try {
    assertValidPhase2rdRequestIntent(intent);
  } catch (error) {
    throw new Phase2rdCaptureStoreError(
      "phase2rd_intent_write_failed",
      "A Phase 2R-D request intent failed validation before persistence.",
      { cause: error },
    );
  }
  return await writeRunFile(
    intent,
    caseFileName(intent?.case_id, intent?.case_index, "intent"),
    runtimeDirectory,
    "phase2rd_intent_write_failed",
    "A Phase 2R-D request intent could not be persisted before transport.",
  );
}

export async function writePhase2rdCaseTerminal(
  terminal,
  { runtimeDirectory = DEFAULT_PHASE2RD_RUNTIME_DIRECTORY } = {},
) {
  try {
    assertValidPhase2rdCaseTerminal(terminal);
  } catch (error) {
    throw new Phase2rdCaptureStoreError(
      "phase2rd_terminal_write_failed",
      "A Phase 2R-D case terminal failed validation before persistence.",
      { cause: error },
    );
  }
  return await writeRunFile(
    terminal,
    caseFileName(terminal?.case_id, terminal?.case_index, "terminal"),
    runtimeDirectory,
    "phase2rd_terminal_write_failed",
    "A Phase 2R-D case terminal could not be persisted.",
  );
}

export async function writePhase2rdCaptureIndex(
  index,
  { runtimeDirectory = DEFAULT_PHASE2RD_RUNTIME_DIRECTORY } = {},
) {
  try {
    assertValidPhase2rdCaptureIndex(index);
  } catch (error) {
    throw new Phase2rdCaptureStoreError(
      "phase2rd_capture_index_write_failed",
      "The Phase 2R-D capture index failed validation before persistence.",
      { cause: error },
    );
  }
  return await writeRunFile(
    index,
    "capture-index.json",
    runtimeDirectory,
    "phase2rd_capture_index_write_failed",
    "The Phase 2R-D capture index could not be persisted.",
  );
}

export async function writePhase2rdBatchTerminal(
  terminal,
  { runtimeDirectory = DEFAULT_PHASE2RD_RUNTIME_DIRECTORY } = {},
) {
  try {
    assertValidPhase2rdBatchTerminal(terminal);
  } catch (error) {
    throw new Phase2rdCaptureStoreError(
      "phase2rd_batch_terminal_write_failed",
      "The Phase 2R-D batch terminal failed validation before persistence.",
      { cause: error },
    );
  }
  try {
    return await writeRunFile(
      terminal,
      "batch-terminal.json",
      runtimeDirectory,
      "phase2rd_batch_terminal_write_failed",
      "The Phase 2R-D batch terminal could not be persisted.",
    );
  } catch (error) {
    if (error?.cause?.code === "EEXIST") {
      throw new Phase2rdCaptureStoreError(
        "phase2rd_batch_terminal_already_exists",
        "The Phase 2R-D batch already has an immutable terminal record.",
        { cause: error.cause },
      );
    }
    throw error;
  }
}

export async function writePhase2rdEvaluationRecord(
  record,
  { runtimeDirectory = DEFAULT_PHASE2RD_RUNTIME_DIRECTORY } = {},
) {
  try {
    assertValidPhase2rdEvaluationRecord(record);
  } catch (error) {
    throw new Phase2rdCaptureStoreError(
      "phase2rd_evaluation_write_failed",
      "The Phase 2R-D evaluation record failed validation before persistence.",
      { cause: error },
    );
  }
  return await writeRunFile(
    record,
    "evaluation.json",
    runtimeDirectory,
    "phase2rd_evaluation_write_failed",
    "The Phase 2R-D evaluation record could not be persisted.",
  );
}

export async function readPhase2rdAuthorizationMarker({
  runtimeDirectory = DEFAULT_PHASE2RD_RUNTIME_DIRECTORY,
} = {}) {
  try {
    const marker = await readPrivateNoFollowJson(
      path.join(path.resolve(runtimeDirectory), "authorization-consumed.json"),
    );
    assertValidPhase2rdAuthorizationMarker(marker);
    return marker;
  } catch (error) {
    throw new Phase2rdCaptureStoreError(
      "phase2rd_authorization_marker_invalid",
      "The durable Phase 2R-D authorization marker is unavailable or unsafe.",
      { cause: error },
    );
  }
}

export async function readPhase2rdCaptureFile(filePath) {
  try {
    const value = await readPrivateNoFollowJson(filePath);
    assertValidPhase2rdCaptureFile(value);
    return value;
  } catch (error) {
    throw new Phase2rdCaptureStoreError(
      "phase2rd_capture_read_failed",
      "A Phase 2R-D capture file is unavailable or unsafe.",
      { cause: error },
    );
  }
}
