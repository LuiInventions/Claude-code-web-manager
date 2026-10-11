import { execFileSync } from "node:child_process";
import { getCodeCli, type CodeCliId } from "../code-clis";

/**
 * PATH lookup for a coding CLI. Server-only: the client bundle must not import
 * `node:child_process` (the launcher imports the pure option lists).
 */

const binCache = new Map<string, string | null>();

/** Absolute path of `bin`, or null when it is not on PATH. Cached per process. */
export function resolveCliBin(bin: string): string | null {
  if (binCache.has(bin)) return binCache.get(bin) ?? null;
  const cmd = process.platform === "win32" ? "where" : "which";
  let found: string | null = null;
  try {
    const out = execFileSync(cmd, [bin], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
    });
    found = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? null;
  } catch {
    found = null;
  }
  binCache.set(bin, found);
  return found;
}

/** True when the CLI executable is on PATH. */
export function codeCliInstalled(id: CodeCliId): boolean {
  return resolveCliBin(getCodeCli(id).bin) !== null;
}
