import {
  CalendarX2,
  Check,
  Inbox,
  KeyRound,
  MailX,
  Route,
  ShieldCheck,
} from "lucide-react";
import { InviteForm } from "./invite-form";
import styles from "./invite-access.module.css";

type InviteAccessScreenProps = Readonly<{
  error?: string;
  notice?: string;
}>;

const journey = [
  {
    label: "邀请码",
    detail: "验证本机体验入口",
    icon: KeyRound,
    state: "current",
  },
  {
    label: "合成演示",
    detail: "查看四封合成通知",
    icon: Inbox,
    state: "next",
  },
  {
    label: "行动中心",
    detail: "判断是否要做与何时做",
    icon: Check,
    state: "next",
  },
] as const;

export function InviteAccessScreen({
  error,
  notice,
}: InviteAccessScreenProps) {
  return (
    <main className={styles.page}>
      <div className={styles.frame}>
        <section className={styles.story} aria-labelledby="invite-story-title">
          <div className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">
              <Route size={22} />
            </span>
            <span>
              <strong>留港行动台</strong>
              <small>AI 留学管家</small>
            </span>
          </div>

          <div className={styles.storyCopy}>
            <p className={styles.eyebrow}>给来港读研的你</p>
            <h1 id="invite-story-title">
              先把学校邮件，
              <span>变成今天的下一步。</span>
            </h1>
            <p className={styles.lead}>
              这次只用四封完全合成的学校通知，体验 AI 如何梳理相关性、行动与截止时间。
            </p>
          </div>

          <ol className={styles.journey} aria-label="本地演示流程">
            {journey.map((step, index) => {
              const Icon = step.icon;
              return (
                <li
                  aria-current={step.state === "current" ? "step" : undefined}
                  data-state={step.state}
                  key={step.label}
                >
                  <span className={styles.journeyNode} aria-hidden="true">
                    <Icon size={16} />
                  </span>
                  {index < journey.length - 1 ? (
                    <span className={styles.journeyConnector} aria-hidden="true" />
                  ) : null}
                  <span className={styles.journeyCopy}>
                    <strong>{step.label}</strong>
                    <small>{step.detail}</small>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>

        <section className={styles.gate} aria-labelledby="invite-gate-title">
          <div className={styles.gateHeader}>
            <span className={styles.gateIcon} aria-hidden="true">
              <ShieldCheck size={21} />
            </span>
            <div>
              <p>本地体验入口</p>
              <h2 id="invite-gate-title">输入邀请码，进入合成演示</h2>
            </div>
          </div>

          {notice !== undefined ? (
            <p className={styles.notice} role="status">
              <Check aria-hidden="true" size={17} />
              {notice}
            </p>
          ) : null}

          <InviteForm {...(error === undefined ? {} : { initialError: error })} />

          <div className={styles.boundary} role="note">
            <h3>这次体验不会碰什么</h3>
            <ul>
              <li>
                <MailX aria-hidden="true" size={17} />
                未接 Outlook、Gmail 或真实邮件
              </li>
              <li>
                <CalendarX2 aria-hidden="true" size={17} />
                未接或写入任何真实日历
              </li>
              <li>
                <Route aria-hidden="true" size={17} />
                未调用模型、未部署、没有公开地址
              </li>
            </ul>
          </div>

          <p className={styles.disclaimer}>
            邀请码仅控制本机演示入口，不创建账户、不验证身份，也不能用于恢复会话。
          </p>
        </section>
      </div>
    </main>
  );
}
