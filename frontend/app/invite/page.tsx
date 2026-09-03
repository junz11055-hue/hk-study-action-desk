import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { demoSessionState } from "../../features/invite-access/server/demo-session";
import { isHostedDemoMode } from "../../features/invite-access/server/demo-mode";
import { InviteAccessScreen } from "../../features/invite-access/ui/invite-access-screen";

export const metadata: Metadata = {
  title: "邀请码",
  description: "使用本地演示邀请码进入完全合成的 AI 留学通知行动中心",
};

type InvitePageProps = Readonly<{
  searchParams: Promise<{
    reason?: string | string[];
  }>;
}>;

const invalidInviteMessage = "邀请码无效或暂不可用，请检查后重试。";

export default async function InvitePage({ searchParams }: InvitePageProps) {
  if (isHostedDemoMode()) {
    redirect("/workspace");
  }
  if ((await demoSessionState()) === "valid") {
    redirect("/workspace");
  }

  const query = await searchParams;
  const reason = Array.isArray(query.reason) ? query.reason[0] : query.reason;
  const error =
    reason === "invalid"
      ? invalidInviteMessage
      : reason === "session-ended"
        ? "演示会话已结束，请重新输入邀请码。"
        : undefined;
  const notice =
    reason === "logout" ? "已退出本地合成演示。" : undefined;

  return (
    <InviteAccessScreen
      {...(error === undefined ? {} : { error })}
      {...(notice === undefined ? {} : { notice })}
    />
  );
}
