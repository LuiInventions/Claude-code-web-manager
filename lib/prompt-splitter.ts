import { getModel, getOpenAI } from "./openai";
import { getOrBuildIndex } from "./indexer";
import { buildContextFromDisk } from "./prompt-improver";

/**
 * "KI Modus": rework a large developer task and split it into 1–6 independent,
 * well-structured sub-tasks for PARALLEL Claude Code sessions. The model decides
 * the optimal count so no single session is overwhelmed. parseSplitResponse is
 * pure (unit-tested); splitPrompt adds project context and calls the model.
 */

export interface SplitSession {
  title?: string;
  prompt: string;
}

const MAX_SESSIONS = 6;

/** Parse the model's JSON into clamped, non-empty sub-sessions. Pure. */
export function parseSplitResponse(text: string): SplitSession[] {
  let t = (text ?? "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();

  let data: unknown;
  try {
    data = JSON.parse(t);
  } catch {
    return [];
  }
  const arr = Array.isArray(data)
    ? data
    : (data as { sessions?: unknown }).sessions;
  if (!Array.isArray(arr)) return [];

  const out: SplitSession[] = [];
  for (const item of arr) {
    if (out.length >= MAX_SESSIONS) break;
    const o = (item ?? {}) as Record<string, unknown>;
    const prompt = typeof o.prompt === "string" ? o.prompt.trim() : "";
    if (!prompt) continue;
    const title =
      typeof o.title === "string" && o.title.trim() ? o.title.trim() : undefined;
    out.push({ title, prompt });
  }
  return out;
}

async function projectContext(projectPath: string): Promise<string> {
  const index = await getOrBuildIndex();
  const proj = index.projects.find((p) => p.path === projectPath);
  if (proj) {
    return JSON.stringify({
      name: proj.name,
      path: proj.path,
      stack: proj.stack,
      tree: proj.tree,
      manifest: proj.manifest,
      readme: proj.readme,
    });
  }
  return JSON.stringify(await buildContextFromDisk(projectPath));
}

export async function splitPrompt(
  projectPath: string,
  rawPrompt: string,
): Promise<SplitSession[]> {
  const client = getOpenAI();
  const model = getModel();
  const context = await projectContext(projectPath);

  const instructions = [
    "Du zerlegst eine große Entwickler-Aufgabe in 1 bis 6 unabhängige, klar",
    "strukturierte Teil-Aufgaben für PARALLELE Claude-Code-Sessions. Jede Teil-Aufgabe",
    "muss eigenständig, konkret und direkt umsetzbar sein und darf eine Session nicht",
    "überfordern. Entscheide selbst die optimale Anzahl: kleine Aufgabe → 1; große oder",
    "mehrteilige → mehr (maximal 6). Vermeide Überschneidungen und gefährliche",
    "Parallel-Konflikte an denselben Dateien. Beziehe dich auf den realen Projekt-Stack",
    "und die Struktur. Erfinde keine Fakten.",
    "Antworte AUSSCHLIESSLICH mit JSON in genau diesem Format — keine Erklärung,",
    "keine Code-Fences:",
    '{"sessions":[{"title":"kurzer Titel","prompt":"vollständiger, umsetzbarer Prompt"}]}',
    "Behalte die Sprache des Nutzers bei (in der Regel Deutsch).",
    "",
    "=== PROJEKT-KONTEXT (JSON) ===",
    context,
  ].join("\n");

  const res = await client.responses.create({
    model,
    instructions,
    input: `Große Aufgabe des Nutzers:\n${rawPrompt}`,
  });

  const sessions = parseSplitResponse(res.output_text ?? "");
  // Fallback: never return nothing — at worst run the original prompt once.
  return sessions.length ? sessions : [{ prompt: rawPrompt.trim() }];
}
