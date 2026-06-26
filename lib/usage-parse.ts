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

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Wall-clock components of `utcMs` as seen in IANA `tz` (or the host's local tz). */
function tzParts(
  utcMs: number,
  tz: string | undefined,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  if (!tz) {
    const d = new Date(utcMs);
    return {
      year: d.getFullYear(), month: d.getMonth(), day: d.getDate(),
      hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(),
    };
  }
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const m: Record<string, number> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) {
    if (p.type !== "literal") m[p.type] = Number(p.value);
  }
  return {
    year: m.year, month: m.month - 1, day: m.day,
    hour: m.hour === 24 ? 0 : m.hour, minute: m.minute, second: m.second,
  };
}

/**
 * Epoch ms for a wall-clock time in `tz` (or local when tz is undefined). Day
 * overflow rolls forward (Date.UTC handles it). Iterates twice so the result is
 * correct across DST offset changes.
 */
function zonedTimeToUtc(
  year: number, month: number, day: number,
  hour: number, minute: number, tz: string | undefined,
): number {
  if (!tz) return new Date(year, month, day, hour, minute).getTime();
  const wallUtc = Date.UTC(year, month, day, hour, minute);
  let utc = wallUtc;
  for (let i = 0; i < 2; i++) {
    const p = tzParts(utc, tz);
    const seenAsUtc = Date.UTC(p.year, p.month, p.day, p.hour, p.minute, p.second);
    const offset = seenAsUtc - utc; // how far tz is ahead of UTC at this instant
    utc = wallUtc - offset;
  }
  return utc;
}

/**
 * Convert a scraped `/usage` reset label into an absolute epoch-ms instant.
 * The panel surfaces two shapes (optionally suffixed with an IANA "(tz)"):
 *   "3:30am (Europe/Berlin)"     → next occurrence of that wall-clock time
 *   "Jul 2, 8pm (Europe/Berlin)" → that calendar date (this year, or next)
 * `nowMs` anchors "next occurrence". Returns null if no time can be parsed.
 */
export function parseResetLabel(label: string, nowMs: number): number | null {
  if (!label) return null;
  const tz = label.match(/\(([^)]+)\)/)?.[1]?.trim() || undefined;

  const time = label.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])m/i);
  if (!time) return null;
  let hour = Number(time[1]) % 12;
  const minute = time[2] ? Number(time[2]) : 0;
  if (/p/i.test(time[3])) hour += 12;

  const date = label.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\b/);
  const month = date ? MONTHS[date[1].toLowerCase()] : undefined;
  const day = date ? Number(date[2]) : undefined;

  const now = tzParts(nowMs, tz);

  if (month !== undefined && day !== undefined) {
    let ts = zonedTimeToUtc(now.year, month, day, hour, minute, tz);
    // Tolerate a slightly-past instant (panel lag); only roll a year if clearly past.
    if (ts < nowMs - 24 * 3600_000) {
      ts = zonedTimeToUtc(now.year + 1, month, day, hour, minute, tz);
    }
    return ts;
  }

  // Time-only: today in tz; if that instant already passed, use tomorrow.
  let ts = zonedTimeToUtc(now.year, now.month, now.day, hour, minute, tz);
  if (ts <= nowMs) {
    ts = zonedTimeToUtc(now.year, now.month, now.day + 1, hour, minute, tz);
  }
  return ts;
}
