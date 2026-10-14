import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { getConfig } from "../../../config";
import { createRepo, listRepos, setRepoVisibility, validateToken } from "../../../github";
import { readGithubToken, writeGithubToken, clearGithubToken } from "../../../github-secret";
import { newCloneDir, placeClones, withCloneLock } from "../../../github-place";
import {
  clearGithubState,
  findRepoPath,
  markRepoPrivate,
  markRepoStatus,
  readGithubState,
  setConnection,
  upsertRepo,
  type StoredRepo,
} from "../../../github-store";
import { gitLocalSummary, gitPublishFolder, gitPull, gitPushPreview, gitSyncAndPush } from "../../../git";
import { listPtySessions } from "../../claude-pty";
import { scheduleMissingClone } from "../../github-restore";
import { enqueueUiCommand } from "../../ui-commands";
import { rememberRepo } from "../selection";
import { ActionError } from "../errors";

function requireToken(): string {
  const token = readGithubToken();
  if (!token) throw new ActionError("GitHub is not connected. Call github_connect with a personal access token.");
  return token;
}

function requireRepo(fullName: string): string {
  const name = fullName.trim();
  if (!name) throw new ActionError("fullName is required, for example owner/repo.");
  const localPath = findRepoPath(readGithubState().repos, name);
  if (!localPath) throw new ActionError(`Repo "${name}" is not in the Repos list. Call github_status.`);
  return localPath;
}

function compactRepo(repo: StoredRepo) {
  return {
    fullName: repo.fullName,
    name: repo.name,
    private: repo.private,
    description: repo.description,
    defaultBranch: repo.defaultBranch,
    cloneStatus: repo.cloneStatus,
    localPath: repo.localPath,
    updatedAt: repo.updatedAt,
    pendingPush: repo.pendingPush ?? null,
    pendingFiles: repo.pendingFiles ?? null,
  };
}

function busyCwds(): string[] {
  return listPtySessions()
    .map((s) => s.cwd)
    .filter((cwd): cwd is string => Boolean(cwd));
}

/** Connected account and every known repo. Does not scan git unless detail is true. */
export async function githubStatus(detail = false) {
  const state = readGithubState();
  const placed = await withCloneLock(() =>
    placeClones(state.repos, getConfig().githubDir, busyCwds()),
  );
  const repos = placed.repos;
  if (!detail) {
    return {
      connected: state.connected,
      login: state.login,
      name: state.name,
      githubDir: getConfig().githubDir,
      repos: repos.map((repo) => compactRepo(repo)),
    };
  }
  const annotated = [];
  for (const repo of repos) {
    if (repo.cloneStatus !== "cloned") {
      annotated.push(compactRepo({ ...repo, pendingPush: false, pendingFiles: [] }));
      continue;
    }
    const summary = await gitLocalSummary(repo.localPath);
    annotated.push(compactRepo({ ...repo, pendingPush: summary.pending, pendingFiles: summary.files }));
  }
  return {
    connected: state.connected,
    login: state.login,
    name: state.name,
    githubDir: getConfig().githubDir,
    repos: annotated,
  };
}

/** One repo: local git summary and the file list the Update button would push. */
export async function githubRepo(fullName: string) {
  const localPath = requireRepo(fullName);
  const repo = readGithubState().repos.find((row) => row.fullName === fullName.trim());
  const summary = await gitLocalSummary(localPath);
  const preview = await gitPushPreview(localPath);
  return {
    repo: repo ? compactRepo({ ...repo, pendingPush: summary.pending, pendingFiles: summary.files }) : null,
    branch: preview.branch,
    files: preview.files,
    localPath,
    hint: "github_update_repo commits these files with the message \"Update via Control Center\", then fetches, merges, and pushes. Pass confirm true only when this list is what should ship.",
  };
}

/**
 * Save a GitHub token, list repos, and clone any that are missing.
 * The token is stored and is not returned.
 */
