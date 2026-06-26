import type { NextRequest } from "next/server";
import { getProjectDetail } from "@/lib/projects";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams.get("path");
  if (!p) return Response.json({ error: "missing path" }, { status: 400 });
  try {
    return Response.json(await getProjectDetail(p));
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
