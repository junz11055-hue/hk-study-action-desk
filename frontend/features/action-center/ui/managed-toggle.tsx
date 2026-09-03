"use client";

import { Archive, ArchiveRestore } from "lucide-react";
import {
  useManagedDemoItem,
  type ManagedDemoKind,
} from "../data/managed-demo-store";

type ManagedToggleProps = Readonly<{
  id: string;
  kind: ManagedDemoKind;
  compact?: boolean;
}>;

export function ManagedToggle({ id, kind, compact = false }: ManagedToggleProps) {
  const { managed, toggle } = useManagedDemoItem(id, kind);
  const Icon = managed ? ArchiveRestore : Archive;

  return (
    <button
      aria-pressed={managed}
      className={`managed-toggle${compact ? " managed-toggle--compact" : ""}`}
      onClick={toggle}
      type="button"
    >
      <Icon aria-hidden="true" size={16} />
      {managed ? "移回待管理" : "标记已管理"}
    </button>
  );
}
