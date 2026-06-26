import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "./config";
import { getOpenAI } from "./openai";
import { readJson, writeJson } from "./store";

/**
 * Summarize a folder/project with a cheap OpenAI model when it has no README.
 * Cached per path+mtime in .data/summaries.json to avoid repeat cost.
 */

const CACHE_FILE = "summaries.json";
const SKIP = new Set([
  "node_modules", ".git", ".next", "dist", "build", "target", "vendor",
  ".venv", "venv", "__pycache__", ".cache", "out", ".turbo", "coverage",
]);

interface CacheEntry {
  mtimeMs: number;
  summary: string;
}

async function outline(root: string, max = 70): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, prefix: string, depth: number): Promise<void> {
    if (out.length >= max || depth > 2) return;
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
      if (out.length >= max) return;
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) {
        if (SKIP.has(e.name.toLowerCase())) {
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

async function manifest(root: string): Promise<string> {
  for (const f of [
    "package.json", "requirements.txt", "pyproject.toml", "go.mod",
    "Cargo.toml", "composer.json", "pom.xml", "build.gradle",
  ]) {
    try {
      const c = await fs.readFile(path.join(root, f), "utf8");
      return `${f}:\n${c.slice(0, 1200)}`;
    } catch {
      /* keep looking */
    }
  }
  return "";
}

export async function summarizeFolder(folder: string): Promise<string> {
  const abs = path.resolve(folder);
  let mtimeMs = 0;
  try {
    mtimeMs = (await fs.stat(abs)).mtimeMs;
  } catch {
    /* ignore */
  }

  const cache = readJson<Record<string, CacheEntry>>(CACHE_FILE, {});
  const cached = cache[abs];
  if (cached && cached.mtimeMs === mtimeMs) return cached.summary;

  const client = getOpenAI();
  const model = getConfig().openaiSummaryModel;
  const tree = (await outline(abs)).join("\n");
  const mani = await manifest(abs);

  const instructions =
    "Fasse den folgenden Ordner/Projekt in 3–5 prägnanten Sätzen auf Deutsch zusammen: " +
    "Was ist es, welcher Stack/Zweck, wichtigste Inhalte. Keine Floskeln, keine Überschrift.";
  const input = `Ordner: ${path.basename(abs)}\nPfad: ${abs}\n\nStruktur:\n${tree}\n\n${mani}`;

  const res = await client.responses.create({ model, instructions, input });
  const summary = (res.output_text ?? "").trim() || "Keine Zusammenfassung verfügbar.";

  cache[abs] = { mtimeMs, summary };
  writeJson(CACHE_FILE, cache);
  return summary;
}
