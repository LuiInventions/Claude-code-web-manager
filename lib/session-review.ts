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

const SPEECH_SYSTEM_PROMPT = [
  "Du bist der Review-Assistent im Claude Code Control Center.",
  "Fasse den Stand ALLER Sessions in 1–4 natürlichen deutschen Sätzen zusammen.",
  "Keine Markdown-Zeichen, keine Aufzählungssymbole, keine Anführungszeichen.",
  "Gib NUR den gesprochenen Text zurück — sonst nichts.",
].join("\n");

const MARKDOWN_SYSTEM_PROMPT = [
  "Du bist der Review-Assistent im Claude Code Control Center.",
  "Erstelle einen übersichtlichen deutschen Markdown-Bericht über alle Sessions.",
  "Stütze dich NUR auf den gezeigten Output — erfinde nichts.",
  "",
  "FORMAT (genau einhalten):",
  "Für jede Session eine Sektion:",
  "",
  "## Session #N · <Projektname>",
  "",
  "> <Emoji> **<Status>** — <Projektname>",
  "",
  "### ✅ Erledigt",
  "- Punkt 1",
  "- Punkt 2",
  "",
  "### 🔲 Noch offen",
  "- Punkt 1",
  "*(oder: Keine offenen Punkte.)*",
  "",
  "---",
  "",
  "Status-Emojis: ✅ fertig | ⏳ läuft | ❌ Fehler",
  "Gib ausschließlich den Markdown-Text zurück, ohne Einleitung und ohne ```-Fences.",
].join("\n");

/** Generate just the spoken summary (fast, streamed first to the client). */
export async function generateSpeechSummary(items: ReviewItem[]): Promise<string> {
  if (items.length === 0) {
    return "Es gibt aktuell keine Sessions zum Reviewen.";
  }
  const client = getOpenAI();
  const model = getModel();
  const res = await client.responses.create({
    model,
    instructions: SPEECH_SYSTEM_PROMPT,
    input: buildReviewContext(items),
  });
  const text = (res.output_text ?? "").trim();
  return text || "Der Review ist abgeschlossen.";
}

/** Generate the detailed Markdown report. */
export async function generateMarkdownReport(items: ReviewItem[]): Promise<string> {
  if (items.length === 0) {
    return "_Keine Sessions zum Reviewen._";
  }
  const client = getOpenAI();
  const model = getModel();
  const res = await client.responses.create({
    model,
    instructions: MARKDOWN_SYSTEM_PROMPT,
    input: buildReviewContext(items),
  });
  const text = stripFences((res.output_text ?? "").trim());
  return text || "_Kein Ergebnis._";
}

/** Read all sessions and produce the report + spoken summary (two parallel LLM calls). */
export async function reviewSessions(items: ReviewItem[]): Promise<ReviewResult> {
  if (items.length === 0) {
    return {
      markdown: "_Keine Sessions zum Reviewen._",
      speech: "Es gibt aktuell keine Sessions zum Reviewen.",
    };
  }
  const [speech, markdown] = await Promise.all([
    generateSpeechSummary(items),
    generateMarkdownReport(items),
  ]);
  return { markdown, speech };
}
