import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "./config";
import {
  detectStackFromFiles,
  frameworksFromPackageJson,
  type StackResult,
} from "./stack-detect";
import { gitStatus, type GitStatus } from "./git";

/**
 * Project scanner. Lists the direct subfolders of PROJECTS_DIR (skipping dot-
 * and Windows-system folders), and builds a summary per project: stack, git
 * status, README excerpt, last-modified, and a bounded directory size.
 */

const SYSTEM_FOLDERS = new Set([
  "appdata", "application data", "contacts", "cookies", "favorites", "links",
  "music", "pictures", "videos", "documents", "downloads", "desktop",
  "saved games", "searches", "3d objects", "onedrive", "local settings",
  "nethood", "printhood", "recent", "sendto", "start menu", "templates",
  "intelgraphicsprofiles", "my documents",
]);

const SIZE_SKIP = new Set([
  "node_modules", ".git", ".next", "dist", "build", "target", "vendor",
  ".venv", "venv", "__pycache__", ".turbo", ".cache", "out", "coverage", ".gradle",
]);

function isCandidate(name: string): boolean {
  if (name.startsWith(".")) return false;
  return !SYSTEM_FOLDERS.has(name.toLowerCase());
}

export interface ProjectSummary {
  name: string;
  path: string;
  mtimeMs: number;
  sizeBytes: number | null;
  stack: StackResult;
  readme: string | null;
  git: GitStatus;
}

export interface ProjectDetail extends ProjectSummary {
  readmeFull: string | null;
  manifest: unknown | null;
}

export async function scanProjects(): Promise<{
  projectsDir: string;
  projects: ProjectSummary[];
}> {
  const root = getConfig().projectsDir;
  let dirents;
  try {
    dirents = await fs.readdir(root, { withFileTypes: true });
  } catch (e) {
    throw new Error(
      `Projektordner nicht lesbar: ${root} — ${(e as Error).message}`,
    );
  }
  const candidates = dirents.filter(
    (d) => d.isDirectory() && isCandidate(d.name),
  );
  const projects = await mapLimit(candidates, 6, (d) =>
    summarize(path.join(root, d.name), d.name),
  );
  projects.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { projectsDir: root, projects };
}

export async function getProjectDetail(projPath: string): Promise<ProjectDetail> {
  const full = path.resolve(projPath);
  const name = path.basename(full);
  const summary = await summarize(full, name);

  let files: string[] = [];
  try {
    files = (await fs.readdir(full, { withFileTypes: true })).map((e) => e.name);
  } catch {
    /* unreadable */
  }
  const readmeName = files.find((f) => /^readme(\.md|\.txt|\.markdown)?$/i.test(f));
  let readmeFull: string | null = null;
  if (readmeName) {
    try {
      readmeFull = await fs.readFile(path.join(full, readmeName), "utf8");
    } catch {
      /* ignore */
    }
  }
  let manifest: unknown = null;
  if (files.some((f) => f.toLowerCase() === "package.json")) {
    try {
      manifest = JSON.parse(
        await fs.readFile(path.join(full, "package.json"), "utf8"),
      );
    } catch {
      /* ignore */
    }
  }
  return { ...summary, readmeFull, manifest };
}

async function summarize(full: string, name: string): Promise<ProjectSummary> {
  let mtimeMs = 0;
  try {
    mtimeMs = (await fs.stat(full)).mtimeMs;
  } catch {
    /* ignore */
  }
  let files: string[] = [];
  try {
    files = (await fs.readdir(full, { withFileTypes: true })).map((e) => e.name);
  } catch {
    /* ignore */
  }

  const stack = detectStackFromFiles(files);
  if (files.some((f) => f.toLowerCase() === "package.json")) {
    try {
      const pkg = JSON.parse(
        await fs.readFile(path.join(full, "package.json"), "utf8"),
      );
      stack.tags = [...new Set([...stack.tags, ...frameworksFromPackageJson(pkg)])];
    } catch {
      /* ignore malformed package.json */
    }
  }

  const [readme, git, sizeBytes] = await Promise.all([
    readReadmeExcerpt(full, files),
    gitStatus(full),
    dirSize(full).catch(() => null),
  ]);

  return { name, path: full, mtimeMs, sizeBytes, stack, readme, git };
}

async function readReadmeExcerpt(
  dir: string,
  files: string[],
  maxChars = 600,
): Promise<string | null> {
  const found = files.find((f) => /^readme(\.md|\.txt|\.markdown)?$/i.test(f));
  if (!found) return null;
  try {
    const c = await fs.readFile(path.join(dir, found), "utf8");
    return c.slice(0, maxChars);
  } catch {
    return null;
  }
}

async function dirSize(dir: string, budgetFiles = 20000): Promise<number> {
  let total = 0;
  let count = 0;
  async function walk(d: string): Promise<void> {
    if (count > budgetFiles) return;
    let ents;
    try {
      ents = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (count > budgetFiles) return;
      if (e.isDirectory()) {
        if (SIZE_SKIP.has(e.name.toLowerCase())) continue;
        await walk(path.join(d, e.name));
      } else {
        count++;
        try {
          total += (await fs.stat(path.join(d, e.name))).size;
        } catch {
          /* ignore */
        }
      }
    }
  }
  await walk(dir);
  return total;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) || 1 },
    async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await fn(items[idx]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
