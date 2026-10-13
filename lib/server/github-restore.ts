import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { gitClone } from "../git";
import { markRepoStatus, type StoredRepo } from "../github-store";

const MAX = 4;
const queued = new Set<string>();
const running = new Set<string>();
const queue: { repo: StoredRepo; token: string }[] = [];
let active = 0;

/** Names already queued or cloning in this process. */
export function inFlightCloneNames(): Set<string> {
  return new Set([...queued, ...running]);
}

/**
 * Clone a repo whose folder is missing. Concurrent clones stay at 4.
 * A second call for the same repo does nothing while the first is in flight.
 * A folder that already contains files and no `.git` is left alone.
 */
export function scheduleMissingClone(repo: StoredRepo, token: string): void {
  const fullName = repo.fullName;
  if (!token.trim() || !repo.cloneUrl || !repo.localPath || !fullName) return;
  if (queued.has(fullName) || running.has(fullName)) return;
  if (existsSync(path.join(repo.localPath, ".git"))) {
    markRepoStatus(fullName, "cloned");
    return;
  }
  queued.add(fullName);
  markRepoStatus(fullName, "cloning");
  queue.push({ repo, token });
  pump();
}

function pump(): void {
  while (active < MAX && queue.length > 0) {
    const job = queue.shift();
    if (!job) return;
    queued.delete(job.repo.fullName);
    running.add(job.repo.fullName);
    active++;
    void runJob(job).finally(() => {
      running.delete(job.repo.fullName);
      active--;
      pump();
    });
  }
}

async function runJob(job: { repo: StoredRepo; token: string }): Promise<void> {
  const dest = job.repo.localPath;
  try {
    if (existsSync(path.join(dest, ".git"))) {
      markRepoStatus(job.repo.fullName, "cloned");
      return;
    }
    if (existsSync(dest)) {
      const names = await fs.readdir(dest);
      if (names.length > 0) {
        markRepoStatus(job.repo.fullName, "error");
        return;
      }
      await fs.rmdir(dest);
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const ok = await gitClone(job.repo.cloneUrl, dest, job.token);
    markRepoStatus(job.repo.fullName, ok ? "cloned" : "error");
  } catch {
    markRepoStatus(job.repo.fullName, "error");
  }
}
