import fs from "node:fs";
import path from "node:path";

/**
 * Runtime-editable settings, persisted to .data/settings.json.
 * These OVERRIDE .env values so the Settings UI is authoritative at runtime.
 * The OpenAI API key is intentionally NOT part of settings — it lives only in
 * the server environment and is never written here or exposed to the client.
 */
export interface Settings {
  /** Absolute path to the folder whose subfolders are treated as projects. */
  projectsDir?: string;
  /** Absolute path where GitHub repos are cloned (default <projectsDir>/github). */
  githubDir?: string;
  /** OpenAI model id used by Jarvis + the prompt improver. */
  openaiModel?: string;
  /** Cartesia voice id override (German voice for Jarvis). */
  cartesiaVoice?: string;
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
