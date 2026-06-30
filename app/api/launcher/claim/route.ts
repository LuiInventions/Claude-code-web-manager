import type { NextRequest } from "next/server";
import { claimFromPool } from "@/lib/server/claude-pty";

export const dynamic = "force-dynamic";

/**
 * Claim a warm session when the user opens one. Given the selected folder (+
 * model/effort) and the task, this hands the user a pre-booted Claude from the
 * pool (instant) and returns its id so the client attaches to it; the prompt is
 * injected server-side once Claude is ready. Returns `{ id: null }` when no warm
 * session is available — the client then opens a fresh session the normal way.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const cwd = typeof body.cwd === "string" ? body.cwd : "";
  if (!cwd) return Response.json({ id: null });
  const startedAt = Number(body.startedAt);
  const id = claimFromPool({
    cwd,
    model: typeof body.model === "string" ? body.model : "",
    effort: typeof body.effort === "string" ? body.effort : "",
    prompt: typeof body.prompt === "string" ? body.prompt : "",
    projectName: typeof body.projectName === "string" ? body.projectName : "",
    batchId: typeof body.batchId === "string" ? body.batchId : "",
    startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : Date.now(),
    origin: body.origin === "github" ? "github" : undefined,
    repoFullName: typeof body.repoFullName === "string" ? body.repoFullName : undefined,
  });
  return Response.json({ id });
}
