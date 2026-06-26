import { readJson, writeJson } from "./store";
import { parseResetLabel, type ParsedUsage } from "./usage-parse";

/**
 * Tracks Claude Code usage/rate-limit state, fed by `rate_limit_event`s from the
 * headless launcher runs (the same data that powers `/usage`). Persisted to
 * `.data/usage.json`. All timestamps are epoch milliseconds.
 *
 * A `rate_limit_info` event looks like:
 *   { status: "allowed"|"allowed_warning"|"rejected", resetsAt: <unix seconds>,
 *     rateLimitType: "five_hour"|"seven_day", utilization: 0..1,
 *     isUsingOverage: bool, surpassedThreshold: 0..1 }
 * Events only fire when a threshold is crossed, so we keep the latest seen state
 * per window and surface that.
 */

export interface RlWindow {
  rateLimitType: string;
  status: string;
  /** 0..1 fraction of the window consumed. */
  utilization: number;
  /** Epoch ms when this window resets. */
  resetsAt: number;
  /** Human reset string scraped from `/usage`, e.g. "3:30am (Europe/Berlin)". */
  resetLabel?: string;
  surpassedThreshold?: number;
  isUsingOverage?: boolean;
  /** Epoch ms this window was last updated. */
  updatedAt: number;
}

export interface UsageState {
  windows: Record<string, RlWindow>;
  /** Epoch ms until which Claude is unavailable (set when a window is rejected). */
  blockedUntil?: number;
  /** Epoch ms of the last update. */
  updatedAt: number;
  /** Epoch ms of the last successful `/usage` scrape (utilization source). */
  lastScrapeAt?: number;
  /** Whether the most recent scrape attempt succeeded. */
  lastScrapeOk?: boolean;
}

const FILE = "usage.json";

export function emptyUsage(): UsageState {
  return { windows: {}, updatedAt: 0 };
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Pure reducer: merge a raw `rate_limit_info` object into the usage state.
 * Returns a new state (does not mutate). `nowMs` is the current epoch-ms clock.
 */
export function applyRateLimit(
  state: UsageState,
  info: unknown,
  nowMs: number,
): UsageState {
  if (!info || typeof info !== "object") return state;
  const o = info as Record<string, unknown>;
  const rateLimitType =
    typeof o.rateLimitType === "string" ? o.rateLimitType : undefined;
  const status = typeof o.status === "string" ? o.status : undefined;
  const resetsAtSec = num(o.resetsAt);
  if (!rateLimitType || !status) return state;

  const win: RlWindow = {
    rateLimitType,
    status,
    utilization: num(o.utilization) ?? 0,
    resetsAt: resetsAtSec !== undefined ? resetsAtSec * 1000 : 0,
    surpassedThreshold: num(o.surpassedThreshold),
    isUsingOverage:
      typeof o.isUsingOverage === "boolean" ? o.isUsingOverage : undefined,
    updatedAt: nowMs,
  };

  const windows = { ...state.windows, [rateLimitType]: win };

  // Blocked until the latest future reset among rejected windows.
  let blockedUntil: number | undefined;
  for (const w of Object.values(windows)) {
    if (w.status === "rejected" && w.resetsAt > nowMs) {
      blockedUntil = Math.max(blockedUntil ?? 0, w.resetsAt);
    }
  }

  return { windows, blockedUntil, updatedAt: nowMs };
}

/**
 * Pure reducer: merge a scraped `/usage` result (utilization + reset labels)
 * into the usage state. Rebuilds the windows from the scrape — the only source
 * of real utilization — while preserving any active `blockedUntil` set by live
 * rejected `rate_limit_event`s. The human reset label is also parsed into an
 * absolute `resetsAt` epoch-ms instant so the UI can show a real date/countdown.
 * Marks the scrape successful.
 */
export function applyScrapedUsage(
  state: UsageState,
  parsed: ParsedUsage,
  nowMs: number,
): UsageState {
  const windows: Record<string, RlWindow> = { ...state.windows };
  for (const w of parsed.windows) {
    const prev = state.windows[w.rateLimitType];
    const resetsAt = parseResetLabel(w.resetLabel, nowMs) ?? prev?.resetsAt ?? 0;
    windows[w.rateLimitType] = {
      rateLimitType: w.rateLimitType,
      status: prev?.status ?? "allowed",
      utilization: w.utilization,
      resetsAt,
      resetLabel: w.resetLabel,
      updatedAt: nowMs,
    };
  }
  return {
    ...state,
    windows,
    updatedAt: nowMs,
    lastScrapeAt: nowMs,
    lastScrapeOk: true,
  };
}

/** Pure: mark the most recent scrape attempt as failed (keeps last good data). */
export function markStale(state: UsageState): UsageState {
  return { ...state, lastScrapeOk: false };
}

/**
 * Whether the displayed usage is stale: the last scrape failed, never ran, or
 * the last good data is older than `maxAgeMs`.
 */
export function isStale(
  state: UsageState,
  nowMs: number,
  maxAgeMs: number,
): boolean {
  if (!state.lastScrapeAt) return true;
  if (state.lastScrapeOk === false) return true;
  return nowMs - state.lastScrapeAt > maxAgeMs;
}

/** Record a scraped `/usage` result and persist. Returns the new state. */
export function recordScrapedUsage(parsed: ParsedUsage): UsageState {
  const next = applyScrapedUsage(readUsage(), parsed, Date.now());
  writeJson(FILE, next);
  return next;
}

/** Mark a failed scrape attempt and persist. Returns the new state. */
export function markUsageStale(): UsageState {
  const next = markStale(readUsage());
  writeJson(FILE, next);
  return next;
}

/** Whether Claude is currently blocked, and until when (epoch ms). */
export function isBlocked(
  state: UsageState,
  nowMs: number,
): { blocked: boolean; until?: number } {
  if (state.blockedUntil && state.blockedUntil > nowMs)
    return { blocked: true, until: state.blockedUntil };
  return { blocked: false };
}

/** Record a live `rate_limit_info` event and persist. Returns the new state. */
export function recordRateLimit(info: unknown): UsageState {
  const next = applyRateLimit(readUsage(), info, Date.now());
  writeJson(FILE, next);
  return next;
}

function readUsage(): UsageState {
  return readJson<UsageState>(FILE, emptyUsage());
}

/** Current usage state with an expired block cleared. */
export function getUsage(): UsageState {
  const state = readUsage();
  if (state.blockedUntil && state.blockedUntil <= Date.now()) {
    return { ...state, blockedUntil: undefined };
  }
  return state;
}
