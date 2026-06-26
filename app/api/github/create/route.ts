import type { NextRequest } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { createRepo } from "@/lib/github";
import { readGithubToken } from "@/lib/github-secret";
import { upsertRepo, readGithubState, type StoredRepo } from "@/lib/github-store";
import { gitPublishFolder } from "@/lib/git";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Create a new GitHub repo from a local folder: create it on GitHub (public or
 * private), then init/commit/push the chosen folder up to it. The folder's
 * basename is the default repo name unless one is supplied.
 */
export async function POST(req: NextRequest) {
  let body: { folderPath?: string; name?: string; private?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const folderPath = (body.folderPath ?? "").trim();
  if (!folderPath) return Response.json({ error: "Kein Ordner gewählt." }, { status: 400 });

  const token = readGithubToken();
  if (!token) return Response.json({ error: "Nicht mit GitHub verbunden." }, { status: 400 });

  // The chosen path must exist and be a directory.
  try {
    const st = await fs.stat(folderPath);
    if (!st.isDirectory())
      return Response.json({ error: "Pfad ist kein Ordner." }, { status: 400 });
  } catch {
    return Response.json({ error: "Ordner existiert nicht." }, { status: 400 });
  }

  const name = (body.name ?? "").trim() || path.basename(folderPath);
  if (!name) return Response.json({ error: "Repo-Name fehlt." }, { status: 400 });
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
