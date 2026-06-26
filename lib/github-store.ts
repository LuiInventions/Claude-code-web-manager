import { readJson, writeJson } from "./store";
import type { GithubRepo, GithubUser } from "./github";

const FILE = "github.json";

export type CloneStatus = "pending" | "cloning" | "cloned" | "error";

export interface StoredRepo extends GithubRepo {
  cloneStatus: CloneStatus;
  localPath: string;
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
