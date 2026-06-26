/**
 * Pure helpers for reading live Claude-Code console output (no I/O).
 *
 * The launcher's PTY sessions keep a raw xterm scrollback buffer (ANSI escapes,
 * cursor moves, spinner overwrites). To let Jarvis "live mitlesen" we turn that
 * raw stream into a compact, readable plain-text tail and attribute it to a
 * stable instance / window number. Kept side-effect free so it is unit-testable
 * and reusable from both the server registry and the Jarvis tool layer.
 */

/** Status of a console, mirrored from the PTY session registry. */
export type ConsoleStatus = "running" | "done" | "error";

/** Lightweight, attributable summary of one Claude console (no output body). */
export interface ConsoleSummary {
  /** Stable, monotonically assigned window/instance number (#1, #2, …). */
  instance: number;
  /** Internal PTY session id (stable too, but opaque). */
  id: string;
  projectName: string;
  status: ConsoleStatus;
  /** The task the console was started with ("" for an empty/interactive box). */
  prompt: string;
  startedAt: number;
}

/** A summary plus a readable tail of the console's live output. */
export interface ConsoleSnapshot extends ConsoleSummary {
  output: string;
  exitCode?: number;
}

// CSI / ANSI escape sequences (colours, cursor moves, clears, …). Starts with
// ESC (\x1b) or the 8-bit CSI introducer (\x9b), then optional params + a final
// byte.
const ANSI_RE =
  /[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-ntqry=><~]/g;
// Stray control chars to drop, but KEEP tab (\x09), newline (\x0a) and carriage
// return (\x0d) — they carry layout meaning we handle separately.
const CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/** Strip ANSI escape sequences and stray control chars from terminal output. */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_RE, "").replace(CTRL_RE, "");
}

/**
 * Turn raw terminal output into readable text: strip ANSI, then collapse
 * carriage-return overwrites within a line (a `\r` returns the cursor to
 * column 0, so the text after the last `\r` is what stays visible — this is how
 * spinners and progress bars render in place).
 */
export function normalizeConsoleText(input: string): string {
  return stripAnsi(input)
    .split("\n")
    .map((line) => {
      if (!line.includes("\r")) return line;
      const segs = line.split("\r");
      return segs[segs.length - 1];
    })
    .join("\n");
}

/**
 * Readable tail of console output, bounded for an LLM context: keep the last
 * `maxLines` lines, then cap to `maxChars` from the end (prefixing an ellipsis
 * when truncated). The end of a console is what matters — newest activity.
 */
export function tailText(input: string, maxLines = 40, maxChars = 4000): string {
  const norm = normalizeConsoleText(input).replace(/\s+$/g, "");
  let lines = norm.split("\n");
  if (lines.length > maxLines) lines = lines.slice(-maxLines);
  let out = lines.join("\n");
  if (out.length > maxChars) out = "…" + out.slice(-maxChars);
  return out;
}

function statusLabel(status: ConsoleStatus): string {
  return status === "running" ? "läuft" : status === "done" ? "fertig" : "Fehler";
}

/** One-line-per-console list for Jarvis to read aloud / reason over. */
export function formatConsoleList(list: ConsoleSummary[]): string {
  if (list.length === 0) return "Keine laufenden Claude-Code-Konsolen.";
  return list
    .map((c) => {
      const task = c.prompt.trim()
        ? c.prompt.trim().replace(/\s+/g, " ").slice(0, 80)
        : "(ohne Prompt)";
      return `#${c.instance} [${statusLabel(c.status)}] ${c.projectName || "?"} — ${task}`;
    })
    .join("\n");
}
