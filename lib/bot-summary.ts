/**
 * Bot work-summary layer.
 *
 * Turns the launcher's Claude Code sessions (the "bots") into a structured
 * overview — what they finished, what is still running, what is still open —
 * plus a Markdown rendering for display and a short spoken sentence for TTS.
 *
 * Everything here is PURE (no I/O), so it is unit-testable in isolation. The
 * server-side collector that pulls live + persisted sessions lives next door in
 * `lib/server/bot-collect.ts`; the Jarvis tool wiring lives in `lib/jarvis.ts`.
 */

export type BotRunStatus = "running" | "done" | "error" | "stopped";

/** One normalized bot run, merged from a live PTY session or persisted history. */
export interface BotRun {
  id: string;
  projectName: string;
  prompt: string;
  status: BotRunStatus;
  startedAt: number;
  endedAt?: number;
  model?: string;
  result?: string;
  origin?: "github";
  repoFullName?: string;
}

/** A bot run enriched with its stable 1-based instance number. */
export interface BotTask extends BotRun {
  instance: number;
}

/** Structured overview bucketed by erledigt / in Arbeit / offen. */
export interface BotSummary {
  /** erledigt — finished cleanly (exit 0). */
  done: BotTask[];
  /** in Arbeit — still running. */
  inProgress: BotTask[];
  /** offen — error or stopped, still needs attention. */
  open: BotTask[];
  /** All involved instance numbers, ascending. */
  instances: number[];
  total: number;
  generatedAt: number;
}

/**
 * Drop runs sharing an id, keeping the FIRST occurrence. Callers pass live
 * sessions before persisted history so the live (current) state wins.
 */
export function dedupeBotRuns(runs: BotRun[]): BotRun[] {
  const seen = new Set<string>();
  const out: BotRun[] = [];
  for (const r of runs) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/**
 * Build the structured overview. Instances are numbered chronologically
 * (earliest start = Instanz 1); equal start times break stably over the id so
 * the numbering is deterministic.
 */
export function summarizeBots(runs: BotRun[], now: number): BotSummary {
  const ordered = runs
    .slice()
    .sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const tasks: BotTask[] = ordered.map((r, i) => ({ ...r, instance: i + 1 }));

  return {
    done: tasks.filter((t) => t.status === "done"),
    inProgress: tasks.filter((t) => t.status === "running"),
    open: tasks.filter((t) => t.status === "error" || t.status === "stopped"),
    instances: tasks.map((t) => t.instance),
    total: tasks.length,
    generatedAt: now,
  };
}

/** Shorten a prompt for one-line display; empty prompts read as interactive. */
function promptLabel(prompt: string): string {
  const p = prompt.trim();
  if (!p) return "(interaktiv, kein Auftrag)";
  return p.length > 80 ? `${p.slice(0, 79)}…` : p;
}

function openReason(status: BotRunStatus): string {
  if (status === "error") return "Fehler";
  if (status === "stopped") return "gestoppt";
  return "offen";
}

function line(t: BotTask, suffix = ""): string {
  return `- **Instanz ${t.instance}** · ${t.projectName} — ${promptLabel(t.prompt)}${suffix}`;
}

/** Render the overview as a Markdown document for display or saving as `.md`. */
export function botSummaryToMarkdown(summary: BotSummary): string {
  const parts: string[] = ["# Bot-Übersicht", ""];

  if (summary.total === 0) {
    parts.push("_Aktuell keine Bots aktiv und nichts zu berichten._");
    return parts.join("\n");
  }

  const d = summary.done.length;
  const r = summary.inProgress.length;
  const o = summary.open.length;
  parts.push(`_Gesamt ${summary.total} · ${d} erledigt · ${r} in Arbeit · ${o} offen_`, "");

  parts.push("## Erledigt");
  parts.push(summary.done.length ? summary.done.map((t) => line(t)).join("\n") : "_Nichts erledigt._");
  parts.push("");

  parts.push("## In Arbeit");
  parts.push(
    summary.inProgress.length
      ? summary.inProgress.map((t) => line(t)).join("\n")
      : "_Nichts in Arbeit._",
  );
  parts.push("");

  parts.push("## Offen");
  parts.push(
    summary.open.length
      ? summary.open.map((t) => line(t, ` (${openReason(t.status)})`)).join("\n")
      : "_Nichts offen._",
  );

  return parts.join("\n");
}

function count(n: number, singular: string, plural: string): string {
  return `${n === 1 ? "eine" : n} ${n === 1 ? singular : plural}`;
}

/** A short German sentence for TTS — no Markdown, voice-friendly. */
export function botSummaryToSpeech(summary: BotSummary): string {
  if (summary.total === 0) {
    return "Es gibt aktuell keine Bot-Aktivität — nichts erledigt, nichts in Arbeit, nichts offen.";
  }
  const d = summary.done.length;
  const r = summary.inProgress.length;
  const o = summary.open.length;
  const erledigt = `${count(d, "Aufgabe", "Aufgaben")} erledigt`;
  const arbeit = r === 1 ? "eine läuft noch" : `${r} laufen noch`;
  const offen = o === 1 ? "eine ist offen" : `${o} sind offen`;
  return `Die Bots haben ${erledigt}, ${arbeit} und ${offen}.`;
}
