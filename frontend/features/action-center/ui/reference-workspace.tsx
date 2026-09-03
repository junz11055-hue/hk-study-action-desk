import {
  ArrowUpRight,
  BookOpenCheck,
  Check,
  CircleUserRound,
  Clock3,
  Database,
  Link2Off,
  MapPinned,
  ShieldCheck,
} from "lucide-react";
import { syntheticGuides } from "../data/synthetic-guides";
import type { WorkspaceView } from "../model/workspace-view";
import { ManagedItemsPanel } from "./managed-items-panel";
import { ManagedToggle } from "./managed-toggle";
import type { ActionCard } from "./presentation";
import { WorkspaceShell } from "./workspace-shell";

type ReferenceWorkspaceProps = Readonly<{
  cards: readonly ActionCard[];
  hostedDemo?: boolean;
  view: Exclude<WorkspaceView, "notifications">;
}>;

function categoryCounts(cards: readonly ActionCard[]) {
  return {
    academic: cards.filter((card) => card.topics.includes("academic_course"))
      .length,
    protectedAffairs: cards.filter((card) =>
      card.topics.some((topic) =>
        [
          "payment_funding",
          "registration_status",
          "visa_identity",
          "exam_results",
          "account_security",
        ].includes(topic),
      ),
    ).length,
    campus: cards.filter((card) =>
      card.topics.some((topic) =>
        ["campus_activity", "housing_campus_life"].includes(topic),
      ),
    ).length,
  };
}

function PageHeader({
  eyebrow,
  title,
  description,
}: Readonly<{ eyebrow: string; title: string; description: string }>) {
  return (
    <header className="reference-header">
      <p>{eyebrow}</p>
      <h1>{title}</h1>
      <span>{description}</span>
    </header>
  );
}

function ManagedView({ cards }: Readonly<{ cards: readonly ActionCard[] }>) {
  return (
    <div className="reference-page">
      <PageHeader
        description="这里保存你在本机浏览器中整理过的演示项目，不会同步到学校系统。"
        eyebrow="LOCAL DEMO RECORDS"
        title="已管理"
      />
      <div className="reference-notice" role="note">
        <ShieldCheck aria-hidden="true" size={18} />
        <p>
          <strong>“已管理”只代表你在演示中整理过。</strong>
          缴费、注册、签证等学校事项是否完成，仍须返回官方系统核对。
        </p>
      </div>
      <ManagedItemsPanel cards={cards} guides={syntheticGuides} />
    </div>
  );
}

function GuidesView() {
  const stages = [
    { label: "抵港前", detail: "准备基础通信与支付", state: "complete" },
    { label: "抵港初期", detail: "先让日常生活运转", state: "current" },
    { label: "安顿办理", detail: "逐项核对高影响手续", state: "next" },
  ] as const;

  return (
    <div className="reference-page">
      <PageHeader
        description="按抵港阶段整理生活与手续入口；涉及资格、材料和期限时，只以官方最新说明为准。"
        eyebrow="HONG KONG STARTER ROUTE"
        title="香港指南"
      />

      <section className="stage-route" aria-labelledby="stage-route-heading">
        <div className="stage-route__heading">
          <span aria-hidden="true">
            <MapPinned size={20} />
          </span>
          <div>
            <h2 id="stage-route-heading">当前阶段：抵港初期</h2>
            <p>演示画像 · 授课型研究生</p>
          </div>
        </div>
        <ol>
          {stages.map((stage) => (
            <li
              data-state={stage.state}
              key={stage.label}
              {...(stage.state === "current"
                ? { "aria-current": "step" as const }
                : {})}
            >
              <span className="stage-route__node" aria-hidden="true">
                {stage.state === "complete" ? <Check size={14} /> : null}
              </span>
              <strong>{stage.label}</strong>
              <small>{stage.detail}</small>
            </li>
          ))}
        </ol>
      </section>

      <section className="guide-grid" aria-label="阶段指南">
        {syntheticGuides.map((guide) => (
          <article className="guide-card-new" id={`guide-${guide.id}`} key={guide.id}>
            <div className="guide-card-new__top">
              <div>
                <span>{guide.stage}</span>
                <h2>{guide.title}</h2>
              </div>
              <span className={guide.reviewOnly ? "is-review" : ""}>
                {guide.reviewOnly ? "仅供核对" : "演示指南"}
              </span>
            </div>
            <p>{guide.summary}</p>
            <ul>
              {guide.checklist.map((item) => (
                <li key={item}>
                  <Check aria-hidden="true" size={14} />
                  {item}
                </li>
              ))}
            </ul>
            <div className="guide-card-new__source">
              <BookOpenCheck aria-hidden="true" size={16} />
              <div>
                <strong>{guide.sourceLabel}</strong>
                <span>{guide.validThrough}</span>
              </div>
            </div>
            <div className="guide-card-new__actions">
              <a href={guide.sourceUrl} rel="noopener noreferrer" target="_blank">
                官方说明
                <ArrowUpRight aria-hidden="true" size={15} />
              </a>
              <ManagedToggle compact id={guide.id} kind="guide" />
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function SettingsView() {
  const rows = [
    { label: "演示身份", value: "授课型研究生", icon: CircleUserRound },
    { label: "当前阶段", value: "抵港初期", icon: MapPinned },
    { label: "处理时区", value: "Asia/Hong_Kong", icon: Clock3 },
    { label: "数据范围", value: "完全合成数据", icon: Database },
  ] as const;

  return (
    <div className="reference-page reference-page--settings">
      <PageHeader
        description="查看本次邀请码演示使用的画像与数据边界。当前版本不提供真实账号编辑或第三方连接。"
        eyebrow="READ-ONLY DEMO PROFILE"
        title="设置"
      />

      <section className="settings-card" aria-labelledby="demo-profile-heading">
        <div className="settings-card__heading">
          <span aria-hidden="true">研</span>
          <div>
            <h2 id="demo-profile-heading">邀请码演示画像</h2>
            <p>只读 · 不对应任何真实学生</p>
          </div>
        </div>
        <dl>
          {rows.map((row) => {
            const Icon = row.icon;
            return (
              <div key={row.label}>
                <dt>
                  <Icon aria-hidden="true" size={17} />
                  {row.label}
                </dt>
                <dd>{row.value}</dd>
              </div>
            );
          })}
        </dl>
      </section>

      <section className="settings-card" aria-labelledby="connections-heading">
        <div className="settings-card__section-title">
          <span aria-hidden="true">
            <Link2Off size={18} />
          </span>
          <div>
            <h2 id="connections-heading">外部连接</h2>
            <p>当前演示保持离线边界</p>
          </div>
        </div>
        <div className="connection-rows">
          <div>
            <span>学校邮箱</span>
            <strong>未连接</strong>
          </div>
          <div>
            <span>个人日历</span>
            <strong>未连接</strong>
          </div>
        </div>
        <p className="settings-boundary">
          本页面没有 OAuth、账号绑定或数据同步能力；按钮缺失是当前安全边界，不是连接失败。
        </p>
      </section>
    </div>
  );
}

export function ReferenceWorkspace({
  cards,
  hostedDemo = false,
  view,
}: ReferenceWorkspaceProps) {
  return (
    <WorkspaceShell
      activeView={view}
      categoryCounts={categoryCounts(cards)}
      notificationCount={cards.length}
      showExitDemo={!hostedDemo}
      singlePanel
    >
      {view === "managed" ? <ManagedView cards={cards} /> : null}
      {view === "guides" ? <GuidesView /> : null}
      {view === "settings" ? <SettingsView /> : null}
    </WorkspaceShell>
  );
}
