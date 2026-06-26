import type { NextRequest } from "next/server";
import { readGithubState, findRepoPath } from "@/lib/github-store";
import { readGithubToken } from "@/lib/github-secret";
import { gitSyncAndPush } from "@/lib/git";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let body: { fullName?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const fullName = (body.fullName ?? "").trim();
  if (!fullName) return Response.json({ error: "fullName fehlt." }, { status: 400 });

  const localPath = findRepoPath(readGithubState().repos, fullName);
  if (!localPath) return Response.json({ error: "Repo nicht gefunden." }, { status: 400 });

  const token = readGithubToken();
  if (!token)
    return Response.json({ error: "Nicht mit GitHub verbunden." }, { status: 400 });

  const res = await gitSyncAndPush(localPath, token, "Update via Control Center");
  if (!res.ok)
    return Response.json({ error: res.message, conflict: res.conflict }, { status: 400 });
  return Response.json({ ok: true, message: res.message });
}
