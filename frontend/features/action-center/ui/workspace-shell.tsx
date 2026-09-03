import Link from "next/link";
import type { ReactNode } from "react";
import {
  Archive,
  BookOpen,
  Inbox,
  LogOut,
  Route,
  Settings,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import type { WorkspaceView } from "../model/workspace-view";

type CategoryCounts = Readonly<{
  academic: number;
  protectedAffairs: number;
  campus: number;
}>;

type WorkspaceShellProps = Readonly<{
  activeView: WorkspaceView;
  categoryCounts: CategoryCounts;
  children: ReactNode;
  notificationCount: number;
  onExitDemo?: (() => void) | undefined;
  showExitDemo?: boolean;
  singlePanel?: boolean;
}>;

const navigation = [
  {
    id: "notifications",
    label: "通知中心",
    mobileLabel: "通知",
    href: "/workspace",
    icon: Inbox,
  },
  {
    id: "managed",
    label: "已管理",
    mobileLabel: "已管理",
    href: "/workspace/managed",
    icon: Archive,
  },
  {
    id: "guides",
    label: "香港指南",
    mobileLabel: "指南",
    href: "/workspace/guides",
    icon: BookOpen,
  },
  {
    id: "settings",
    label: "设置",
    mobileLabel: "设置",
    href: "/workspace/settings",
    icon: Settings,
  },
] as const;

const viewLabels: Record<WorkspaceView, string> = {
  notifications: "通知中心",
  managed: "已管理",
  guides: "香港指南",
  settings: "设置",
};

function DemoLogout({
  compact = false,
  onExitDemo,
}: Readonly<{
  compact?: boolean;
  onExitDemo?: (() => void) | undefined;
}>) {
  return (
    <form
      action="/api/demo-access/session/logout"
      className={`demo-logout ${
        compact ? "demo-logout--topbar" : "demo-logout--sidebar"
      }`}
      method="post"
      onSubmit={onExitDemo}
    >
      <button
        aria-label="退出演示"
        className={`demo-logout__button${
          compact ? " demo-logout__button--compact" : ""
        }`}
        type="submit"
      >
        <LogOut aria-hidden="true" size={compact ? 15 : 16} />
        {compact ? "退出" : "退出演示"}
      </button>
    </form>
  );
}

export function WorkspaceShell({
  activeView,
  categoryCounts,
  children,
  notificationCount,
  onExitDemo,
  showExitDemo = true,
  singlePanel = false,
}: WorkspaceShellProps) {
  return (
    <div className="action-center-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>

      <aside className="workspace-sidebar">
        <Link
          aria-label="AI 留学管家通知中心"
          className="brand-lockup"
          href="/workspace"
        >
          <span className="brand-mark" aria-hidden="true">
            <Route size={21} />
          </span>
          <span>
            <strong>留港行动台</strong>
            <small>AI 留学管家</small>
          </span>
        </Link>

        <nav className="primary-nav" aria-label="主要导航">
          <ul>
            {navigation.map((item) => {
              const Icon = item.icon;
              const current = item.id === activeView;
              return (
                <li key={item.id}>
                  <Link
                    {...(current ? { "aria-current": "page" as const } : {})}
                    href={item.href}
                  >
                    <Icon aria-hidden="true" key="icon" size={18} />
                    <span className="primary-nav__label" key="label">
                      {item.label}
                    </span>
                    {item.id === "notifications" ? (
                      <span className="primary-nav__count" key="count">
                        {notificationCount}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <section
          className="category-overview"
          aria-labelledby="category-overview-heading"
        >
          <h2 id="category-overview-heading">分类概览</h2>
          <dl>
            <div>
              <dt>专业与课程</dt>
              <dd>{categoryCounts.academic}</dd>
            </div>
            <div>
              <dt>高后果校务</dt>
              <dd>{categoryCounts.protectedAffairs}</dd>
            </div>
            <div>
              <dt>校园生活</dt>
              <dd>{categoryCounts.campus}</dd>
            </div>
          </dl>
        </section>

        <div className="connection-card" role="note">
          <div>
            <ShieldCheck aria-hidden="true" size={18} />
            <strong>合成安全模式</strong>
          </div>
          <p>
            <WifiOff aria-hidden="true" size={15} />
            未连接邮箱或日历
          </p>
          <span>不读取真实学生数据</span>
        </div>

        {showExitDemo ? <DemoLogout onExitDemo={onExitDemo} /> : null}

        <div className="sidebar-profile">
          <span aria-hidden="true">研</span>
          <div>
            <strong>授课型研究生</strong>
            <small>{showExitDemo ? "邀请码演示画像" : "公开合成演示"}</small>
          </div>
        </div>
      </aside>

      <header className="workspace-topbar">
        <Link className="brand-lockup brand-lockup--compact" href="/workspace">
          <span className="brand-mark" aria-hidden="true">
            <Route size={19} />
          </span>
          <span>
            <strong>留港行动台</strong>
            <small>{viewLabels[activeView]}</small>
          </span>
        </Link>
        <div className="topbar-actions">
          <div className="topbar-mode" role="note">
            <span>合成模式</span>
            <small>未接邮箱 / 日历</small>
          </div>
          {showExitDemo ? <DemoLogout compact onExitDemo={onExitDemo} /> : null}
        </div>
      </header>

      <main
        className={`workspace-main${singlePanel ? " workspace-main--single" : ""}`}
        id="main-content"
        tabIndex={-1}
      >
        {children}
      </main>

      <nav className="mobile-bottom-nav" aria-label="手机端主要导航">
        {navigation.map((item) => {
          const Icon = item.icon;
          const current = item.id === activeView;
          return (
            <Link
              {...(current ? { "aria-current": "page" as const } : {})}
              href={item.href}
              key={item.id}
            >
              <Icon aria-hidden="true" key="icon" size={19} />
              <span key="label">{item.mobileLabel}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
