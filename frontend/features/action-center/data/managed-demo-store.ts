"use client";

import { useCallback, useEffect, useState } from "react";

export const MANAGED_DEMO_STORAGE_KEY_V1 =
  "ai-study-notification-center:managed-demo:v1";

export type ManagedDemoKind = "notification" | "guide";

export type ManagedDemoEntry = Readonly<{
  id: string;
  kind: ManagedDemoKind;
  managedAt: string;
}>;

const managedDemoChangedEvent = "managed-demo-changed";

function validEntry(value: unknown): value is ManagedDemoEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    (candidate.kind === "notification" || candidate.kind === "guide") &&
    typeof candidate.managedAt === "string"
  );
}

function readEntries(): readonly ManagedDemoEntry[] {
  try {
    const raw = window.localStorage.getItem(MANAGED_DEMO_STORAGE_KEY_V1);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(validEntry) : [];
  } catch {
    return [];
  }
}

function writeEntries(entries: readonly ManagedDemoEntry[]): void {
  window.localStorage.setItem(
    MANAGED_DEMO_STORAGE_KEY_V1,
    JSON.stringify(entries),
  );
  window.dispatchEvent(new Event(managedDemoChangedEvent));
}

export function useManagedDemoEntries(): readonly ManagedDemoEntry[] {
  const [entries, setEntries] = useState<readonly ManagedDemoEntry[]>([]);

  useEffect(() => {
    const refresh = () => setEntries(readEntries());
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener(managedDemoChangedEvent, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(managedDemoChangedEvent, refresh);
    };
  }, []);

  return entries;
}

export function useManagedDemoItem(
  id: string,
  kind: ManagedDemoKind,
): Readonly<{ managed: boolean; toggle: () => void }> {
  const [managed, setManaged] = useState(false);

  useEffect(() => {
    const refresh = () =>
      setManaged(
        readEntries().some(
          (entry) => entry.id === id && entry.kind === kind,
        ),
      );
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener(managedDemoChangedEvent, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(managedDemoChangedEvent, refresh);
    };
  }, [id, kind]);

  const toggle = useCallback(() => {
    const current = readEntries();
    const exists = current.some(
      (entry) => entry.id === id && entry.kind === kind,
    );
    const next = exists
      ? current.filter((entry) => entry.id !== id || entry.kind !== kind)
      : [
          ...current,
          { id, kind, managedAt: new Date().toISOString() } satisfies ManagedDemoEntry,
        ];
    writeEntries(next);
    setManaged(!exists);
  }, [id, kind]);

  return { managed, toggle };
}
