"use client";

type ErrorPageProps = Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>;

export default function ErrorPage(props: ErrorPageProps) {
  return (
    <main className="route-state route-state--error">
      <div className="route-state__mark" aria-hidden="true" />
      <h1>合成数据未能安全显示</h1>
      <p>
        前端已停止渲染不符合合同的数据。请重新读取确定性的合成夹具。
      </p>
      <button
        className="route-state__button"
        type="button"
        onClick={props.reset}
      >
        重新读取
      </button>
    </main>
  );
}
