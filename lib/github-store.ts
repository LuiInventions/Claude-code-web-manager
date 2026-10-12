import path from "node:path";
import { readJson, writeJson } from "./store";
import type { GithubRepo, GithubUser } from "./github";

const FILE = "github.json";

export type CloneStatus = "pending" | "cloning" | "cloned" | "error";

export interface StoredRepo extends GithubRepo {
  cloneStatus: CloneStatus;
  localPath: string;
  /**
   * Transient (never persisted): whether the local clone has changes to commit
   * or unpushed commits. Computed on the fly by `GET /api/github`.
   */
  pendingPush?: boolean;
  /**
   * Transient. Uncommitted files in the clone (modified, deleted, and new).
   * Empty when the only pending work is commits already ahead of origin.
   */
  pendingFiles?: { path: string; status: string }[];
}

export interface GithubState {
  connected: boolean;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
  repos: StoredRepo[];
}

export const EMPTY_STATE: GithubState = {
  connected: false,
  login: null,
  name: null,
  avatarUrl: null,
  repos: [],
};

/** Pure: return a copy of repos with one repo's cloneStatus changed. */
export function setRepoStatus(
  repos: StoredRepo[],
  fullName: string,
  status: CloneStatus,
): StoredRepo[] {
  return repos.map((r) =>
    r.fullName === fullName ? { ...r, cloneStatus: status } : r,
  );
}

/** Pure: return a copy of repos with one repo's `private` flag changed. */
export function setRepoPrivate(
  repos: StoredRepo[],
  fullName: string,
  isPrivate: boolean,
): StoredRepo[] {
  return repos.map((r) =>
    r.fullName === fullName ? { ...r, private: isPrivate } : r,
  );
}

/**
 * Pure: insert `repo` (newest-first) or replace the existing entry with the
 * same fullName. Used when a repo is freshly created from a local folder.
 */
export function addOrReplaceRepo(
  repos: StoredRepo[],
  repo: StoredRepo,
): StoredRepo[] {
  return repos.some((r) => r.fullName === repo.fullName)
    ? repos.map((r) => (r.fullName === repo.fullName ? repo : r))
    : [repo, ...repos];
}

export function readGithubState(): GithubState {
  return readJson<GithubState>(FILE, EMPTY_STATE);
}

export function writeGithubState(s: GithubState): void {
  writeJson(FILE, s);
}

export function setConnection(user: GithubUser, repos: StoredRepo[]): void {
  writeGithubState({
    connected: true,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
    repos,
  });
}

export function markRepoStatus(fullName: string, status: CloneStatus): void {
  const s = readGithubState();
  writeGithubState({ ...s, repos: setRepoStatus(s.repos, fullName, status) });
}

export function markRepoPrivate(fullName: string, isPrivate: boolean): void {
  const s = readGithubState();
  writeGithubState({ ...s, repos: setRepoPrivate(s.repos, fullName, isPrivate) });
}

/** Insert a freshly created repo (or replace an existing one) in the store. */
export function upsertRepo(repo: StoredRepo): void {
  const s = readGithubState();
  writeGithubState({ ...s, repos: addOrReplaceRepo(s.repos, repo) });
}

export function clearGithubState(): void {
  writeGithubState(EMPTY_STATE);
}

/** Resolve a known repo's local clone path by its `owner/name`, or null. */
export function findRepoPath(repos: StoredRepo[], fullName: string): string | null {
  return repos.find((r) => r.fullName === fullName)?.localPath ?? null;
}

/**
 * Directory that holds the cloned repos. Paths are the clone folders themselves.
 * The parent that contains the most of them wins, so a stale path does not
 * send Explorer to the projects folder.
 */
export function cloneContainer(localPaths: string[]): string | null {
  const counts = new Map<string, { path: string; n: number }>();
  for (const raw of localPaths) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const parent = path.dirname(path.resolve(trimmed));
    const key = process.platform === "win32" ? parent.toLowerCase() : parent;
    const cur = counts.get(key);
    if (cur) cur.n += 1;
    else counts.set(key, { path: parent, n: 1 });
  }
  let best: { path: string; n: number } | null = null;
  for (const item of counts.values()) {
    if (!best || item.n > best.n) best = item;
  }
  return best?.path ?? null;
}
