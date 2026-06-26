import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Background folder finder for Jarvis. Walks the filesystem (directories only)
 * in several escalating passes — up to 5 — and returns matching absolute paths.
 * No window is shown and no UI panel is opened: this runs purely server-side so
 * the result can be revealed in the Explorer afterwards.
 */

const SKIP = new Set([
  "node_modules", ".git", ".next", "dist", "build", "target", "vendor",
  ".venv", "venv", "__pycache__", ".cache", "out", ".turbo", "coverage",
  ".gradle", "$recycle.bin", "system volume information", "windows",
  "program files", "program files (x86)", "programdata", "appdata",
]);

export interface FindOpts {
  /** Also score when a token only appears in the full path, not the folder name. */
  matchPath: boolean;
  /** Require every token to match (AND) instead of any token (OR). */
  requireAll: boolean;
}

export interface FolderHit {
  path: string;
  score: number;
}

/** Pure scoring helper — exported for unit testing. */
export function scoreFolder(
  nameLower: string,
  fullPathLower: string,
  tokens: string[],
  opts: FindOpts,
): number {
  let score = 0;
  let matched = 0;
  for (const t of tokens) {
    if (nameLower.includes(t)) {
      score += 3;
      matched++;
    } else if (opts.matchPath && fullPathLower.includes(t)) {
      score += 1;
      matched++;
    }
  }
  if (matched === 0) return 0;
  if (opts.requireAll && matched < tokens.length) return 0;
  // Strong bonus for an exact folder-name match.
  if (tokens.length === 1 && nameLower === tokens[0]) score += 6;
  return score;
}

export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_.-]/gu, ""))
    .filter(Boolean);
}

function fixedDrives(): string[] {
  const drives: string[] = [];
  for (let c = 67; c <= 90; c++) {
    // start at C: to skip floppy drives A:/B:
    const root = `${String.fromCharCode(c)}:\\`;
    if (existsSync(root)) drives.push(root);
  }
  return drives;
}

async function walkPass(
  roots: string[],
  tokens: string[],
  opts: FindOpts,
  maxDepth: number,
  budget: number,
): Promise<FolderHit[]> {
  const hits: FolderHit[] = [];
  let scanned = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (scanned > budget || hits.length > 300 || depth > maxDepth) return;
    let ents;
    try {
      ents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      scanned++;
      const nameLower = e.name.toLowerCase();
      const full = path.join(dir, e.name);
      const s = scoreFolder(nameLower, full.toLowerCase(), tokens, opts);
      if (s > 0) hits.push({ path: full, score: s });
      if (SKIP.has(nameLower) || nameLower.startsWith(".")) continue;
      await walk(full, depth + 1);
    }
  }

  for (const r of roots) await walk(r, 0);
  hits.sort((a, b) => b.score - a.score);
  return hits;
}

/**
 * Search for a folder by name/keywords. Tries up to 5 escalating passes (home
 * dir first, then all fixed drives, broadening the match each time) and stops at
 * the first pass that finds anything. Returns the best matches, or [] if nothing
 * was found after all passes.
 */
export async function findFolder(query: string, limit = 12): Promise<string[]> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const home = os.homedir();
  const drives = fixedDrives();

  const passes: {
    roots: string[];
    maxDepth: number;
    opts: FindOpts;
    budget: number;
  }[] = [
    { roots: [home], maxDepth: 5, opts: { matchPath: false, requireAll: true }, budget: 120_000 },
    { roots: [home], maxDepth: 9, opts: { matchPath: true, requireAll: true }, budget: 160_000 },
    { roots: [home], maxDepth: 14, opts: { matchPath: true, requireAll: false }, budget: 220_000 },
    { roots: drives, maxDepth: 5, opts: { matchPath: false, requireAll: true }, budget: 220_000 },
    { roots: drives, maxDepth: 8, opts: { matchPath: true, requireAll: false }, budget: 320_000 },
  ];

  for (const p of passes) {
    const hits = await walkPass(p.roots, tokens, p.opts, p.maxDepth, p.budget);
    if (hits.length) {
      const seen = new Set<string>();
      const unique: string[] = [];
      for (const h of hits) {
        if (seen.has(h.path)) continue;
        seen.add(h.path);
        unique.push(h.path);
        if (unique.length >= limit) break;
      }
      return unique;
    }
  }
  return [];
}
