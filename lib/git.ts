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

export interface ChangedFile {
  path: string;
  /** Normalized single-letter status: M·A·D·R·C·U·T·? */
  status: string;
}

/** Collapse a porcelain XY code to one normalized status letter. */
function normalizeStatus(code: string): string {
  if (code.includes("?")) return "?";
  if (code.includes("U")) return "U";
  const c = code.trim()[0] ?? "M";
  return "MADRCT".includes(c) ? c : "M";
}

/**
 * Parse `git status --porcelain` into changed-file entries. Renames
 * (`R  old -> new`) are reported under their new path.
 */
export function parsePorcelainStatus(porcelain: string): ChangedFile[] {
  return porcelain
    .split("\n")
    .filter((l) => l.length > 3)
    .map((line) => {
      const code = line.slice(0, 2);
      let path = line.slice(3).trim();
      const arrow = path.indexOf(" -> ");
      if (arrow !== -1) path = path.slice(arrow + 4).trim();
      return { path, status: normalizeStatus(code) };
    })
    .filter((f) => f.path.length > 0);
}

/** Parse `git diff --name-status` (committed-but-unpushed files). */
export function parseDiffNameStatus(diff: string): ChangedFile[] {
  return diff
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const status = (parts[0]?.trim()[0] ?? "M").toUpperCase();
      // Renames/copies carry both old and new paths; report the new one.
      const path = (parts[parts.length - 1] ?? "").trim();
      return { path, status: "MADRCT".includes(status) ? status : "M" };
    })
    .filter((f) => f.path.length > 0);
}

/**
 * List every file the Update button would push: uncommitted working-tree
 * changes plus any already-committed-but-unpushed files. No network access —
 * compares against the last-known `origin/<branch>` ref.
 */
export async function gitPushPreview(
  dir: string,
): Promise<{ branch: string | null; files: ChangedFile[] }> {
  const branch = await gitCurrentBranch(dir);
  const porcelain = (await git(dir, ["status", "--porcelain"])) ?? "";
  const working = parsePorcelainStatus(porcelain);

  let committed: ChangedFile[] = [];
  if (branch) {
    const diff = await git(dir, [
      "diff",
      "--name-status",
      `origin/${branch}..HEAD`,
    ]);
    if (diff) committed = parseDiffNameStatus(diff);
  }

  // Union by path; working-tree status wins (it is the most recent state).
  const byPath = new Map<string, ChangedFile>();
  for (const f of committed) byPath.set(f.path, f);
  for (const f of working) byPath.set(f.path, f);
  const files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  return { branch, files };
}

/**
 * Lightweight check for the GitHub tab's per-repo "pushable" hint: true when the
 * working tree has uncommitted changes, or there are committed-but-unpushed
 * commits ahead of the upstream. No network access. Returns early on a dirty
 * tree so the common case costs a single git call.
 */
export async function gitHasPendingPush(dir: string): Promise<boolean> {
  const porcelain = await git(dir, ["status", "--porcelain"]);
  if (porcelain && porcelain.trim().length > 0) return true;
  const branch = await gitCurrentBranch(dir);
  if (!branch) return false;
  const aheadRaw = await git(dir, ["rev-list", "--count", `origin/${branch}..HEAD`]);
  return (Number.parseInt((aheadRaw ?? "0").trim(), 10) || 0) > 0;
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

/**
 * Commit any local changes, integrate new remote commits (merge), then push.
 * Backs the GitHub tab's "Update" button. The token is passed per-invocation via
 * an auth header (never written to .git/config). On a merge conflict the merge is
 * aborted so the working tree is left clean and nothing is lost.
 */
export async function gitSyncAndPush(
  dir: string,
  token: string,
  message: string,
): Promise<{ ok: boolean; message: string; conflict?: boolean }> {
  const branch = await gitCurrentBranch(dir);
  if (!branch) return { ok: false, message: "Kein Branch gefunden." };

  // 1. Commit local changes if the working tree is dirty.
  const porcelain = await git(dir, ["status", "--porcelain"]);
  const dirty = !!porcelain && porcelain.trim().length > 0;
  let committed = false;
  if (dirty) {
    if (!(await gitCommitAll(dir, message)))
      return { ok: false, message: "Commit fehlgeschlagen (git user.name/email gesetzt?)." };
    committed = true;
  }

  // 2. Fetch the latest remote state.
  if ((await git(dir, [...buildAuthHeaderArg(token), "fetch", "origin"])) === null)
    return { ok: false, message: "git fetch fehlgeschlagen (kein Remote oder Auth?)." };

  // 3. If the remote gained commits, merge them in.
  let merged = false;
  const behindRaw = await git(dir, ["rev-list", "--count", `HEAD..origin/${branch}`]);
  const behind = Number.parseInt((behindRaw ?? "0").trim(), 10) || 0;
  if (behind > 0) {
    if ((await git(dir, ["merge", "--no-edit", `origin/${branch}`])) === null) {
      await git(dir, ["merge", "--abort"]);
      return {
        ok: false,
        conflict: true,
        message: "Merge-Konflikt — bitte Dateien manuell lösen.",
      };
    }
    merged = true;
  }

  // 4. Push.
  if ((await git(dir, [...buildAuthHeaderArg(token), "push", "origin", branch])) === null)
    return { ok: false, message: "git push fehlgeschlagen (Auth oder Konflikt?)." };

  // 5. Describe what happened.
  if (!committed && !merged) {
    const aheadRaw = await git(dir, ["rev-list", "--count", `origin/${branch}..HEAD`]);
    const ahead = Number.parseInt((aheadRaw ?? "0").trim(), 10) || 0;
    if (ahead === 0) return { ok: true, message: "Nichts zu pushen." };
  }
  const parts = [committed && "committed", merged && "merged", "pushed"].filter(Boolean);
  return { ok: true, message: `${parts.join(" + ")} ✓` };
}
