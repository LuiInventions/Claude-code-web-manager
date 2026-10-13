import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Plugin whose hooks fail on every Grok tool call in a Jarvis session
 * (`plugin/everything-claude-code/hooks`). Grok has no session flag for this.
 * A project `.grok/config.toml` that lists the plugin under `disabled` stops
 * those hooks for this clone only. Claude settings hooks are a separate
 * switch (`GROK_CLAUDE_HOOKS_ENABLED` in `spawnEnv`).
 */
const PLUGIN = "everything-claude-code";
const MARKER = "jarvis-control-center: skip everything-claude-code hooks";
const EXCLUDE_LINE = ".grok/config.toml";

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      windowsHide: true,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function tracked(root: string, rel: string): boolean {
  try {
    execFileSync("git", ["-C", root, "ls-files", "--error-unmatch", "--", rel], {
      windowsHide: true,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function excludePath(root: string): string | null {
  const fromGit = git(root, ["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"]);
  if (fromGit) return fromGit;
  const gitDir = path.join(root, ".git");
  try {
    if (fs.statSync(gitDir).isDirectory()) return path.join(gitDir, "info", "exclude");
  } catch {
    /* no .git directory */
  }
  return null;
}

function ensureExcluded(root: string): void {
  const file = excludePath(root);
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const lines = current.split(/\r?\n/);
  if (lines.some((line) => line.trim() === EXCLUDE_LINE)) return;
  const suffix = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  fs.appendFileSync(file, `${suffix}${EXCLUDE_LINE}\n`);
}

/**
 * Stop the broken everything-claude-code hooks for Grok launched in `cwd`.
 * Does nothing when the folder is not a git checkout, or when the clone
 * already tracks `.grok/config.toml` (that file is the user's).
 * The file we create is listed in `.git/info/exclude`, so a later
 * `git add -A` does not publish it.
 */
export function silenceGrokPluginHooks(cwd: string): void {
  try {
    const dir = cwd.trim();
    if (!dir || dir === "~" || dir.startsWith("~/")) return;
    const root = git(dir, ["rev-parse", "--show-toplevel"]);
    if (!root) return;
    const rel = ".grok/config.toml";
    const configPath = path.join(root, ".grok", "config.toml");
    if (tracked(root, rel)) return;

    if (!fs.existsSync(configPath)) {
      ensureExcluded(root);
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(
        configPath,
        `# ${MARKER}\n[plugins]\ndisabled = ["${PLUGIN}"]\n`,
      );
      return;
    }

    const text = fs.readFileSync(configPath, "utf8");
    if (!text.includes(MARKER)) return;
    ensureExcluded(root);
    if (text.includes(`"${PLUGIN}"`) || text.includes(`'${PLUGIN}'`)) return;
    fs.appendFileSync(configPath, `disabled = ["${PLUGIN}"]\n`);
  } catch {
    /* a missing git or a read-only clone still starts Grok */
  }
}
