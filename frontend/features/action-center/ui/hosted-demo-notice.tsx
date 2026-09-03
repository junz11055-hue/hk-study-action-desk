import { Eye, FlaskConical, ShieldCheck } from "lucide-react";

export function HostedDemoNotice() {
  return (
    <section
      aria-labelledby="hosted-demo-heading"
      className="analysis-slot"
      data-status="succeeded"
    >
      <div className="analysis-slot__eyebrow">
        <FlaskConical aria-hidden="true" size={15} />
        公开 Demo · 固定合成数据
      </div>
      <div className="analysis-slot__heading-row">
        <span className="analysis-slot__node" aria-hidden="true">
          <ShieldCheck size={17} />
        </span>
        <div>
          <h2 id="hosted-demo-heading">四类学校通知已经整理好</h2>
          <p>选择下方卡片，查看“是否要做、何时做、为什么与你相关”及原文证据。</p>
        </div>
      </div>
      <p className="analysis-slot__mode">
        <Eye aria-hidden="true" size={14} />
        静态结果展示 · 不代表本次实时模型推理
      </p>
      <p className="analysis-slot__boundary">
        未连接邮箱、日历或真实学生数据；所有学校、账号、金额与通知均为合成内容。
      </p>
    </section>
  );
}
