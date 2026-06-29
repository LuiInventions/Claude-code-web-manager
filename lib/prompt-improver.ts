import fs from "node:fs/promises";
import path from "node:path";
import { getAiClient, getModel } from "./openai";
import { getOrBuildIndex } from "./indexer";
import { detectStackFromFiles, frameworksFromPackageJson } from "./stack-detect";

/**
 * Turns a rough developer prompt into a clear, project-specific, actionable
 * instruction for Claude Code. Returns only the improved prompt.
 *
 * The improver always gives the model real context about the SELECTED project:
 * if the project is in the prebuilt index we use that; otherwise we build the
 * context straight from disk (stack, manifest, tree, README) so the AI never
 * falls back to just a bare path string.
 */

const README_CAP = 4000;
const README_RE = /^readme(\.|$)/i;

interface ProjectContext {
  name: string;
  path: string;
  stack?: unknown;
  tree?: unknown;
  manifest?: unknown;
  readme?: unknown;
  source: "index" | "disk";
  note?: string;
}

/** Build project context from disk for a path that isn't in the index. */
export async function buildContextFromDisk(
  projectPath: string,
): Promise<ProjectContext> {
  const name = path.basename(projectPath.replace(/[\\/]+$/, "")) || projectPath;

  let entries;
  try {
    entries = await fs.readdir(projectPath, { withFileTypes: true });
  } catch {
    return { name, path: projectPath, source: "disk", note: "Verzeichnis nicht lesbar" };
  }

  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  const base = detectStackFromFiles(files);
  const tags = [...base.tags];

  let manifest: unknown = null;
  if (files.some((f) => f.toLowerCase() === "package.json")) {
    try {
      const pkg = JSON.parse(
        await fs.readFile(path.join(projectPath, "package.json"), "utf8"),
      ) as {
        name?: string;
        version?: string;
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      tags.push(...frameworksFromPackageJson(pkg));
      manifest = {
        name: pkg.name,
        version: pkg.version,
        scripts: pkg.scripts ? Object.keys(pkg.scripts) : undefined,
        dependencies: pkg.dependencies ? Object.keys(pkg.dependencies) : undefined,
        devDependencies: pkg.devDependencies
          ? Object.keys(pkg.devDependencies)
          : undefined,
      };
    } catch {
      /* unreadable/invalid package.json — skip manifest */
    }
  }

  let readme: string | null = null;
  const readmeName = files.find((f) => README_RE.test(f));
  if (readmeName) {
    try {
      readme = (
        await fs.readFile(path.join(projectPath, readmeName), "utf8")
      ).slice(0, README_CAP);
    } catch {
      /* unreadable README — skip */
    }
  }

  return {
    name,
    path: projectPath,
    stack: { primary: base.primary, tags: [...new Set(tags)] },
    tree: entries.slice(0, 200).map((e) => (e.isDirectory() ? "[dir] " : "") + e.name),
    manifest,
    readme,
    source: "disk",
  };
}

/** Context for the selected project: index entry if present, else built from disk. */
async function projectContext(projectPath: string): Promise<ProjectContext> {
  const index = await getOrBuildIndex();
  const proj = index.projects.find((p) => p.path === projectPath);
  if (proj) {
    return {
      name: proj.name,
      path: proj.path,
      stack: proj.stack,
      tree: proj.tree,
      manifest: proj.manifest,
      readme: proj.readme,
      source: "index",
    };
  }
  return buildContextFromDisk(projectPath);
}

export async function improvePrompt(
  projectPath: string,
  rawPrompt: string,
): Promise<string> {
  const client = getAiClient();
  const model = getModel();

  const context = JSON.stringify(await projectContext(projectPath));

  const instructions = [
    "Du bist Experte darin, vage Entwickler-Prompts in präzise, umsetzbare",
    "Anweisungen für Claude Code (einen autonomen Coding-Agenten) zu verwandeln.",
    "Verbessere den Roh-Prompt: konkretisiere ihn, mache ihn projektbezogen,",
    "eindeutig und direkt umsetzbar. Beziehe dich auf den realen Projekt-Stack",
    "und die Struktur. Erfinde keine Fakten.",
    "Gib AUSSCHLIESSLICH den verbesserten Prompt zurück — keine Einleitung,",
    "keine Erklärung, keine Code-Fences, keine Anführungszeichen drumherum.",
    "Behalte die Sprache des Nutzers bei (in der Regel Deutsch).",
    "",
    "=== PROJEKT-KONTEXT (JSON) ===",
    context,
  ].join("\n");

  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: instructions },
      { role: "user", content: `Roh-Prompt des Nutzers:\n${rawPrompt}` },
    ],
  });
  return (res.choices[0]?.message?.content ?? "").trim();
}
