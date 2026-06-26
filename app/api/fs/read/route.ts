import type { NextRequest } from "next/server";
import { readPathPreview } from "@/lib/fs-explorer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Read-only preview: file content, or a folder's README / AI summary.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams.get("path");
  if (!p) return Response.json({ error: "missing path" }, { status: 400 });
  try {
    return Response.json(await readPathPreview(p));
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
