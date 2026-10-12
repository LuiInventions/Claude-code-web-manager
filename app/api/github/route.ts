import type { NextRequest } from "next/server";
import { readGithubState, writeGithubState, type StoredRepo } from "@/lib/github-store";
import { gitLocalSummary } from "@/lib/git";
import { getConfig } from "@/lib/config";
import { placeClones, withCloneLock } from "@/lib/github-place";
import { listPtySessions } from "@/lib/server/claude-pty";

export const dynamic = "force-dynamic";

function busyCwds(): string[] {
  return listPtySessions()
    .map((s) => s.cwd)
    .filter((cwd): cwd is string => Boolean(cwd));
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function GET(req: NextRequest) {
  const state = readGithubState();
  const placed = await withCloneLock(() =>
    placeClones(state.repos, getConfig().githubDir, busyCwds()),
  );
  const repos = placed.repos;
  if (placed.changed) writeGithubState({ ...state, repos });

  // The launcher dropdown only needs names and paths. Skip the per-repo git
  // status; that scan is what hitched the window while a session was open.
  const lite = new URL(req.url).searchParams.get("lite") === "1";
  if (lite || repos.length === 0) {
    return Response.json({ ...state, repos });
  }

  const annotated = await mapPool(repos, 2, async (repo: StoredRepo) => {
    if (repo.cloneStatus !== "cloned") {
      return { ...repo, pendingPush: false, pendingFiles: [] as StoredRepo["pendingFiles"] };
    }
    const summary = await gitLocalSummary(repo.localPath);
    return { ...repo, pendingPush: summary.pending, pendingFiles: summary.files };
  });
  return Response.json({ ...state, repos: annotated });
}
