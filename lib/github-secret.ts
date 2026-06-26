import { readJson, writeJson, dataPath } from "./store";
import fs from "node:fs";

/**
 * The GitHub Personal Access Token. Stored ONLY here, in .data/ (gitignored),
 * never in settings.json and never returned to the browser. Mirrors the
 * "secrets never reach the client" rule in lib/config.ts.
 */
const FILE = "github-secret.json";

interface SecretFile {
  token?: string;
}

export function readGithubToken(): string | null {
  return readJson<SecretFile>(FILE, {}).token?.trim() || null;
}

export function writeGithubToken(token: string): void {
  writeJson(FILE, { token: token.trim() } satisfies SecretFile);
}

export function clearGithubToken(): void {
  try {
    fs.rmSync(dataPath(FILE), { force: true });
  } catch {
    /* already gone */
  }
}
