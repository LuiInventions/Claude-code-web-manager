import type { NextRequest } from "next/server";
import { preloadPool } from "@/lib/server/claude-pty";

export const dynamic = "force-dynamic";

/**
 * Warm-pool preload. The Launcher calls this whenever the user picks a folder
 * (and model/effort) in the dropdown: it pre-spawns a small pool of `claude
 * --dangerously-skip-permissions` sessions for that folder so opening one is
 * instant. Pooled sessions stay hidden (no Sessions-office character) until they
 * are claimed by an actual open. Fire-and-forget — returns immediately.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const cwd = typeof body.cwd === "string" ? body.cwd : "";
  if (!cwd) return Response.json({ error: "missing cwd" }, { status: 400 });
  preloadPool({
    cwd,
    model: typeof body.model === "string" ? body.model : "",
    effort: typeof body.effort === "string" ? body.effort : "",
  });
  return Response.json({ ok: true });
}
