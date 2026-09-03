"use client";

import Link from "next/link";
import { Archive, BookOpen, Inbox, ShieldCheck } from "lucide-react";
import { useManagedDemoEntries } from "../data/managed-demo-store";
import type { SyntheticGuide } from "../data/synthetic-guides";
import { workspaceHref } from "../model/workspace-url";
import type { ActionCard } from "./presentation";
import { ManagedToggle } from "./managed-toggle";

type ManagedItemsPanelProps = Readonly<{
  cards: readonly ActionCard[];
  guides: readonly SyntheticGuide[];
}>;

export function ManagedItemsPanel({ cards, guides }: ManagedItemsPanelProps) {
  const entries = useManagedDemoEntries();
  const items: Array<
    | Readonly<{
        entry: (typeof entries)[number];
        card: ActionCard;
        guide: null;
      }>
    | Readonly<{
        entry: (typeof entries)[number];
        card: null;
        guide: SyntheticGuide;
      }>
  > = [];
  for (const entry of entries) {
    if (entry.kind === "notification") {
      const card = cards.find((candidate) => candidate.notification.id === entry.id);
      if (card !== undefined) items.push({ entry, card, guide: null });
      continue;
    }
    const guide = guides.find((candidate) => candidate.id === entry.id);
    if (guide !== undefined) items.push({ entry, card: null, guide });
  }

  if (items.length === 0) {
    return (
      <section className="managed-empty" aria-labelledby="managed-empty-heading">
        <span aria-hidden="true">
          <Archive size={25} />
        </span>
        <h2 id="managed-empty-heading">还没有已管理事项</h2>
        <p>打开一张通知行动卡或香港指南，选择“标记已管理”后会出现在这里。</p>
        <div>
          <Link href="/workspace">
            <Inbox aria-hidden="true" size={16} />
            查看通知
          </Link>
          <Link href="/workspace/guides">
            <BookOpen aria-hidden="true" size={16} />
            查看指南
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="managed-list" aria-label="已管理项目">
      {items.map(({ entry, card, guide }) => {
        const href =
          card === null
            ? `/workspace/guides#guide-${guide?.id ?? ""}`
            : workspaceHref({ notificationId: card.notification.id });
        const title = card?.title ?? guide?.title ?? "演示项目";
        const summary = card?.summary ?? guide?.summary ?? "";
        return (
          <article className="managed-item" key={`${entry.kind}:${entry.id}`}>
            <div className="managed-item__icon" aria-hidden="true">
              {card === null ? <BookOpen size={18} /> : <Inbox size={18} />}
            </div>
            <div className="managed-item__content">
              <div className="managed-item__meta">
                <span>{card === null ? "香港指南" : "学校通知"}</span>
                <span>仅本机演示记录</span>
              </div>
              <h2>
                <Link href={href}>{title}</Link>
              </h2>
              <p>{summary}</p>
              <div className="managed-item__footer">
                <span>
                  <ShieldCheck aria-hidden="true" size={14} />
                  不代表学校事项已完成
                </span>
                <ManagedToggle compact id={entry.id} kind={entry.kind} />
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}
