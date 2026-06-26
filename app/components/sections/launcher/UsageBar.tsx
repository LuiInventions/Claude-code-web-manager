"use client";

import { AlertTriangle } from "lucide-react";
import { cn } from "../../ui";
import type { UsageState, RlWindow } from "@/lib/usage-store";

/**
 * Slim launcher header showing Claude session-limit usage, fed by live
 * `rate_limit_event`s. When a window is rejected (100%), shows a block banner
 * with a countdown to reset. `now` is epoch ms, ticked by the parent.
 */

const LABELS: Record<string, string> = {
  five_hour: "5-Std-Limit",
  seven_day: "Wochenlimit",
};

function label(type: string): string {
  return LABELS[type] ?? type;
}

function fmtReset(ms: number): string {
  if (!ms) return "?";
  const d = new Date(ms);
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(sec).padStart(2, "0")} min`;
}

function barColor(util: number, status: string): string {
  if (status === "rejected" || util >= 0.9) return "bg-danger";
  if (status === "allowed_warning" || util >= 0.75) return "bg-warn";
  return "bg-running";
}

function WindowChip({ win }: { win: RlWindow }) {
  const pct = Math.round(Math.min(1, Math.max(0, win.utilization)) * 100);
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-faint">{label(win.rateLimitType)}</span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-raised">
        <div
          className={cn("h-full rounded-full", barColor(win.utilization, win.status))}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="tabular-nums text-ink">{pct}%</span>
      <span className="text-faint">· Reset {win.resetLabel ?? fmtReset(win.resetsAt)}</span>
    </div>
  );
}

export default function UsageBar({
  usage,
  now,
}: {
  usage: UsageState | null;
  now: number;
}) {
  const blockedUntil =
    usage?.blockedUntil && usage.blockedUntil > now ? usage.blockedUntil : null;
  const windows = usage ? Object.values(usage.windows) : [];

  // Stale = last scrape failed, never ran, or last good data is > 7 min old
  // (two missed 3-min cycles). Drives a dimmed look + an "as of" hint.
  const STALE_MS = 7 * 60_000;
  const stale =
    windows.length > 0 &&
    (!usage?.lastScrapeOk ||
      !usage?.lastScrapeAt ||
      now - usage.lastScrapeAt > STALE_MS);

  if (blockedUntil) {
    return (
      <div className="flex items-center gap-2 border-b border-danger/30 bg-danger/10 px-4 py-2 text-xs">
        <AlertTriangle className="size-3.5 text-danger" />
        <span className="font-medium text-danger">
          Claude nicht verfügbar bis {fmtReset(blockedUntil)} · noch{" "}
          {fmtCountdown(blockedUntil - now)}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-elevated px-4 py-2 text-xs">
      <span className="font-medium uppercase tracking-wide text-faint">
        Session-Limit
      </span>
      {windows.length ? (
        <>
          <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", stale && "opacity-50")}>
            {windows
              .sort((a, b) => a.rateLimitType.localeCompare(b.rateLimitType))
              .map((w) => (
                <WindowChip key={w.rateLimitType} win={w} />
              ))}
          </div>
          {stale && usage?.lastScrapeAt ? (
            <span className="text-warn">veraltet · Stand {fmtReset(usage.lastScrapeAt)}</span>
          ) : null}
        </>
      ) : (
        <span className="text-faint">noch keine Daten (erscheint beim ersten Run)</span>
      )}
    </div>
  );
}
