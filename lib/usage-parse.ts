/**
 * Parses the percentages shown by Claude Code's interactive `/usage` panel.
 *
 * These percentages are the ONLY place the real session-limit utilization is
 * surfaced — the headless `rate_limit_event` carries no `utilization` field — so
 * the launcher scrapes the rendered TUI panel and feeds the result here. The
 * panel renders two windows we care about:
 *
 *   Current session           ████ 48% used   Resets 3:30am (Europe/Berlin)
 *   Current week (all models) ███▌  7% used   Resets Jul 2, 8pm (Europe/Berlin)
 *
 * mapped to `five_hour` and `seven_day` respectively. The panel auto-refreshes,
 * so the captured buffer may contain several (partially redrawn) frames; we take
 * the FIRST well-formed match per window, which is the cleanest complete frame.
 */

export interface ParsedWindow {
  rateLimitType: "five_hour" | "seven_day";
  /** 0..1 fraction of the window consumed. */
  utilization: number;
  /** Human reset string straight from the panel, e.g. "3:30am (Europe/Berlin)". */
  resetLabel: string;
}

export interface ParsedUsage {
  windows: ParsedWindow[];
}

/** Remove ANSI/OSC escape sequences so the panel text is plain. */
function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC … BEL/ST
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI
    .replace(/\x1b[()][0-9A-Za-z]/g, "") // charset selects
    .replace(/\x1b./g, ""); // any stray escape
}

/** Tidy a captured reset label: collapse whitespace, drop trailing noise. */
function cleanLabel(raw: string): string {
  return raw.replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * Pull `<pct>% used Resets <label>` for the section that starts with `heading`.
 * Returns the first well-formed match, or null if the section isn't present.
 */
function matchWindow(
  text: string,
  heading: RegExp,
): { utilization: number; resetLabel: string } | null {
  const re = new RegExp(
    heading.source +
      "[\\s\\S]*?(\\d+)\\s*%\\s*used\\s*Resets\\s*([\\s\\S]*?)(?=Current\\b|What's|Usage credits|[\\r\\n]|$)",
  );
  const m = re.exec(text);
  if (!m) return null;
  const pct = Number(m[1]);
  if (!Number.isFinite(pct)) return null;
  return { utilization: pct / 100, resetLabel: cleanLabel(m[2]) };
}

export function parseUsagePanel(raw: string): ParsedUsage | null {
  const text = stripAnsi(raw);
  const session = matchWindow(text, /Current session/);
  if (!session) return null; // no panel rendered

  const windows: ParsedWindow[] = [
    { rateLimitType: "five_hour", ...session },
  ];
  const week = matchWindow(text, /Current week \(all models\)/);
  if (week) windows.push({ rateLimitType: "seven_day", ...week });

  return { windows };
}
