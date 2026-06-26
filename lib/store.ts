import fs from "node:fs";
import path from "node:path";

/**
 * Tiny JSON persistence layer for local single-user state
 * (project index, chat sessions, launcher history). Atomic-ish writes via
 * temp-file + rename. All files live under .data/.
 */
const DATA_DIR = path.join(process.cwd(), ".data");

export function dataDir(): string {
  return DATA_DIR;
}

export function dataPath(...segments: string[]): string {
  return path.join(DATA_DIR, ...segments);
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(dataPath(file), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, data: unknown): void {
  const full = dataPath(file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const tmp = `${full}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, full);
}

export function fileExists(file: string): boolean {
  try {
    fs.accessSync(dataPath(file));
    return true;
  } catch {
    return false;
  }
}
