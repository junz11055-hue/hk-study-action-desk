import Link from "next/link";

export default function NotFound() {
  return (
    <main className="route-state">
      <div className="route-state__mark" aria-hidden="true" />
      <h1>没有找到这个页面</h1>
      <p>当前演示只提供通知、已管理、香港指南与设置页面。</p>
      <Link className="route-state__button" href="/workspace">
        返回通知中心
      </Link>
    </main>
  );
}
