import type { NextRequest } from "next/server";
import { openInExplorer } from "@/lib/fs-explorer";

// Reveal a path in Windows Explorer.
export async function POST(req: NextRequest) {
  let body: { path?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.path) return Response.json({ error: "missing path" }, { status: 400 });
  try {
    await openInExplorer(body.path);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
