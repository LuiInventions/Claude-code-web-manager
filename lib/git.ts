import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export interface GitCommit {
  hash: string;
  subject: string;
  relTime: string;
  author: string;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  dirty: boolean;
  ahead: number;
  behind: number;
  commits: GitCommit[];
}

async function git(dir: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await pexec("git", ["-C", dir, ...args], {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

export async function gitStatus(dir: string): Promise<GitStatus> {
  const inside = await git(dir, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside || inside.trim() !== "true") {
    return { isRepo: false, branch: null, dirty: false, ahead: 0, behind: 0, commits: [] };
  }
  const branch = (await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]))?.trim() || null;
  const porcelain = await git(dir, ["status", "--porcelain"]);
  const dirty = !!porcelain && porcelain.trim().length > 0;
  const log = await git(dir, [
    "log",
    "-3",
    "--pretty=format:%h%x1f%s%x1f%cr%x1f%an",
  ]);
  const commits = parseGitLog(log ?? "");
  const ab = await git(dir, ["rev-list", "--left-right", "--count", "HEAD...@{u}"]);
  const { ahead, behind } = parseAheadBehind(ab);
  return { isRepo: true, branch, dirty, ahead, behind, commits };
}

export function parseGitLog(s: string): GitCommit[] {
  return s
    .split("\n")
    .filter((l) => l.length > 0)
    .map((line) => {
      const [hash, subject, relTime, author] = line.split("\x1f");
      return {
        hash: hash ?? "",
        subject: subject ?? "",
        relTime: relTime ?? "",
        author: author ?? "",
      };
    });
}

export function parseAheadBehind(s: string | null): { ahead: number; behind: number } {
  if (!s) return { ahead: 0, behind: 0 };
  const parts = s.trim().split(/\s+/);
  return {
    ahead: Number.parseInt(parts[0] ?? "0", 10) || 0,
    behind: Number.parseInt(parts[1] ?? "0", 10) || 0,
  };
}

/**
 * Builds a per-invocation auth header so the PAT is never written to .git/config.
 * GitHub accepts basic auth with any username and the token as the password.
 */
export function buildAuthHeaderArg(token: string): string[] {
  const b64 = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `http.extraheader=AUTHORIZATION: basic ${b64}`];
}

export async function gitClone(
  cloneUrl: string,
  dest: string,
  token: string,
): Promise<boolean> {
  const out = await git(".", [
    ...buildAuthHeaderArg(token),
    "clone",
    "--depth",
    "1",
    cloneUrl,
    dest,
  ]);
  return out !== null;
}

/**
 * Fast-forward the local repo to the latest remote state. Refuses to touch a
 * dirty working tree (so in-progress local edits are never clobbered) and only
 * fast-forwards (never creates a merge), so diverged branches are left alone.
 */
export async function gitPull(
  dir: string,
  token: string,
): Promise<{ ok: boolean; message: string }> {
  const porcelain = await git(dir, ["status", "--porcelain"]);
  if (porcelain && porcelain.trim().length > 0)
    return { ok: false, message: "lokale Änderungen — Pull übersprungen" };
  const out = await git(dir, [...buildAuthHeaderArg(token), "pull", "--ff-only"]);
  return out === null
    ? { ok: false, message: "git pull fehlgeschlagen (divergiert oder kein Upstream?)." }
    : { ok: true, message: "aktualisiert" };
}

export async function gitCurrentBranch(dir: string): Promise<string | null> {
  return (await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]))?.trim() || null;
}

/** Commit time of HEAD as epoch ms, or null if unavailable. */
export async function gitLastCommitTime(dir: string): Promise<number | null> {
  const out = await git(dir, ["log", "-1", "--format=%ct"]);
  if (!out) return null;
  const secs = Number.parseInt(out.trim(), 10);
  return Number.isFinite(secs) ? secs * 1000 : null;
}

export async function gitChangedFiles(dir: string): Promise<string[]> {
  const porcelain = await git(dir, ["status", "--porcelain"]);
  if (!porcelain) return [];
  return porcelain
    .split("\n")
    .map((l) => l.slice(3).trim())
    .filter(Boolean);
}

export async function gitCommitAll(dir: string, message: string): Promise<boolean> {
  const added = await git(dir, ["add", "-A"]);
  if (added === null) return false;
  const committed = await git(dir, ["commit", "-m", message]);
  return committed !== null;
}

/**
 * Publish a local folder to a freshly created (empty) GitHub repo: init the
 * repo if needed, ensure at least one commit, wire up `origin`, then push.
 * Idempotent enough to re-run: an existing repo/commit/remote is reused.
 */
export async function gitPublishFolder(
  dir: string,
  remoteUrl: string,
  token: string,
  branch = "main",
): Promise<{ ok: boolean; message: string }> {
  const inside = await git(dir, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside || inside.trim() !== "true") {
    // `git init -b <branch>` needs Git 2.28+; fall back for older versions.
    if ((await git(dir, ["init", "-b", branch])) === null) {
      if ((await git(dir, ["init"])) === null)
        return { ok: false, message: "git init fehlgeschlagen." };
      await git(dir, ["checkout", "-b", branch]);
    }
  }

  // Ensure there is something to push — create the first commit if HEAD is unborn.
  const head = await git(dir, ["rev-parse", "--verify", "HEAD"]);
  if (head === null) {
    await git(dir, ["add", "-A"]);
    if ((await git(dir, ["commit", "-m", "Initial commit"])) === null) {
      // Empty folder: still give the remote a starting commit.
      if ((await git(dir, ["commit", "--allow-empty", "-m", "Initial commit"])) === null)
        return { ok: false, message: "git commit fehlgeschlagen (git user.name/email gesetzt?)." };
    }
  }

  // Point origin at the new remote (add, or repoint an existing one).
  if ((await git(dir, ["remote", "get-url", "origin"])) === null) {
    await git(dir, ["remote", "add", "origin", remoteUrl]);
  } else {
    await git(dir, ["remote", "set-url", "origin", remoteUrl]);
  }

  const curBranch = (await gitCurrentBranch(dir)) || branch;
  const out = await git(dir, [
    ...buildAuthHeaderArg(token),
    "push",
    "-u",
    "origin",
    curBranch,
  ]);
  return out === null
    ? { ok: false, message: "git push fehlgeschlagen (Auth oder bereits vorhandene Commits?)." }
    : { ok: true, message: `Gepusht nach origin/${curBranch}.` };
}

export async function gitPush(
  dir: string,
  token: string,
): Promise<{ ok: boolean; message: string }> {
  const branch = await gitCurrentBranch(dir);
  if (!branch) return { ok: false, message: "Kein Branch gefunden." };
  const out = await git(dir, [
    ...buildAuthHeaderArg(token),
    "push",
    "origin",
    branch,
  ]);
  return out === null
    ? { ok: false, message: "git push fehlgeschlagen (Konflikt, kein Remote oder Auth?)." }
    : { ok: true, message: `Gepusht nach origin/${branch}.` };
}
