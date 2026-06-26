import fs from "node:fs/promises";
import path from "node:path";
import { scanProjects } from "./projects";
import { readJson, writeJson } from "./store";
import type { StackResult } from "./stack-detect";

/**
 * Compact, persisted project index used as Jarvis's context. Rebuilt lazily
 * (cached for 10 min) or on demand. Stored at .data/index.json.
 */

const SIZE_SKIP = new Set([
  "node_modules", ".git", ".next", "dist", "build", "target", "vendor",
  ".venv", "venv", "__pycache__", ".turbo", ".cache", "out", "coverage", ".gradle",
]);

const INDEX_FILE = "index.json";

export interface IndexedProject {
  name: string;
  path: string;
  stack: StackResult;
  mtimeMs: number;
  sizeBytes: number | null;
  readme: string | null;
  tree: string[];
  git: {
    branch: string | null;
    dirty: boolean;
    commits: { hash: string; subject: string; relTime: string }[];
  };
  manifest: unknown | null;
}

export interface ProjectIndex {
  builtAt: number;
  projectsDir: string;
  projects: IndexedProject[];
}

export async function buildIndex(): Promise<ProjectIndex> {
  const { projectsDir, projects } = await scanProjects();
  const enriched: IndexedProject[] = await Promise.all(
    projects.map(async (p) => ({
      name: p.name,
      path: p.path,
      stack: p.stack,
      mtimeMs: p.mtimeMs,
      sizeBytes: p.sizeBytes,
      readme: p.readme ? p.readme.slice(0, 1200) : null,
      tree: await treeOutline(p.path),
      git: {
        branch: p.git.branch,
        dirty: p.git.dirty,
        commits: p.git.commits.map((c) => ({
          hash: c.hash,
          subject: c.subject,
          relTime: c.relTime,
        })),
      },
      manifest: await manifestEssentials(p.path),
    })),
  );
  const index: ProjectIndex = {
    builtAt: Date.now(),
    projectsDir,
    projects: enriched,
  };
  writeJson(INDEX_FILE, index);
  return index;
}

export function getIndex(): ProjectIndex | null {
  return readJson<ProjectIndex | null>(INDEX_FILE, null);
}

export async function getOrBuildIndex(
  maxAgeMs = 10 * 60 * 1000,
): Promise<ProjectIndex> {
  const cur = getIndex();
  if (cur && Date.now() - cur.builtAt < maxAgeMs) return cur;
  try {
    return await buildIndex();
  } catch {
    return cur ?? { builtAt: Date.now(), projectsDir: "", projects: [] };
  }
}

let rebuilding = false;

/**
 * Latency-optimised index access for the chat path. If any index exists it is
 * returned immediately (even when stale) and a refresh is kicked off in the
 * background — so Jarvis never blocks a request on a full filesystem scan. Only
 * the very first run (no index yet) waits for a build.
 */
export async function getIndexForChat(
  maxAgeMs = 10 * 60 * 1000,
): Promise<ProjectIndex> {
  const cur = getIndex();
  if (cur) {
    if (Date.now() - cur.builtAt >= maxAgeMs && !rebuilding) {
      rebuilding = true;
      void buildIndex()
        .catch(() => {})
        .finally(() => {
          rebuilding = false;
        });
    }
    return cur;
  }
  try {
    return await buildIndex();
  } catch {
    return { builtAt: Date.now(), projectsDir: "", projects: [] };
  }
}

/**
 * One compact line per project (name, path, stack, branch). Used as Jarvis's
 * context instead of the full index JSON — far fewer tokens, so the model starts
 * answering sooner. Details (trees, READMEs) are fetched on demand via tools.
 */
export function compactProjects(index: ProjectIndex): string {
  if (!index.projects.length) return "(keine Projekte indexiert)";
  return index.projects
    .map((p) => {
      const tags =
        p.stack?.tags?.slice(0, 4).join(", ") || p.stack?.primary || "";
      const branch = p.git?.branch
        ? ` @${p.git.branch}${p.git.dirty ? "*" : ""}`
        : "";
      return `- ${p.name} — ${p.path}${tags ? ` [${tags}]` : ""}${branch}`;
    })
    .join("\n");
}

async function treeOutline(root: string, maxEntries = 90): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, prefix: string, depth: number): Promise<void> {
    if (out.length >= maxEntries || depth > 2) return;
    let ents;
    try {
      ents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    ents.sort((a, b) =>
      a.isDirectory() === b.isDirectory()
        ? a.name.localeCompare(b.name)
        : a.isDirectory()
          ? -1
          : 1,
    );
    for (const e of ents) {
      if (out.length >= maxEntries) return;
      if (e.name.startsWith(".") && e.name !== ".env.example") continue;
      if (e.isDirectory()) {
        if (SIZE_SKIP.has(e.name.toLowerCase())) {
          out.push(`${prefix}${e.name}/ …`);
          continue;
        }
        out.push(`${prefix}${e.name}/`);
        await walk(path.join(dir, e.name), `${prefix}  `, depth + 1);
      } else {
        out.push(`${prefix}${e.name}`);
      }
    }
  }
  await walk(root, "", 0);
  return out;
}

async function manifestEssentials(root: string): Promise<unknown> {
  try {
    const pkg = JSON.parse(
      await fs.readFile(path.join(root, "package.json"), "utf8"),
    );
    return {
      type: "package.json",
      name: pkg.name,
      version: pkg.version,
      scripts: pkg.scripts ? Object.keys(pkg.scripts) : [],
      dependencies: pkg.dependencies ? Object.keys(pkg.dependencies).slice(0, 40) : [],
      devDependencies: pkg.devDependencies
        ? Object.keys(pkg.devDependencies).slice(0, 40)
        : [],
    };
  } catch {
    /* not a node project */
  }
  for (const f of ["requirements.txt", "go.mod", "Cargo.toml", "pyproject.toml"]) {
    try {
      const c = await fs.readFile(path.join(root, f), "utf8");
      return { type: f, content: c.slice(0, 500) };
    } catch {
      /* keep looking */
    }
  }
  return null;
}
