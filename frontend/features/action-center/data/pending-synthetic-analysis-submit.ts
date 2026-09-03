import { idempotencyKeySchema } from "../model/synthetic-analysis-task";

/**
 * The version lives in the key so the stored value is only the pending
 * Idempotency-Key. No task, Candidate, notification, or message content is
 * ever persisted by this helper.
 */
export const PENDING_SYNTHETIC_ANALYSIS_SUBMIT_KEY_V1 =
  "hkai.phase2ao.pending-idempotency-key.v1";

type SessionStoragePort = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

function browserSessionStorage(): SessionStoragePort | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readPendingSyntheticAnalysisSubmit(
  storage: SessionStoragePort | null = browserSessionStorage(),
): string | null {
  if (storage === null) return null;
  try {
    const value = storage.getItem(PENDING_SYNTHETIC_ANALYSIS_SUBMIT_KEY_V1);
    const parsed = idempotencyKeySchema.safeParse(value);
    if (parsed.success) return parsed.data;
    if (value !== null) {
      storage.removeItem(PENDING_SYNTHETIC_ANALYSIS_SUBMIT_KEY_V1);
    }
  } catch {
    // Storage can be unavailable even when window exists. The in-memory
    // submit lock remains authoritative for the current mount.
  }
  return null;
}

export function rememberPendingSyntheticAnalysisSubmit(
  idempotencyKey: string,
  storage: SessionStoragePort | null = browserSessionStorage(),
): boolean {
  if (!idempotencyKeySchema.safeParse(idempotencyKey).success || storage === null) {
    return false;
  }
  try {
    storage.setItem(PENDING_SYNTHETIC_ANALYSIS_SUBMIT_KEY_V1, idempotencyKey);
    return true;
  } catch {
    return false;
  }
}

export function clearPendingSyntheticAnalysisSubmit(
  storage: SessionStoragePort | null = browserSessionStorage(),
): void {
  if (storage === null) return;
  try {
    storage.removeItem(PENDING_SYNTHETIC_ANALYSIS_SUBMIT_KEY_V1);
  } catch {
    // Clearing is best effort when browser storage is disabled.
  }
}
