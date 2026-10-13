import type { NextRequest } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { getConfig } from "@/lib/config";
import { createRepo } from "@/lib/github";
import { readGithubToken } from "@/lib/github-secret";
import { newCloneDir } from "@/lib/github-place";
import { upsertRepo, readGithubState, type StoredRepo } from "@/lib/github-store";
import { gitPublishFolder } from "@/lib/git";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Create a new GitHub repo in the clones directory. The folder is always
 * `<githubDir>/<name>` — the client cannot pick another path. Then init,
 * commit, and push that folder.
 */
export async function POST(req: NextRequest) {
  let body: { name?: string; private?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const token = readGithubToken();
  if (!token) return Response.json({ error: "Nicht mit GitHub verbunden." }, { status: 400 });

  const name = (body.name ?? "").trim();
  const folderPath = newCloneDir(getConfig().githubDir, name);
  if (!folderPath) return Response.json({ error: "Repo-Name ungültig." }, { status: 400 });

  try {
    const st = await fs.stat(folderPath);
    if (!st.isDirectory())
      return Response.json({ error: "Pfad ist kein Ordner." }, { status: 400 });
    try {
      await fs.access(path.join(folderPath, ".git"));
      return Response.json({ error: "In diesem Ordner liegt schon ein Repo." }, { status: 400 });
    } catch {
      /* empty or not a checkout yet — publish it */
    }
  } catch {
    await fs.mkdir(folderPath, { recursive: true });
  }

  const isPrivate = body.private !== false; // default to private

  let repo;
  try {
    repo = await createRepo(token, name, isPrivate);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }

  const published = await gitPublishFolder(
    folderPath,
    repo.cloneUrl,
    token,
    repo.defaultBranch,
  );

  const stored: StoredRepo = {
    ...repo,
    cloneStatus: published.ok ? "cloned" : "error",
    localPath: folderPath,
  };
  upsertRepo(stored);

  if (!published.ok) {
    // Repo exists on GitHub but the local push failed — surface why.
    return Response.json(
      {
        error: `Repo erstellt, aber Push fehlgeschlagen: ${published.message}`,
        state: readGithubState(),
      },
      { status: 207 },
    );
  }

  return Response.json(readGithubState());
}
