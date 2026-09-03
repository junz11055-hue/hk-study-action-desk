import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { validatePhase1CoreRunRecord } from "../contracts/phase1-core-run-record-v2.schema.js";
import { resolvePhase1CoreRunsDirectory } from "./core-run-record-writer.js";

const CONTENT_FAILURE_OUTCOMES = new Set([
  "truncated",
  "invalid_json",
  "candidate_invalid",
]);

export class Phase1CorePayloadHistoryError extends Error {
  constructor() {
    super("Core payload history could not be verified safely");
    this.name = "Phase1CorePayloadHistoryError";
    this.code = "internal_error";
  }
}

/**
 * Recover only content-failure request hashes from validated terminal records.
 * Malformed history fails closed so transport cannot proceed on incomplete evidence.
 */
export async function loadPhase1CoreContentFailureHashes({
  runsDirectory,
  readFileImpl = readFile,
  readdirImpl = readdir,
} = {}) {
  const directory = resolvePhase1CoreRunsDirectory(runsDirectory);
  let entries;
  try {
    entries = await readdirImpl(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return Object.freeze([]);
    throw new Phase1CorePayloadHistoryError();
  }

  if (entries.some((entry) => entry.name.endsWith(".tmp"))) {
    throw new Phase1CorePayloadHistoryError();
  }

  const jsonEntries = entries.filter((entry) => entry.name.endsWith(".json"));
  if (jsonEntries.some((entry) => !entry.isFile())) {
    throw new Phase1CorePayloadHistoryError();
  }

  const recordNames = jsonEntries
    .map((entry) => entry.name)
    .sort();
  const blocked = new Set();

  for (const name of recordNames) {
    try {
      const record = JSON.parse(await readFileImpl(path.join(directory, name), "utf8"));
      if (!validatePhase1CoreRunRecord(record).valid) {
        throw new Error("invalid terminal record");
      }
      const attempt = record.status === "failed" ? record.attempts[0] : null;
      if (attempt && CONTENT_FAILURE_OUTCOMES.has(attempt.outcome)) {
        blocked.add(attempt.request_payload_hash);
      }
      if (
        record.status === "failed" &&
        record.error?.code === "duplicate_payload_blocked"
      ) {
        blocked.add(record.hashes.blocked_payload_hash);
      }
    } catch {
      throw new Phase1CorePayloadHistoryError();
    }
  }

  return Object.freeze([...blocked].sort());
}
