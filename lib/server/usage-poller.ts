import { recordScrapedUsage, markUsageStale } from "../usage-store";
import { scrapeUsage } from "./usage-scraper";

/**
 * Background poller that refreshes the launcher's session-limit bar by scraping
 * the `/usage` panel every few minutes (the only source of real utilization).
 * Started once from `server.ts` after Next is ready. A failed scrape marks the
 * stored data stale rather than clobbering the last good values.
 */

const INTERVAL_MS = 3 * 60_000; // 3 minutes

let started = false;
let running = false;

async function tick(): Promise<void> {
  if (running) return; // never overlap scrapes
  running = true;
  try {
    const r = await scrapeUsage();
    if (r.ok) recordScrapedUsage(r.parsed);
    else markUsageStale();
  } catch {
    markUsageStale();
  } finally {
    running = false;
  }
}

/** Start the 3-minute usage poller. Idempotent — safe to call once on boot. */
export function startUsagePoller(): void {
  if (started) return;
  started = true;
  void tick(); // prime immediately so the bar isn't empty on first load
  const timer = setInterval(() => void tick(), INTERVAL_MS);
  timer.unref?.(); // don't keep the process alive on its own
}
