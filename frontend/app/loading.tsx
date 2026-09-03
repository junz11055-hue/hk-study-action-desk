export default function Loading() {
  return (
    <main className="route-state" aria-busy="true">
      <div className="route-state__mark" aria-hidden="true" />
      <p>正在整理合成通知…</p>
      <span>未连接邮箱或日历</span>
    </main>
  );
}
