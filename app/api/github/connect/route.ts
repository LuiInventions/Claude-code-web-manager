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
import { gitClone } from "@/lib/git";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CLONE_CONCURRENCY = 4;

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

  const stored: StoredRepo[] = repos.map((r) => ({
    ...r,
    cloneStatus: "pending",
    localPath: path.join(githubDir, r.name),
  }));

  writeGithubToken(token);
  setConnection(user, stored);

  // Clone all repos in the background; never block the response on it.
  void cloneAll(stored, token);

  return Response.json(readGithubState());
}

async function cloneAll(repos: StoredRepo[], token: string): Promise<void> {
  let i = 0;
  const worker = async () => {
    while (i < repos.length) {
      const repo = repos[i++];
      let exists = false;
      try {
        await fs.access(path.join(repo.localPath, ".git"));
        exists = true;
      } catch {
        /* not cloned yet */
      }
      if (exists) {
        markRepoStatus(repo.fullName, "cloned");
        continue;
      }
      markRepoStatus(repo.fullName, "cloning");
      const ok = await gitClone(repo.cloneUrl, repo.localPath, token);
      markRepoStatus(repo.fullName, ok ? "cloned" : "error");
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CLONE_CONCURRENCY, repos.length) || 1 }, worker),
  );
}
