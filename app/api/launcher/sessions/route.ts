import type { NextRequest } from "next/server";
import {
  deleteLauncherSession,
  listLauncherSessions,
} from "@/lib/launcher-store";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ sessions: listLauncherSessions() });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "missing id" }, { status: 400 });
  deleteLauncherSession(id);
  return Response.json({ ok: true });
}