export async function githubConnect(token: string) {
  const value = token.trim();
  if (!value) throw new ActionError("token is required.");
  let user;
  let repos;
  try {
    user = await validateToken(value);
    repos = await listRepos(value);
  } catch (err) {
    throw new ActionError(err instanceof Error ? err.message : String(err));
  }
  const githubDir = getConfig().githubDir;
  await fs.mkdir(githubDir, { recursive: true });
  const prev = readGithubState();
  const placed = await withCloneLock(() => placeClones(prev.repos, githubDir, busyCwds()));
  const byName = new Map(placed.repos.map((r) => [r.fullName, r]));
  const stored: StoredRepo[] = repos.map((r) => {
    const old = byName.get(r.fullName);
    const dest = path.join(githubDir, r.name);
    const kept = old && existsSync(path.join(old.localPath, ".git")) ? old.localPath : dest;
    const hasGit = existsSync(path.join(kept, ".git"));
    return { ...r, cloneStatus: hasGit ? "cloned" : "pending", localPath: kept };
  });
  writeGithubToken(value);
  setConnection(user, stored);
  for (const repo of stored) {
    if (existsSync(path.join(repo.localPath, ".git"))) markRepoStatus(repo.fullName, "cloned");
    else scheduleMissingClone(repo, value);
  }
  const state = readGithubState();
  return {
    connected: true,
    login: state.login,
    repos: state.repos.map((repo) => compactRepo(repo)),
    note: "Missing clones start in the background. Poll github_status until cloneStatus is cloned.",
  };
}

export function githubDisconnect() {
  clearGithubToken();
  clearGithubState();
  return { connected: false };
}

/** Re-list repos from GitHub and fast-forward clones that are already on disk. */
export async function githubRefresh() {
  const token = requireToken();
  let user;
  let repos;
  try {
    user = await validateToken(token);
    repos = await listRepos(token);
  } catch (err) {
    throw new ActionError(err instanceof Error ? err.message : String(err));
  }
  const githubDir = getConfig().githubDir;
  await fs.mkdir(githubDir, { recursive: true });
  const prev = readGithubState();
  const placed = await withCloneLock(() => placeClones(prev.repos, githubDir, busyCwds()));
  const byName = new Map(placed.repos.map((r) => [r.fullName, r]));
  const merged: StoredRepo[] = repos.map((r) => {
    const existing = byName.get(r.fullName);
    const dest = path.join(githubDir, r.name);
    const kept =
      existing && existsSync(path.join(existing.localPath, ".git")) ? existing.localPath : dest;
    const hasGit = existsSync(path.join(kept, ".git"));
    return { ...r, cloneStatus: hasGit ? "cloned" : "pending", localPath: kept };
  });
  setConnection(user, merged);
  const present: StoredRepo[] = [];
  for (const repo of merged) {
    if (existsSync(path.join(repo.localPath, ".git"))) present.push(repo);
    else scheduleMissingClone(repo, token);
  }
  void pullAll(present, token);
  const state = readGithubState();
  return {
    connected: state.connected,
    login: state.login,
    pulling: present.length,
    cloning: merged.length - present.length,
    repos: state.repos.map((repo) => compactRepo(repo)),
    note: "Pulls and clones continue after this returns. Poll github_status.",
  };
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
  const workers = Math.min(4, repos.length) || 0;
  await Promise.all(Array.from({ length: workers }, worker));
}

/**
 * Create `<githubDir>/<name>` on GitHub and push that folder.
 * The name must match [A-Za-z0-9][A-Za-z0-9._-]{0,99}. Private unless private is false.
 */
