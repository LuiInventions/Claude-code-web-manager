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
import { gitClone, gitPull } from "@/lib/git";
import { getConfig } from "@/lib/config";

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

  // Merge with what we already have so clone status / local paths survive.
  const prev = readGithubState();
  const byName = new Map(prev.repos.map((r) => [r.fullName, r]));
  const merged: StoredRepo[] = repos.map((r) => {
    const existing = byName.get(r.fullName);
    return {
      ...r,
      cloneStatus: existing?.cloneStatus ?? "pending",
      localPath: existing?.localPath ?? path.join(githubDir, r.name),
    };
  });

  setConnection(user, merged);

  // Sync to latest in the background; never block the response on it.
  void syncAll(merged, token);

  return Response.json(readGithubState());
}

async function syncAll(repos: StoredRepo[], token: string): Promise<void> {
  let i = 0;
  const worker = async () => {
    while (i < repos.length) {
      const repo = repos[i++];
      let cloned = false;
      try {
        await fs.access(path.join(repo.localPath, ".git"));
        cloned = true;
      } catch {
        /* not cloned yet */
      }
      if (cloned) {
        // Already present → fast-forward to latest (silent; stays "cloned").
        await gitPull(repo.localPath, token);
        markRepoStatus(repo.fullName, "cloned");
      } else {
        markRepoStatus(repo.fullName, "cloning");
        const ok = await gitClone(repo.cloneUrl, repo.localPath, token);
        markRepoStatus(repo.fullName, ok ? "cloned" : "error");
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SYNC_CONCURRENCY, repos.length) || 1 }, worker),
  );
}
