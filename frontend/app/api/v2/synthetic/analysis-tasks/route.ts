import type { NextRequest } from "next/server";
import { handleSyntheticAnalysisPost } from "../../../../../features/action-center/server/synthetic-analysis-bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: NextRequest) {
  return handleSyntheticAnalysisPost(request);
}