export async function githubCreateRepo(name: string, isPrivate: boolean) {
  const token = requireToken();
  const folderPath = newCloneDir(getConfig().githubDir, name.trim());
  if (!folderPath) throw new ActionError("Repo name is invalid.");
  try {
    const st = await fs.stat(folderPath);
    if (!st.isDirectory()) throw new ActionError("Path is not a folder.");
    try {
      await fs.access(path.join(folderPath, ".git"));
      throw new ActionError("That folder is already a git repo.");
    } catch (err) {
      if (err instanceof ActionError) throw err;
    }
  } catch (err) {
    if (err instanceof ActionError) throw err;
    await fs.mkdir(folderPath, { recursive: true });
  }
  let repo;
  try {
    repo = await createRepo(token, name.trim(), isPrivate);
  } catch (err) {
    throw new ActionError(err instanceof Error ? err.message : String(err));
  }
  const published = await gitPublishFolder(folderPath, repo.cloneUrl, token, repo.defaultBranch);
  const stored: StoredRepo = {
    ...repo,
    cloneStatus: published.ok ? "cloned" : "error",
    localPath: folderPath,
  };
  upsertRepo(stored);
  if (!published.ok) {
    throw new ActionError(`Repo created, but the push failed: ${published.message}`);
  }
  return { repo: compactRepo(stored), localPath: folderPath };
}

/**
 * Commit every local change with "Update via Control Center", then fetch, merge, and push.
 * `confirm` must be true. Call github_repo first and read the file list.
 */
export async function githubUpdateRepo(fullName: string, confirm: boolean) {
  if (confirm !== true) {
    throw new ActionError(
      "Refused. github_update_repo commits and pushes. Call github_repo, then call this again with confirm true.",
    );
  }
  const localPath = requireRepo(fullName);
  const token = requireToken();
  const res = await gitSyncAndPush(localPath, token, "Update via Control Center");
  if (!res.ok) throw new ActionError(res.conflict ? `${res.message} (conflict)` : res.message);
  return { fullName: fullName.trim(), ok: true, message: res.message, localPath };
}

/** Repos whose clone is on disk. This is the GitHub launcher list, not every account repo. */
export async function githubClonedRepos() {
  const status = await githubStatus(false);
  const repos = status.repos.filter((repo) => repo.cloneStatus === "cloned" && repo.localPath);
  return {
    connected: status.connected,
    login: status.login,
    githubDir: status.githubDir,
    repos,
    note: repos.length
      ? "Select one with github_select_repo, then start it with github_session_start."
      : "No clone is ready. Call github_refresh, then poll github_status until cloneStatus is cloned.",
  };
}

/** A cloned repo. Does not change which repo the GitHub launcher tools use. */
export function cloneRecord(fullName: string): { fullName: string; name: string; localPath: string } {
  const name = fullName.trim();
  const localPath = requireRepo(name);
  const repo = readGithubState().repos.find((row) => row.fullName === name);
  if (!repo || repo.cloneStatus !== "cloned" || !existsSync(localPath)) {
    throw new ActionError(`"${name}" is not cloned yet. Call github_cloned_repos.`);
  }
  return { fullName: repo.fullName, name: repo.name, localPath };
}

/** Show one clone in the GitHub launcher and remember it for the GitHub file and session tools. */
export function githubSelectRepo(fullName: string) {
  const repo = cloneRecord(fullName);
  rememberRepo(repo);
  const command = enqueueUiCommand("github-launch", {
    projectPath: repo.localPath,
    projectName: repo.name,
    origin: "github",
    repoFullName: repo.fullName,
    prompt: "",
  });
  return {
    ...repo,
    ui: { section: "github-launch", commandId: command.id },
    note: "The GitHub tab shows this clone. It does not start a CLI. Call github_session_start to open 1 to 6 sessions.",
  };
}

export async function githubSetVisibility(fullName: string, isPrivate: boolean) {
  const name = fullName.trim();
  if (!name) throw new ActionError("fullName is required.");
  const token = requireToken();
  try {
    await setRepoVisibility(token, name, isPrivate);
  } catch (err) {
    throw new ActionError(err instanceof Error ? err.message : String(err));
  }
  markRepoPrivate(name, isPrivate);
  return { fullName: name, private: isPrivate };
}
