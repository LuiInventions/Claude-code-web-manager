import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { gitHasPendingPush } from "./git";
import type { StoredRepo } from "./github-store";

/**
 * Point each clone at `<github dir>/<name>`.
 * The packaged app keeps that directory outside the install folder: the
 * installer deletes the program folder on upgrade and used to take the clones
 * with it. A folder a live session is still using stays put. A clone whose
 * directory is gone is marked pending (`wiped`) so the GitHub tab does not
 * browse a missing path. The caller clones those again.
 */
export async function placeClones(
  repos: StoredRepo[],
  githubDir: string,
  busyCwds: string[],
): Promise<{ repos: StoredRepo[]; changed: boolean; wiped: string[] }> {
  if (repos.length === 0) return { repos, changed: false, wiped: [] };
  await fs.mkdir(githubDir, { recursive: true });
  let changed = false;
  const wiped: string[] = [];
  const next: StoredRepo[] = [];
  for (const repo of repos) {
    const dest = path.join(githubDir, repo.name);
    const src = (repo.localPath || "").trim();
    if (!src || samePath(src, dest)) {
      // The stored path is already the destination, but the installer removed
      // the directory. Leave it pending instead of "cloned".
      if (repo.cloneStatus === "cloned" && !existsSync(dest)) {
        next.push({ ...repo, localPath: dest, cloneStatus: "pending" });
        changed = true;
        wiped.push(repo.fullName);
        continue;
      }
      if (repo.localPath !== dest) {
        next.push({ ...repo, localPath: dest });
        changed = true;
      } else {
        next.push(repo);
      }
      continue;
    }
    // A live session keeps a folder that is still on disk. A deleted folder
    // has nothing to keep, so fall through and restore it.
    if (isBusy(src, busyCwds) && existsSync(src)) {
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
    if (repo.cloneStatus === "cloned" && status === "pending" && !existsSync(dest)) {
      wiped.push(repo.fullName);
    }
  }
  return { repos: next, changed, wiped };
}

/**
 * Repos whose directory is gone and that are waiting on a clone.
 * `cloned` is never returned: placeClones turns a missing clone into
 * `pending` first. `error` stays put so a failed clone is not retried on
 * every poll. Folders that still exist are left untouched.
 */
export function reposMissingOnDisk(
  repos: StoredRepo[],
  inFlight: ReadonlySet<string>,
  exists: (target: string) => boolean = existsSync,
): StoredRepo[] {
  return repos.filter((repo) => {
    if (!repo.fullName || !repo.cloneUrl || !repo.localPath) return false;
    if (repo.cloneStatus !== "pending" && repo.cloneStatus !== "cloning") return false;
    if (inFlight.has(repo.fullName)) return false;
    if (exists(repo.localPath) || exists(path.join(repo.localPath, ".git"))) return false;
    return true;
  });
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

/** A single folder name under the clones directory. Slashes and ".." cannot pass. */
const REPO_DIR_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * Where a repo created in the app is stored: always `<githubDir>/<name>`.
 * Null when the name is empty or would leave that directory.
 */
export function newCloneDir(githubDir: string, name: string): string | null {
  const trimmed = name.trim();
  if (!REPO_DIR_NAME.test(trimmed)) return null;
  const root = path.resolve(githubDir);
  const dest = path.resolve(root, trimmed);
  if (samePath(dest, root) || !samePath(path.dirname(dest), root)) return null;
  return dest;
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
