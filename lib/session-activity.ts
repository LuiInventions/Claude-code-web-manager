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

/** Coarse category of the tool the agent is currently running. */
export type ToolKind = "edit" | "read" | "search" | "bash" | "web" | "task" | "other";

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
  /** Coarse category of the most recent tool near the tail (running only). */
  tool?: ToolKind;
  /** Short human target of that tool: file basename / search pattern / command. */
  detail?: string;
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

// Every tool marker `Name(args)`, captured globally so we can take the LAST
// (most recent) one near the tail to describe what the agent is doing right now.
// The arg group allows one level of nested parens (e.g. `Edit(foo(v2).tsx)`) while
// still stopping at the call's own close paren, so two calls on one line stay split.
const TOOL_CALL_RE =
  /\b(Edit|MultiEdit|Write|NotebookEdit|Read|Grep|Glob|Search|Bash|WebFetch|WebSearch|Task)\(([^()\n]*(?:\([^()\n]*\)[^()\n]*)*)\)/g;

const TOOL_KIND: Record<string, ToolKind> = {
  Edit: "edit",
  MultiEdit: "edit",
  Write: "edit",
  NotebookEdit: "edit",
  Read: "read",
  Grep: "search",
  Glob: "search",
  Search: "search",
  Bash: "bash",
  WebFetch: "web",
  WebSearch: "web",
  Task: "task",
};

/** Last path segment of a file path (handles both / and \ separators). */
function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

/**
 * The first argument of a tool call, cleaned for display. Handles the TUI's
 * `key: "value"` form and bare paths, extracting the quoted value *before* any
 * comma-splitting so filenames containing commas/parens survive, and multi-arg
 * calls (`Edit(file_path: "x", old, new)`) don't leave a dangling quote.
 */
function firstArg(raw: string): string {
  // Drop a leading `key:` label (e.g. `file_path: "…"`) — require a space after
  // the colon so a URL scheme like `https://…` is left intact.
  const s = raw.trim().replace(/^\w+\s*:\s+/, "").trim();
  // A quoted value owns everything up to its matching close quote (commas and
  // parens included) — take that and ignore any trailing args.
  const quoted = s.match(/^["'`]([^"'`]*)["'`]/);
  if (quoted) return quoted[1].trim();
  // Bare value → up to the first comma (drops trailing args of multi-arg calls).
  const comma = s.indexOf(",");
  return (comma >= 0 ? s.slice(0, comma) : s).trim();
}

/** Host of a URL, or the string unchanged when it isn't a URL. */
function hostOf(url: string): string {
  const m = url.match(/^[a-z]+:\/\/([^/]+)/i);
  return m ? m[1] : url;
}

/** Trim a string to at most `n` chars, ending with an ellipsis when cut. */
function shorten(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/**
 * The most recent tool call near the tail, mapped to a coarse kind and a short
 * human-readable target (file basename, search pattern, command, or host).
 * Returns undefined when no tool marker is present.
 */
export function detectTool(tail: string): { tool: ToolKind; detail?: string } | undefined {
  const matches = [...tail.matchAll(TOOL_CALL_RE)];
  const m = matches[matches.length - 1];
  if (!m) return undefined;
  const tool = TOOL_KIND[m[1]] ?? "other";
  const arg = firstArg(m[2] || "");
  if (!arg) return { tool };
  let detail: string;
  if (tool === "edit" || tool === "read") detail = basename(arg);
  else if (tool === "web") detail = hostOf(arg);
  else detail = shorten(arg, 40);
  return { tool, detail };
}

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

  const tool = detectTool(tail);
  return { activity, subagents: detectSubagents(tail), tool: tool?.tool, detail: tool?.detail };
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
