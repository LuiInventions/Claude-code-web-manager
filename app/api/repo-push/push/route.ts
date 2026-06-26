import type { NextRequest } from "next/server";
import { gitStatus, gitCommitAll, gitPush } from "@/lib/git";
import { readGithubToken } from "@/lib/github-secret";
import { setPushStatus, removePush } from "@/lib/repo-push-store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let body: { repoPath?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const repoPath = (body.repoPath ?? "").trim();
  const message = (body.message ?? "").trim() || "Update via Jarvis Control Center";
  if (!repoPath) return Response.json({ error: "repoPath fehlt." }, { status: 400 });

  const token = readGithubToken();
  if (!token)
    return Response.json({ error: "Nicht mit GitHub verbunden." }, { status: 400 });

  setPushStatus(repoPath, "pushing");
  try {
    const status = await gitStatus(repoPath);
    if (status.dirty) {
      const committed = await gitCommitAll(repoPath, message);
      if (!committed) {
        setPushStatus(repoPath, "error", "Commit fehlgeschlagen.");
        return Response.json({ error: "Commit fehlgeschlagen." }, { status: 400 });
      }
    }
    const res = await gitPush(repoPath, token);
    if (!res.ok) {
      setPushStatus(repoPath, "error", res.message);
      return Response.json({ error: res.message }, { status: 400 });
    }
    removePush(repoPath);
    return Response.json({ ok: true, message: res.message });
  } catch (e) {
    setPushStatus(repoPath, "error", (e as Error).message);
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
