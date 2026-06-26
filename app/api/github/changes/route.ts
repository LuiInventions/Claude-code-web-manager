import type { NextRequest } from "next/server";
import { readGithubState, findRepoPath } from "@/lib/github-store";
import { gitPushPreview } from "@/lib/git";

export const dynamic = "force-dynamic";

/**
 * Preview for the GitHub tab's Update button: returns the files that would be
 * pushed (uncommitted changes + already-committed-but-unpushed files) so the
 * user can confirm before anything is committed or pushed. Read-only.
 */
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

  const { branch, files } = await gitPushPreview(localPath);
  return Response.json({ ok: true, branch, files });
}
