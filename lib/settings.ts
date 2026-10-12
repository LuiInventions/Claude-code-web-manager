import fs from "node:fs";
import path from "node:path";
import type { CodeCliId } from "./code-clis";
import type { ThemeId } from "./themes";

/** A server saved from the launcher or the Sessions tab. No password here. */
export interface RemoteServerRecord {
  id: string;
  host: string;
  user: string;
  dir: string;
}

/**
 * Runtime-editable settings, persisted to .data/settings.json.
 * These OVERRIDE .env values so the Settings UI is authoritative at runtime.
 * The OpenAI API key is intentionally NOT part of settings — it lives only in
 * the server environment and is never written here or exposed to the client.
 */
export interface Settings {
  /** Absolute path to the folder whose subfolders are treated as projects. */
  projectsDir?: string;
  /**
   * Ignored. Clones live in `<program folder>/github_repos` (see
   * defaultGithubReposDir). Left on the type so an older settings.json still loads.
   */
  githubDir?: string;
  /** Active AI provider id (e.g. "openai", "groq"). */
  aiProvider?: string;
  /** Model id for the active AI provider. */
  aiModel?: string;
  /** Legacy OpenAI model id (still honoured when provider is OpenAI). */
  openaiModel?: string;
  /** Cartesia voice id override (German voice for Jarvis). */
  cartesiaVoice?: string;
  /**
   * Coding CLI the launcher spawns: Claude Code, Grok, or ChatGPT Codex.
   * Chosen on the first-run screen and changeable in Settings.
   */
  codeCli?: CodeCliId;
  /**
   * App version that last completed first-run setup. When it differs from the
   * running version the welcome/provider screen runs again after an update.
   * The GitHub token (separate `.data/github-secret.json`) is never touched.
   */
  setupVersion?: string;
  /**
   * Servers the user asked to keep. Passwords live in the secret store, keyed
   * by `RemoteServerRecord.id`. The 2FA code is never stored.
   */
  remoteServers?: RemoteServerRecord[];
  /**
   * Saved remote login. Host and user are written only when the user checks
   * "IP und Passwort speichern". The password itself lives in the secret store.
   */
  remoteHost?: string;
  remoteUser?: string;
  /** Directory on the server. `~` means the remote home. Always remembered. */
  remoteDir?: string;
  /** Whether the last connect asked to keep host, user, and password. */
  remoteSaveLogin?: boolean;
  /**
   * Last folder chosen under Local in the launcher. VS Codium opens here.
   * Not a remote path.
   */
  launcherLocalPath?: string;
  /** One of the built-in palettes. Missing means Ink. */
  theme?: ThemeId;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

export function readSettings(): Settings {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Settings) : {};
  } catch {
    return {};
  }
}

export function writeSettings(patch: Settings): Settings {
  const current = readSettings();
  const next: Settings = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null || value === "") {
      delete (next as Record<string, unknown>)[key];
    } else {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = SETTINGS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(tmp, SETTINGS_FILE);
  return next;
}
