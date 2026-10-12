import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { gitHasPendingPush } from "./git";
import type { StoredRepo } from "./github-store";

/**
 * Move clones into `<program>/github_repos/<name>` and point `localPath` there.
 * A folder a live session is still using stays put, so the Repos tab keeps
 * pushing the files that session is editing. A clean copy already at the
 * destination is replaced when the old folder has local changes.
 */
export async function placeClones(
  repos: StoredRepo[],
  githubDir: string,
  busyCwds: string[],
): Promise<{ repos: StoredRepo[]; changed: boolean }> {
  if (repos.length === 0) return { repos, changed: false };
  await fs.mkdir(githubDir, { recursive: true });
  let changed = false;
  const next: StoredRepo[] = [];
  for (const repo of repos) {
    const dest = path.join(githubDir, repo.name);
    const src = (repo.localPath || "").trim();
    if (!src || samePath(src, dest)) {
      if (repo.localPath !== dest) {
        next.push({ ...repo, localPath: dest });
        changed = true;
      } else {
        next.push(repo);
      }
      continue;
    }
    if (isBusy(src, busyCwds)) {
      next.push(repo);
      continue;
    }
    const srcGit = existsSync(path.join(src, ".git"));
    const destGit = existsSync(path.join(dest, ".git"));
    if (srcGit && destGit) {
      const srcDirty = await gitHasPendingPush(src);
      const destDirty = await gitHasPendingPush(dest);
      if (srcDirty && !destDirty) {
        const aside = `${dest}.moving`;
        try {
          await fs.rename(dest, aside);
          await fs.rename(src, dest);
          await fs.rm(aside, { recursive: true, force: true });
          next.push({ ...repo, localPath: dest, cloneStatus: "cloned" });
          changed = true;
        } catch {
          await fs.rename(aside, dest).catch(() => {});
          if (existsSync(path.join(dest, ".git")) && !existsSync(path.join(src, ".git"))) {
            next.push({ ...repo, localPath: dest, cloneStatus: "cloned" });
            changed = true;
          } else {
            next.push(repo);
          }
        }
        continue;
      }
      if (!srcDirty) {
        next.push({ ...repo, localPath: dest, cloneStatus: "cloned" });
        if (!samePath(repo.localPath, dest)) changed = true;
        continue;
      }
      // Both folders have unpushed work. Keep the one the session already uses.
      next.push(repo);
      continue;
    }
    if (srcGit && !destGit) {
      try {
        await fs.rename(src, dest);
        next.push({ ...repo, localPath: dest, cloneStatus: "cloned" });
        changed = true;
      } catch {
        if (existsSync(path.join(dest, ".git"))) {
          next.push({ ...repo, localPath: dest, cloneStatus: "cloned" });
          changed = true;
        } else {
          next.push(repo);
        }
      }
      continue;
    }
    const status = destGit
      ? "cloned"
      : repo.cloneStatus === "cloned"
        ? "pending"
        : repo.cloneStatus;
    next.push({ ...repo, localPath: dest, cloneStatus: status });
    if (repo.localPath !== dest || repo.cloneStatus !== status) changed = true;
  }
  return { repos: next, changed };
}

let tail: Promise<unknown> = Promise.resolve();

/** One move at a time. Overlapping polls must not rename the same folder twice. */
export function withCloneLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function isBusy(dir: string, busyCwds: string[]): boolean {
  const root = path.resolve(dir);
  return busyCwds.some((cwd) => {
    if (!cwd.trim()) return false;
    const at = path.resolve(cwd);
    return inside(root, at);
  });
}

function inside(parent: string, child: string): boolean {
  const p = process.platform === "win32" ? parent.toLowerCase() : parent;
  const c = process.platform === "win32" ? child.toLowerCase() : child;
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}
