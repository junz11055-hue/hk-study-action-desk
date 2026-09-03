import type { NextRequest } from "next/server";
import { handleSyntheticAnalysisGet } from "../../../../../../features/action-center/server/synthetic-analysis-bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = Readonly<{
  params: Promise<{ taskId: string }>;
}>;

export async function GET(request: NextRequest, context: RouteContext) {
  const { taskId } = await context.params;
  return handleSyntheticAnalysisGet(request, taskId);
}
