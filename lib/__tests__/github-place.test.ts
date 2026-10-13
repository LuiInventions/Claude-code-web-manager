import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { placeClones, reposMissingOnDisk } from "../github-place";
import type { StoredRepo } from "../github-store";

const pexec = promisify(execFile);
const dirs: string[] = [];

function repo(name: string, localPath: string): StoredRepo {
  return {
    name,
    fullName: `octo/${name}`,
    cloneUrl: `https://github.com/octo/${name}.git`,
    private: false,
    description: null,
    defaultBranch: "main",
    updatedAt: "",
    cloneStatus: "cloned",
    localPath,
  };
}

async function initRepo(dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  const run = (args: string[]) => pexec("git", ["-C", dir, ...args], { windowsHide: true });
  await run(["init", "-b", "main"]);
  await run(["config", "user.email", "test@example.com"]);
  await run(["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, "readme.txt"), "a\n");
  await run(["add", "readme.txt"]);
  await run(["commit", "-m", "init"]);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("placeClones", () => {
  it("moves an existing clone into github_repos and keeps its files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-place-"));
    dirs.push(root);
    const src = path.join(root, "old", "demo");
    fs.mkdirSync(src, { recursive: true });
    fs.mkdirSync(path.join(src, ".git"));
    fs.writeFileSync(path.join(src, "note.txt"), "edited\n");
    const githubDir = path.join(root, "github_repos");

    const placed = await placeClones([repo("demo", src)], githubDir, []);

    const dest = path.join(githubDir, "demo");
    expect(placed.changed).toBe(true);
    expect(placed.repos[0].localPath).toBe(dest);
    expect(fs.readFileSync(path.join(dest, "note.txt"), "utf8")).toBe("edited\n");
    expect(fs.existsSync(src)).toBe(false);
  });

  it("does not move a clone a live session is still using", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-place-"));
    dirs.push(root);
    const src = path.join(root, "old", "demo");
    fs.mkdirSync(path.join(src, ".git"), { recursive: true });
    fs.writeFileSync(path.join(src, "note.txt"), "busy\n");
    const githubDir = path.join(root, "github_repos");

    const placed = await placeClones([repo("demo", src)], githubDir, [src]);

    expect(placed.changed).toBe(false);
    expect(placed.repos[0].localPath).toBe(src);
    expect(fs.readFileSync(path.join(src, "note.txt"), "utf8")).toBe("busy\n");
  });

  it("replaces a clean github_repos copy with the clone that has local edits", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-place-"));
    dirs.push(root);
    const src = path.join(root, "old", "demo");
    const dest = path.join(root, "github_repos", "demo");
    await initRepo(src);
    await initRepo(dest);
    fs.writeFileSync(path.join(src, "from-cli.txt"), "local\n");

    const placed = await placeClones([repo("demo", src)], path.dirname(dest), []);

    expect(placed.repos[0].localPath).toBe(dest);
    expect(fs.readFileSync(path.join(dest, "from-cli.txt"), "utf8")).toBe("local\n");
    expect(fs.existsSync(src)).toBe(false);
    expect(placed.wiped).toEqual([]);
  });

  it("does not leave a deleted clone marked cloned", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-place-"));
    dirs.push(root);
    const githubDir = path.join(root, "github_repos");
    const dest = path.join(githubDir, "demo");

    const placed = await placeClones([repo("demo", dest)], githubDir, [dest]);

    expect(placed.changed).toBe(true);
    expect(placed.repos[0].cloneStatus).toBe("pending");
    expect(placed.repos[0].localPath).toBe(dest);
    expect(placed.wiped).toEqual(["octo/demo"]);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it("points a wiped install-folder clone at the new folder", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-place-"));
    dirs.push(root);
    const old = path.join(root, "Programs", "Jarvis Control Center", "github_repos", "demo");
    const githubDir = path.join(root, "Jarvis Control Center", "github_repos");

    const placed = await placeClones([repo("demo", old)], githubDir, [old]);

    const dest = path.join(githubDir, "demo");
    expect(placed.repos[0].cloneStatus).toBe("pending");
    expect(placed.repos[0].localPath).toBe(dest);
    expect(placed.wiped).toEqual(["octo/demo"]);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it("keeps a cloning repo cloning while its folder is still missing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-place-"));
    dirs.push(root);
    const dest = path.join(root, "github_repos", "demo");
    const cloning = repo("demo", dest);
    cloning.cloneStatus = "cloning";

    const placed = await placeClones([cloning], path.dirname(dest), []);

    expect(placed.repos[0].cloneStatus).toBe("cloning");
    expect(placed.wiped).toEqual([]);
  });
});

describe("reposMissingOnDisk", () => {
  it("selects pending and cloning repos whose folder is gone", () => {
    const missing = repo("demo", path.join(os.tmpdir(), "ccc-missing-demo"));
    missing.cloneStatus = "pending";
    const cloning = repo("other", path.join(os.tmpdir(), "ccc-missing-other"));
    cloning.cloneStatus = "cloning";
    const failed = repo("bad", path.join(os.tmpdir(), "ccc-missing-bad"));
    failed.cloneStatus = "error";
    const stillThere = repo("kept", path.join(os.tmpdir(), "ccc-missing-kept"));

    const picked = reposMissingOnDisk(
      [missing, cloning, failed, stillThere],
      new Set([cloning.fullName]),
      () => false,
    ).map((item) => item.name);

    expect(picked).toEqual(["demo"]);
  });

  it("skips a folder that is still on disk", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-place-"));
    dirs.push(root);
    const dest = path.join(root, "demo");
    fs.mkdirSync(dest);
    const pending = repo("demo", dest);
    pending.cloneStatus = "pending";

    expect(reposMissingOnDisk([pending], new Set())).toEqual([]);
  });
});
