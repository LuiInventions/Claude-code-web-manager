import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { silenceGrokPluginHooks } from "../server/grok-hooks";

const roots: string[] = [];

function git(dir: string, args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-grok-hooks-"));
  roots.push(dir);
  git(dir, ["init", "-q"]);
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  git(dir, ["add", "README.md"]);
  git(dir, ["-c", "user.email=probe@example.com", "-c", "user.name=probe", "commit", "-qm", "init"]);
  return dir;
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("silenceGrokPluginHooks", () => {
  it("writes an excluded config that git add -A does not stage", () => {
    const dir = repo();
    silenceGrokPluginHooks(dir);
    silenceGrokPluginHooks(path.join(dir, "."));
    const config = fs.readFileSync(path.join(dir, ".grok", "config.toml"), "utf8");
    expect(config).toContain('disabled = ["everything-claude-code"]');
    expect(config.match(/everything-claude-code/g)).toHaveLength(2);
    const exclude = git(dir, ["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"]);
    expect(fs.readFileSync(exclude.trim(), "utf8")).toContain(".grok/config.toml");
    git(dir, ["add", "-A"]);
    expect(git(dir, ["diff", "--cached", "--name-only"]).trim()).toBe("");
    expect(git(dir, ["status", "--porcelain", "--untracked-files=normal"]).trim()).toBe("");
  });

  it("leaves a tracked project config alone", () => {
    const dir = repo();
    fs.mkdirSync(path.join(dir, ".grok"));
    const body = "[plugins]\nenabled = [\"keep-me\"]\n";
    fs.writeFileSync(path.join(dir, ".grok", "config.toml"), body);
    git(dir, ["add", "-A"]);
    git(dir, ["-c", "user.email=probe@example.com", "-c", "user.name=probe", "commit", "-qm", "config"]);
    silenceGrokPluginHooks(dir);
    expect(fs.readFileSync(path.join(dir, ".grok", "config.toml"), "utf8")).toBe(body);
  });

  it("does not create a config outside a git checkout", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-grok-hooks-"));
    roots.push(dir);
    silenceGrokPluginHooks(dir);
    expect(fs.existsSync(path.join(dir, ".grok"))).toBe(false);
  });

  it("does not replace someone else's untracked config", () => {
    const dir = repo();
    fs.mkdirSync(path.join(dir, ".grok"));
    const body = "[mcp_servers.local]\ncommand = \"echo\"\n";
    fs.writeFileSync(path.join(dir, ".grok", "config.toml"), body);
    silenceGrokPluginHooks(dir);
    expect(fs.readFileSync(path.join(dir, ".grok", "config.toml"), "utf8")).toBe(body);
    git(dir, ["add", "-A"]);
    expect(git(dir, ["diff", "--cached", "--name-only"])).toContain(".grok/config.toml");
  });
});
