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

import { canonicalJsonStringify, hashCanonicalJson } from "../validation/canonical-json.js";
import {
  assertPhase2alAuthorizationMarker,
  assertPhase2alCandidateCapture,
  assertPhase2alProviderTerminal,
  assertPhase2alRequestIntent,
  assertPhase2alRunIndex,
  assertPhase2alTaskTerminal,
} from "./phase2al-capture-contract.js";

export const DEFAULT_PHASE2AL_RUNTIME_DIRECTORY = fileURLToPath(
  new URL("../../../.runtime/phase-2al/", import.meta.url),
);

const PROJECT_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_FILE_BYTES = 2_000_000;

export class Phase2alCaptureStoreError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "Phase2alCaptureStoreError";
    this.code = code;
  }
}
function storeError(code, message, cause) {
  return new Phase2alCaptureStoreError(code, message, { cause });
}

function assertRunId(runId) {
  if (!UUID_PATTERN.test(runId ?? "")) throw new TypeError("runId must be a UUID v4");
}

async function assertRealDirectory(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("runtime path must contain only real directories");
  }
}

async function assertSafePrefix(directory, { projectContained }) {
  const target = path.resolve(directory);
  if (projectContained) {
    const relative = path.relative(path.resolve(PROJECT_ROOT), target);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("Phase 2A-L runtime escaped the repository");
    }
  }
  let current = target;
  while (true) {
    try {
      await assertRealDirectory(current);
      if ((await realpath(current)) !== current) {
        throw new Error("Phase 2A-L runtime contains a symlink ancestor");
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

function runtimeOptions(runtimeDirectory) {
  return {
    projectContained:
      path.resolve(runtimeDirectory) === path.resolve(DEFAULT_PHASE2AL_RUNTIME_DIRECTORY),
  };
}

async function ensurePrivateDirectory(directory, options) {
  await assertSafePrefix(directory, options);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertSafePrefix(directory, options);
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

async function writeNoClobberJson(value, filePath, options) {
  const snapshot = JSON.parse(canonicalJsonStringify(value));
  const directory = path.dirname(filePath);
  await ensurePrivateDirectory(directory, options);
  const temporary = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  let handle;
  let linked = false;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporary, filePath);
    linked = true;
    await unlink(temporary);
    await syncDirectory(directory);
    return Object.freeze({ path: filePath, hash: hashCanonicalJson(snapshot), snapshot });
  } catch (error) {
    try {
      await handle?.close();
    } catch {
      // Preserve the original error.
    }
    if (!linked) {
      try {
        await unlink(temporary);
      } catch {
        // A bounded private temporary file is safer than hiding the root cause.
      }
    }
    throw error;
  }
}

async function readPrivateJson(filePath) {
  const resolved = path.resolve(filePath);
  const directory = path.dirname(resolved);
  let handle;
  try {
    await assertSafePrefix(directory, { projectContained: false });
    const directoryInfo = await lstat(directory);
    const pathInfo = await lstat(resolved);
    if (
      !directoryInfo.isDirectory() ||
      directoryInfo.isSymbolicLink() ||
      (directoryInfo.mode & 0o077) !== 0 ||
      !pathInfo.isFile() ||
      pathInfo.isSymbolicLink() ||
      (pathInfo.mode & 0o777) !== 0o600 ||
      pathInfo.size < 1 ||
      pathInfo.size > MAX_FILE_BYTES
    ) {
      throw new Error("Phase 2A-L capture path is not private");
    }
    handle = await open(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.dev !== pathInfo.dev ||
      opened.ino !== pathInfo.ino ||
      opened.size !== pathInfo.size ||
      (opened.mode & 0o777) !== 0o600 ||
      (await realpath(resolved)) !== resolved
    ) {
      throw new Error("Phase 2A-L capture changed during read");
    }
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle?.close();
  }
}

export function phase2alRunDirectory(
  runId,
  { runtimeDirectory = DEFAULT_PHASE2AL_RUNTIME_DIRECTORY } = {},
) {
  assertRunId(runId);
  return path.join(path.resolve(runtimeDirectory), "runs", runId);
}

async function writeValidated({
  value,
  validate,
  path: filePath,
  runtimeDirectory,
  code,
  message,
  existsCode = code,
}) {
  try {
    validate(value);
  } catch (error) {
    throw storeError(code, message, error);
  }
  try {
    return await writeNoClobberJson(value, filePath, runtimeOptions(runtimeDirectory));
  } catch (error) {
    throw storeError(error?.code === "EEXIST" ? existsCode : code, message, error);
  }
}

export async function createPhase2alAuthorizationMarker(
  marker,
  { runtimeDirectory = DEFAULT_PHASE2AL_RUNTIME_DIRECTORY } = {},
) {
  return await writeValidated({
    value: marker,
    validate: assertPhase2alAuthorizationMarker,
    path: path.join(path.resolve(runtimeDirectory), "authorization-consumed.json"),
    runtimeDirectory,
    code: "phase2al_authorization_marker_failed",
    existsCode: "phase2al_authorization_already_consumed",
    message: "The Phase 2A-L one-shot authorization could not be consumed.",
  });
}

async function writeRunFile(value, fileName, validate, runtimeDirectory, code) {
  assertRunId(value?.run_id);
  return await writeValidated({
    value,
    validate,
    path: path.join(phase2alRunDirectory(value.run_id, { runtimeDirectory }), fileName),
    runtimeDirectory,
    code,
    existsCode: `${code}_already_exists`,
    message: "The immutable Phase 2A-L evidence file could not be persisted.",
  });
}

export async function writePhase2alRequestIntent(
  value,
  { runtimeDirectory = DEFAULT_PHASE2AL_RUNTIME_DIRECTORY } = {},
) {
  return await writeRunFile(
    value,
    "request-intent.json",
    assertPhase2alRequestIntent,
    runtimeDirectory,
    "phase2al_request_intent_failed",
  );
}

export async function writePhase2alProviderTerminal(
  value,
  { runtimeDirectory = DEFAULT_PHASE2AL_RUNTIME_DIRECTORY } = {},
) {
  return await writeRunFile(
    value,
    "provider-terminal.json",
    assertPhase2alProviderTerminal,
    runtimeDirectory,
    "phase2al_provider_terminal_failed",
  );
}

export async function writePhase2alCandidateCapture(
  value,
  { runtimeDirectory = DEFAULT_PHASE2AL_RUNTIME_DIRECTORY } = {},
) {
  return await writeRunFile(
    value,
    "candidate-capture.json",
    assertPhase2alCandidateCapture,
    runtimeDirectory,
    "phase2al_candidate_capture_failed",
  );
}

export async function writePhase2alTaskTerminal(
  value,
  { runtimeDirectory = DEFAULT_PHASE2AL_RUNTIME_DIRECTORY } = {},
) {
  return await writeRunFile(
    value,
    "task-terminal.json",
    assertPhase2alTaskTerminal,
    runtimeDirectory,
    "phase2al_task_terminal_failed",
  );
}

export async function writePhase2alRunIndex(
  value,
  { runtimeDirectory = DEFAULT_PHASE2AL_RUNTIME_DIRECTORY } = {},
) {
  return await writeRunFile(
    value,
    "run-index.json",
    assertPhase2alRunIndex,
    runtimeDirectory,
    "phase2al_run_index_failed",
  );
}

export async function readPhase2alEvidence(
  filePath,
  { validate = undefined } = {},
) {
  try {
    const value = await readPrivateJson(filePath);
    validate?.(value);
    return value;
  } catch (error) {
    throw storeError(
      "phase2al_capture_read_failed",
      "The private Phase 2A-L evidence could not be read safely.",
      error,
    );
  }
}
