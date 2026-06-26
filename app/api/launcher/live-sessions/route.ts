import type { NextRequest } from "next/server";
import { listPtySessions, killPtySession } from "@/lib/server/claude-pty";

export const dynamic = "force-dynamic";

// Live interactive PTY sessions (survive page refresh until the PC shuts down).
export async function GET() {
  return Response.json({ sessions: listPtySessions() });
}

// Explicit stop — the only thing that actually kills a running session.
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "missing id" }, { status: 400 });
  const killed = killPtySession(id);
  return Response.json({ ok: killed });
}
