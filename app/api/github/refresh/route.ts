import path from "node:path";
import fs from "node:fs/promises";
import { validateToken, listRepos } from "@/lib/github";
import { readGithubToken } from "@/lib/github-secret";
import {
  setConnection,
  markRepoStatus,
  readGithubState,
  type StoredRepo,
} from "@/lib/github-store";
import { existsSync } from "node:fs";
import { gitPull } from "@/lib/git";
import { getConfig } from "@/lib/config";
import { placeClones, withCloneLock } from "@/lib/github-place";
import { listPtySessions } from "@/lib/server/claude-pty";
import { scheduleMissingClone } from "@/lib/server/github-restore";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SYNC_CONCURRENCY = 4;

/**
 * Refresh: re-list repos from the GitHub API (picks up new/renamed repos and
 * fresh metadata), then bring every repo to the latest remote state in the
 * background — fast-forward pull for already-cloned repos, clone for new ones.
 * Requires an existing connection (reuses the stored token).
 */
export async function POST() {
  const token = readGithubToken();
  if (!token) {
    return Response.json({ error: "Nicht mit GitHub verbunden." }, { status: 400 });
  }

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

  // Move clones into github_repos first, then keep a folder a live session is
  // still using. New repos clone straight into github_repos.
  const prev = readGithubState();
  const busy = listPtySessions()
    .map((s) => s.cwd)
    .filter((cwd): cwd is string => Boolean(cwd));
  const placed = await withCloneLock(() => placeClones(prev.repos, githubDir, busy));
  const byName = new Map(placed.repos.map((r) => [r.fullName, r]));
  const merged: StoredRepo[] = repos.map((r) => {
    const existing = byName.get(r.fullName);
    const dest = path.join(githubDir, r.name);
    const kept =
      existing && existsSync(path.join(existing.localPath, ".git"))
        ? existing.localPath
        : dest;
    const hasGit = existsSync(path.join(kept, ".git"));
    return {
      ...r,
      cloneStatus: hasGit ? "cloned" : "pending",
      localPath: kept,
    };
  });

  setConnection(user, merged);

  const present: StoredRepo[] = [];
  for (const repo of merged) {
    if (existsSync(path.join(repo.localPath, ".git"))) present.push(repo);
    else scheduleMissingClone(repo, token);
  }

  // Fast-forward clones that are already on disk. Missing ones clone above.
  // Never block the response on the pull.
  void pullAll(present, token);

  return Response.json(readGithubState());
}

async function pullAll(repos: StoredRepo[], token: string): Promise<void> {
  let i = 0;
  const worker = async () => {
    while (i < repos.length) {
      const repo = repos[i++];
      await gitPull(repo.localPath, token);
      markRepoStatus(repo.fullName, "cloned");
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SYNC_CONCURRENCY, repos.length) || 1 }, worker),
  );
}
