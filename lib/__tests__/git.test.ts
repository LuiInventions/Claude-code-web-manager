import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, it, expect } from "vitest";
import {
  parseGitLog,
  parseAheadBehind,
  buildAuthHeaderArg,
  parsePorcelainStatus,
  parseDiffNameStatus,
  gitPushPreview,
  gitCommitAll,
} from "../git";
import { findRepoPath, type StoredRepo } from "../github-store";

const pexec = promisify(execFile);

const US = "\x1f"; // field separator used in the git pretty-format

describe("parseGitLog", () => {
  it("parses unit-separated commit lines", () => {
    const raw = [
      ["a1b2c3d", "fix: handle empty input", "2 hours ago", "Luis"].join(US),
      ["e4f5g6h", "feat: add scanner", "3 days ago", "Luis"].join(US),
    ].join("\n");
    const commits = parseGitLog(raw);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({
      hash: "a1b2c3d",
      subject: "fix: handle empty input",
      relTime: "2 hours ago",
      author: "Luis",
    });
  });
  it("handles subjects containing spaces and colons", () => {
    const commits = parseGitLog(["h", "fix: a: b c", "now", "X"].join(US));
    expect(commits[0].subject).toBe("fix: a: b c");
  });
  it("returns [] for empty input", () => {
    expect(parseGitLog("")).toEqual([]);
  });
});

describe("parseAheadBehind", () => {
  it("parses left-right counts", () => {
    expect(parseAheadBehind("2\t1")).toEqual({ ahead: 2, behind: 1 });
    expect(parseAheadBehind("0 0")).toEqual({ ahead: 0, behind: 0 });
  });
  it("defaults to zero on null", () => {
    expect(parseAheadBehind(null)).toEqual({ ahead: 0, behind: 0 });
  });
});

describe("parsePorcelainStatus", () => {
  it("parses status codes into normalized entries", () => {
    const raw = [" M src/a.ts", "A  src/b.ts", " D src/c.ts", "?? new.txt"].join("\n");
    expect(parsePorcelainStatus(raw)).toEqual([
      { path: "src/a.ts", status: "M" },
      { path: "src/b.ts", status: "A" },
      { path: "src/c.ts", status: "D" },
      { path: "new.txt", status: "?" },
    ]);
  });
  it("reports renames under their new path", () => {
    expect(parsePorcelainStatus("R  old/name.ts -> new/name.ts")).toEqual([
      { path: "new/name.ts", status: "R" },
    ]);
  });
  it("returns [] for empty input", () => {
    expect(parsePorcelainStatus("")).toEqual([]);
  });
});

describe("parseDiffNameStatus", () => {
  it("parses tab-separated name-status lines", () => {
    const raw = ["M\tsrc/a.ts", "A\tsrc/b.ts", "D\tsrc/c.ts"].join("\n");
    expect(parseDiffNameStatus(raw)).toEqual([
      { path: "src/a.ts", status: "M" },
      { path: "src/b.ts", status: "A" },
      { path: "src/c.ts", status: "D" },
    ]);
  });
  it("reports renames under the new path", () => {
    expect(parseDiffNameStatus("R100\told.ts\tnew.ts")).toEqual([
      { path: "new.ts", status: "R" },
    ]);
  });
  it("returns [] for empty input", () => {
    expect(parseDiffNameStatus("")).toEqual([]);
  });
});

describe("buildAuthHeaderArg", () => {
  it("base64-encodes x-access-token:<token> as a basic auth extraheader", () => {
    const args = buildAuthHeaderArg("ghp_secret");
    const expected = Buffer.from("x-access-token:ghp_secret").toString("base64");
    expect(args).toEqual(["-c", `http.extraheader=AUTHORIZATION: basic ${expected}`]);
  });
});

describe("clone folder updates", () => {
  it("lists a file written in the clone the Repos tab would push", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-clone-"));
    const run = (args: string[]) => pexec("git", ["-C", dir, ...args], { windowsHide: true });
    try {
      await run(["init", "-b", "main"]);
      await run(["config", "user.email", "test@example.com"]);
      await run(["config", "user.name", "Test"]);
      fs.writeFileSync(path.join(dir, "readme.txt"), "a\n");
      await run(["add", "readme.txt"]);
      await run(["commit", "-m", "init"]);
      fs.writeFileSync(path.join(dir, "from-cli.txt"), "edited by cli\n");

      const localPath = findRepoPath(
        [{ fullName: "luis/demo", localPath: dir } as StoredRepo],
        "luis/demo",
      );
      expect(localPath).toBe(dir);
      const preview = await gitPushPreview(localPath!);
      expect(preview.files.map((f) => f.path)).toContain("from-cli.txt");
      expect(await gitCommitAll(localPath!, "Update via Control Center")).toBe(true);
      const after = await gitPushPreview(localPath!);
      expect(after.files.find((f) => f.path === "from-cli.txt")).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("offers a new file even when git config hides untracked files", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-untracked-"));
    const run = (args: string[]) => pexec("git", ["-C", dir, ...args], { windowsHide: true });
    try {
      await run(["init", "-b", "main"]);
      await run(["config", "user.email", "test@example.com"]);
      await run(["config", "user.name", "Test"]);
      await run(["config", "status.showUntrackedFiles", "no"]);
      fs.writeFileSync(path.join(dir, "readme.txt"), "a\n");
      await run(["add", "readme.txt"]);
      await run(["commit", "-m", "init"]);
      fs.writeFileSync(path.join(dir, "notes.txt"), "local edit\n");
      const preview = await gitPushPreview(dir);
      expect(preview.files.map((f) => f.path)).toContain("notes.txt");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
