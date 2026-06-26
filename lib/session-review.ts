import { getModel, getOpenAI } from "./openai";

/**
 * Session-Review: turns the launcher's numbered Claude consoles into a
 * Markdown report (what each session worked on / what is still open) plus a
 * short spoken summary. The context builder and the JSON parser are PURE and
 * unit-tested; reviewSessions adds the single LLM call (mirrors prompt-improver).
 */

export interface SessionOutput {
  id: string;
  projectName: string;
  status: "running" | "done" | "error";
  prompt: string;
  /** Readable, already-tailed console output. */
  output: string;
}

/** One session enriched with its stable, UI-matching display number (#1..#N). */
export interface ReviewItem extends SessionOutput {
  number: number;
}

export interface ReviewResult {
  markdown: string;
  speech: string;
}

const STATUS_DE: Record<SessionOutput["status"], string> = {
  running: "läuft",
  done: "fertig",
  error: "Fehler",
};

/** Build the numbered, plain-text LLM context (pure). */
export function buildReviewContext(items: ReviewItem[]): string {
  if (items.length === 0) return "(keine Sessions)";
  return items
    .slice()
    .sort((a, b) => a.number - b.number)
    .map((it) => {
      const task = it.prompt.trim() || "(ohne Prompt / interaktiv)";
      const out = it.output.trim() || "(keine Ausgabe)";
      return [
        `#${it.number} · ${it.projectName || "?"} [${STATUS_DE[it.status]}]`,
        `Auftrag: ${task}`,
        "Output (Auszug):",
        out,
        "---",
      ].join("\n");
    })
    .join("\n");
}

/** Strip a single surrounding ```/```json fence if present. */
function stripFences(s: string): string {
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1].trim() : s;
}

/** Parse the model output into {markdown, speech}; robust fallback (pure). */
export function parseReviewResult(raw: string): ReviewResult {
  const text = raw.trim();
  try {
    const obj = JSON.parse(stripFences(text)) as Partial<ReviewResult>;
    if (typeof obj.markdown === "string" && typeof obj.speech === "string") {
      return { markdown: obj.markdown, speech: obj.speech };
    }
  } catch {
    /* fall through to raw fallback */
  }
  return {
    markdown: text || "_Kein Ergebnis._",
    speech:
      "Der Review ist fertig. Die Zusammenfassung steht im geöffneten Bericht.",
  };
}

const SYSTEM_PROMPT = [
  "Du bist der Review-Assistent im Claude Code Control Center.",
  "Du bekommst den aktuellen Output mehrerer Claude-Code-Sessions, jeweils mit",
  "Nummer (#1, #2 …), Projekt, Status und Auftrag. Fasse für JEDE Session zusammen,",
  "was sie gearbeitet hat und was eventuell noch zu tun ist. Stütze dich NUR auf den",
  "gezeigten Output — erfinde nichts.",
  "",
  "Antworte AUSSCHLIESSLICH als JSON-Objekt mit genau zwei Feldern:",
  '{"markdown": "...", "speech": "..."}',
  '- "markdown": ein deutscher Markdown-Bericht. Pro Session eine Überschrift',
  '  "## Session #N · <Projekt>", darunter kurz "Erledigt:" und "Noch offen:".',
  "  Sauberes Markdown.",
  '- "speech": eine KURZE, natürliche Fassung zum Vorlesen (1–4 Sätze, KEINE',
  "  Markdown-Zeichen, keine Aufzählungssymbole) mit den wichtigsten Punkten.",
  "Gib NUR das JSON zurück, ohne Einleitung und ohne ```-Fences.",
].join("\n");

/** Read all sessions and produce the report + spoken summary (one LLM call). */
export async function reviewSessions(items: ReviewItem[]): Promise<ReviewResult> {
  if (items.length === 0) {
    return {
      markdown: "_Keine Sessions zum Reviewen._",
      speech: "Es gibt aktuell keine Sessions zum Reviewen.",
    };
  }
  const client = getOpenAI();
  const model = getModel();
  const res = await client.responses.create({
    model,
    instructions: SYSTEM_PROMPT,
    input: buildReviewContext(items),
  });
  return parseReviewResult(res.output_text ?? "");
}
