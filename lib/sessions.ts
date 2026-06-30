/**
 * Pure, client-safe helpers for the Sessions tab's pixel-office visualization.
 * No node imports, so this is importable from "use client" components. The data
 * comes from /api/launcher/live-sessions, which lists the launcher's live Claude
 * Code PTY sessions; each one gets a stable visual identity here so a session
 * keeps the same character/colour across refreshes.
 *
 * The office is a native re-creation of the upstream project's design:
 *   - pixel-agents — https://github.com/pixel-agents-hq/pixel-agents
 */

import type { LiveActivity, DetectedSubagent, ToolKind } from "./session-activity";
import { numberInstances } from "./window-instances";

export type { LiveActivity, DetectedSubagent, ToolKind } from "./session-activity";

export type SessionStatus = "running" | "done" | "error";

/** A live launcher session as returned by /api/launcher/live-sessions. */
export interface VisualSession {
  id: string;
  projectName: string;
  prompt: string;
  status: SessionStatus;
  /** Process exit code once finished (present on done/error). */
  exitCode?: number;
  model?: string;
  effort?: string;
  origin?: "github";
  repoFullName?: string;
  startedAt: number;
  /** KI-Modus splits share a batchId; groups them at the office's Meeting Room table. */
  batchId?: string;
  /** Rich live activity parsed server-side from the output tail. */
  activity?: LiveActivity;
  /** Coarse category of the tool the agent is currently running. */
  tool?: ToolKind;
  /** Short target of that tool: file basename / search pattern / command / host. */
  detail?: string;
  /** In-session subagents (Task tool) detected server-side. */
  subagents?: DetectedSubagent[];
  /** ms timestamp of the last output byte. */
  lastActivityAt?: number;
}

/** Coarse activity derived from status — kept for back-compat. */
export type Activity = "working" | "done" | "error";

export function statusActivity(status: SessionStatus): Activity {
  if (status === "running") return "working";
  if (status === "error") return "error";
  return "done";
}

/**
 * Rich activity for a session: prefers the server-parsed live activity, falling
 * back to the coarse status (older payloads / before the first parse tick).
 */
export function sessionActivity(
  s: Pick<VisualSession, "status" | "activity">,
): LiveActivity {
  if (s.activity) return s.activity;
  if (s.status === "running") return "working";
  if (s.status === "error") return "error";
  return "done";
}

/** Whether a session is asking for the user's attention (≈ needs approval). */
export function needsAttention(s: Pick<VisualSession, "status" | "activity">): boolean {
  return sessionActivity(s) === "waiting";
}

/** Character/node palette — distinct hues, readable on the dark theme. */
export const CHARACTER_COLORS = [
  "#6aa6ff",
  "#ff8e6a",
  "#7ad98f",
  "#c792ea",
  "#ffd166",
  "#4dd0e1",
  "#f06292",
  "#a3e635",
  "#fca5a5",
  "#38bdf8",
] as const;

/** FNV-1a hash of a string → non-negative 32-bit int (stable, deterministic). */
export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic 0..count-1 index for a session id (same across renders). */
export function avatarIndex(id: string, count: number): number {
  if (count <= 0) return 0;
  return hashId(id) % count;
}

/** Deterministic character/node colour for a session id. */
export function sessionColor(id: string): string {
  return CHARACTER_COLORS[avatarIndex(id, CHARACTER_COLORS.length)];
}

/** Number of distinct hand-drawn character looks (hair/skin/shirt) in the office. */
export const CHARACTER_VARIANTS = 6;

/** Deterministic 0..5 character look for a session id (stable across renders). */
export function avatarVariant(id: string): number {
  return avatarIndex(id, CHARACTER_VARIANTS);
}

/**
 * Stable, unique 1-based number per session — identical to the Launcher's
 * numbering (oldest = #1). Keyed on `startedAt` (the PTY spawn time, the
 * analogue of the Launcher's `createdAt`), ties broken by id, so a session shows
 * the SAME #N in the Launcher and the Sessions office. Delegates to the shared
 * `numberInstances` so the two stay in lock-step. Returns a Map id → number.
 */
export function numberSessions(sessions: VisualSession[]): Map<string, number> {
  return new Map(
    numberInstances(
      sessions.map((s) => ({
        id: s.id,
        kind: "claude" as const,
        label: s.projectName,
        createdAt: s.startedAt,
      })),
    ).map((n) => [n.instance.id, n.number]),
  );
}

/** Human label for a session (project name, falling back to a generic term). */
export function sessionLabel(s: Pick<VisualSession, "projectName">): string {
  return s.projectName?.trim() || "session";
}

export interface SessionGroup {
  /** Group key: "b:<batchId>" for KI-Modus batches, "s:<id>" for singletons. */
  key: string;
  /** True when this group is a multi-session KI-Modus batch. */
  isBatch: boolean;
  sessions: VisualSession[];
}

/**
 * Group sessions by batchId (KI-Modus splits share one), preserving first-seen
 * order. Sessions without a batchId become their own singleton group. Used by
 * the office to seat each multi-session batch around its own Meeting Room table.
 */
export function groupByBatch(sessions: VisualSession[]): SessionGroup[] {
  const map = new Map<string, VisualSession[]>();
  const order: string[] = [];
  for (const s of sessions) {
    const batch = s.batchId?.trim();
    const key = batch ? `b:${batch}` : `s:${s.id}`;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(s);
  }
  return order.map((key) => {
    const grouped = map.get(key)!;
    return { key, isBatch: key.startsWith("b:") && grouped.length > 1, sessions: grouped };
  });
}
