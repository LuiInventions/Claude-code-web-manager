/**
 * Pure, client-safe activity + subagent detection for a live Claude Code PTY
 * session. No I/O, no node imports — importable from both the server registry
 * (lib/server/claude-pty.ts) and "use client" components (via lib/sessions.ts).
 *
 * The launcher runs `claude --dangerously-skip-permissions` in an interactive
 * PTY, so we never get structured stream-json — only the rendered terminal. We
 * derive a coarse-but-useful activity from the readable tail of that output
 * (ANSI already stripped by console-read.normalizeConsoleText) plus how long the
 * stream has been idle. Because permissions are skipped, the meaningful
 * "needs attention" state is the agent having finished its turn and waiting for
 * the user to type — surfaced here as `waiting`.
 *
 * This is intentionally heuristic: it tracks Claude Code's current TUI wording
 * and degrades gracefully to `working` when nothing matches.
 */

export type LiveActivity = "thinking" | "working" | "waiting" | "done" | "error";

export interface DetectedSubagent {
  /** Stable per session: ordinal within the parent's output ("s0", "s1", …). */
  id: string;
  /** Human label — the Task(...) description, or a generic fallback. */
  label: string;
  activity: LiveActivity;
}

export interface ActivitySignal {
  activity: LiveActivity;
  subagents: DetectedSubagent[];
}

/** Idle gap (ms) after which a running-but-silent session counts as waiting. */
export const IDLE_MS = 1200;

/** Max subagents surfaced per session (defensive cap). */
const MAX_SUBAGENTS = 8;

// A tool is being run/printed: the `●` action bullet, the `⎿` result branch, or
// a known tool call `Name(`. Indicates the agent is actively doing work.
const TOOL_RE =
  /(?:^|\n)\s*●\s|⎿|\b(?:Bash|Edit|MultiEdit|Write|Read|Update|Search|Grep|Glob|NotebookEdit|WebFetch|WebSearch|Task)\s*\(/;

// The model is generating: the spinner glyphs, the "esc to interrupt" hint, or
// one of Claude Code's "Thinking/Pondering/…" status verbs.
const THINKING_RE =
  /(?:esc to interrupt|✻|✳|✢|✶|✽|Thinking|Pondering|Cogitating|Reticulating|Spelunking|Ruminating|Noodling|[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏])/i;

// In-session subagents spawned via the Task tool.
const SUBAGENT_RE = /Task\(([^)]*)\)/g;

/** Coarse activity + subagents for one session, from its readable output tail. */
export function detectActivity(opts: {
  /** Readable (ANSI-stripped) tail of the session output. */
  tail: string;
  status: "running" | "done" | "error";
  /** ms timestamp of the last byte received from the PTY. */
  lastDataAtMs: number;
  /** ms timestamp "now" (injected for testability). */
  now: number;
}): ActivitySignal {
  const { tail, status, lastDataAtMs, now } = opts;

  // Exit code is authoritative once the process is gone — no live subagents.
  if (status === "done") return { activity: "done", subagents: [] };
  if (status === "error") return { activity: "error", subagents: [] };

  const idle = now - lastDataAtMs >= IDLE_MS;

  let activity: LiveActivity;
  if (TOOL_RE.test(tail)) activity = "working";
  else if (THINKING_RE.test(tail)) activity = "thinking";
  else if (idle) activity = "waiting";
  else activity = "working";

  return { activity, subagents: detectSubagents(tail) };
}

function detectSubagents(tail: string): DetectedSubagent[] {
  const matches = [...tail.matchAll(SUBAGENT_RE)];
  return matches.slice(0, MAX_SUBAGENTS).map((m, i) => {
    const start = m.index ?? 0;
    const next = matches[i + 1]?.index ?? tail.length;
    const block = tail.slice(start, next);
    // A `⎿ … done/✓/N tokens` line after the dispatch marks the subagent done.
    const done = /⎿[^\n]*(?:done|Done|✓|tokens)/.test(block);
    const label = (m[1] || "").trim().replace(/\s+/g, " ") || "subagent";
    return { id: `s${i}`, label, activity: done ? "done" : "working" };
  });
}
