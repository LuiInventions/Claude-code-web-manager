import type { NextRequest } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { validateToken, listRepos } from "@/lib/github";
import { writeGithubToken } from "@/lib/github-secret";
import {
  setConnection,
  markRepoStatus,
  readGithubState,
  type StoredRepo,
} from "@/lib/github-store";
import { existsSync } from "node:fs";
import { getConfig } from "@/lib/config";
import { placeClones, withCloneLock } from "@/lib/github-place";
import { listPtySessions } from "@/lib/server/claude-pty";
import { scheduleMissingClone } from "@/lib/server/github-restore";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const token = (body.token ?? "").trim();
  if (!token) return Response.json({ error: "Token fehlt." }, { status: 400 });

  let user;
  let repos;
  try {
    user = await validateToken(token);
    repos = await listRepos(token);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }

  const githubDir = getConfig().githubDir;
  await fs.mkdir(githubDir, { recursive: true });

  const prev = readGithubState();
  const busy = listPtySessions()
    .map((s) => s.cwd)
    .filter((cwd): cwd is string => Boolean(cwd));
  const placed = await withCloneLock(() => placeClones(prev.repos, githubDir, busy));
  const byName = new Map(placed.repos.map((r) => [r.fullName, r]));
  const stored: StoredRepo[] = repos.map((r) => {
    const old = byName.get(r.fullName);
    const dest = path.join(githubDir, r.name);
    const kept = old && existsSync(path.join(old.localPath, ".git")) ? old.localPath : dest;
    const hasGit = existsSync(path.join(kept, ".git"));
    return {
      ...r,
      cloneStatus: hasGit ? "cloned" : "pending",
      localPath: kept,
    };
  });

  writeGithubToken(token);
  setConnection(user, stored);

  // Clone missing repos in the background; never block the response on it.
  for (const repo of stored) {
    if (existsSync(path.join(repo.localPath, ".git"))) {
      markRepoStatus(repo.fullName, "cloned");
    } else {
      scheduleMissingClone(repo, token);
    }
  }

  return Response.json(readGithubState());
}
