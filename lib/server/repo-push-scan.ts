import path from "node:path";
import fs from "node:fs/promises";
import { readGithubState } from "../github-store";
import { gitStatus, gitChangedFiles, gitLastCommitTime } from "../git";
import type { PushEntry } from "../repo-push-store";

const SCAN_CONCURRENCY = 4;

/**
 * Best estimate of WHEN the local work was done: the newest mtime among the
 * changed working-tree files, and (when the branch is ahead) the last commit
 * time. Falls back to `fallback` if nothing can be read (e.g. all changes are
 * deletes/renames). Epoch ms.
 */
async function changeTime(
  repoPath: string,
  changedFiles: string[],
  ahead: number,
  fallback: number,
): Promise<number> {
  let newest = 0;
  for (const rel of changedFiles) {
    try {
      const st = await fs.stat(path.join(repoPath, rel));
      if (st.mtimeMs > newest) newest = st.mtimeMs;
    } catch {
      /* deleted/renamed path — skip */
    }
  }
  if (ahead > 0) {
    const commit = await gitLastCommitTime(repoPath);
    if (commit && commit > newest) newest = commit;
  }
  return newest || fallback;
}

/**
 * Scan every cloned GitHub repo for local work that isn't on the remote yet —
 * a dirty working tree (Claude's uncommitted edits) or commits ahead of the
 * upstream. Each match becomes a "pending" push candidate. This is the reliable
 * source of truth for the Repo Push tab: unlike the session-exit enqueue, it
 * does not depend on a process event firing, so edited repos always surface —
 * even after a server restart or while the Claude session is still open.
 */
export async function scanPushableRepos(addedAt: number): Promise<PushEntry[]> {
  const repos = readGithubState().repos.filter(
    (r) => r.cloneStatus === "cloned" && r.localPath,
  );

  const found: PushEntry[] = [];
  let i = 0;
  const worker = async () => {
    while (i < repos.length) {
      const repo = repos[i++];
      const status = await gitStatus(repo.localPath);
      if (!status.dirty && status.ahead <= 0) continue;
      const changedFiles = await gitChangedFiles(repo.localPath);
      const changedAt = await changeTime(
        repo.localPath,
        changedFiles,
        status.ahead,
        addedAt,
      );
      found.push({
        repoPath: repo.localPath,
        repoName: repo.name,
        reason: "scan",
        changedFiles,
        ahead: status.ahead,
        status: "pending",
        addedAt,
        changedAt,
      });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(SCAN_CONCURRENCY, repos.length) || 1 }, worker),
  );
  return found;
}
