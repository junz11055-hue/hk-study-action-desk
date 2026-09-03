import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { mockActionCardRepository } from "../../../features/action-center";
import { isReferenceWorkspaceView } from "../../../features/action-center/model/workspace-view";
import { ReferenceWorkspace } from "../../../features/action-center/ui/reference-workspace";
import { demoSessionState } from "../../../features/invite-access/server/demo-session";
import { isHostedDemoMode } from "../../../features/invite-access/server/demo-mode";

type ReferencePageProps = Readonly<{
  params: Promise<{ view: string }>;
}>;

const viewTitles = {
  managed: "已管理",
  guides: "香港指南",
  settings: "设置",
} as const;

export async function generateMetadata({
  params,
}: ReferencePageProps): Promise<Metadata> {
  const { view } = await params;
  return {
    title: isReferenceWorkspaceView(view) ? viewTitles[view] : "页面未找到",
  };
}

export default async function ReferencePage({ params }: ReferencePageProps) {
  const hostedDemo = isHostedDemoMode();
  if (!hostedDemo) {
    const sessionState = await demoSessionState();
    if (sessionState !== "valid") {
      redirect(
        sessionState === "invalid" ? "/invite?reason=session-ended" : "/invite",
      );
    }
  }

  const [{ view }, cards] = await Promise.all([
    params,
    mockActionCardRepository.list(),
  ]);
  if (!isReferenceWorkspaceView(view)) notFound();

  return <ReferenceWorkspace cards={cards} hostedDemo={hostedDemo} view={view} />;
}
