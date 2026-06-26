import { describe, it, expect } from "vitest";
import {
  applyRateLimit,
  applyScrapedUsage,
  isBlocked,
  isStale,
  emptyUsage,
} from "../usage-store";

const NOW = 1_700_000_000_000; // fixed epoch ms for deterministic tests

describe("applyRateLimit", () => {
  it("records a window and converts resetsAt from seconds to ms", () => {
    const s = applyRateLimit(emptyUsage(), {
      status: "allowed_warning",
      resetsAt: 1782410400,
      rateLimitType: "seven_day",
      utilization: 0.81,
      surpassedThreshold: 0.75,
      isUsingOverage: false,
    }, NOW);
    const w = s.windows.seven_day;
    expect(w.utilization).toBe(0.81);
    expect(w.resetsAt).toBe(1782410400 * 1000);
    expect(w.status).toBe("allowed_warning");
    expect(s.blockedUntil).toBeUndefined();
  });

  it("keeps separate windows per rateLimitType", () => {
    let s = applyRateLimit(emptyUsage(), {
      status: "allowed", resetsAt: 1782410400, rateLimitType: "seven_day", utilization: 0.4,
    }, NOW);
    s = applyRateLimit(s, {
      status: "allowed_warning", resetsAt: 1700001000, rateLimitType: "five_hour", utilization: 0.9,
    }, NOW);
    expect(Object.keys(s.windows).sort()).toEqual(["five_hour", "seven_day"]);
    expect(s.windows.five_hour.utilization).toBe(0.9);
  });

  it("sets blockedUntil when a window is rejected with a future reset", () => {
    const resetSec = Math.floor(NOW / 1000) + 3600; // 1h ahead
    const s = applyRateLimit(emptyUsage(), {
      status: "rejected", resetsAt: resetSec, rateLimitType: "five_hour", utilization: 1,
    }, NOW);
    expect(s.blockedUntil).toBe(resetSec * 1000);
    expect(isBlocked(s, NOW).blocked).toBe(true);
    expect(isBlocked(s, resetSec * 1000 + 1).blocked).toBe(false);
  });

  it("ignores malformed events", () => {
    const base = emptyUsage();
    expect(applyRateLimit(base, null, NOW)).toBe(base);
    expect(applyRateLimit(base, { utilization: 0.5 }, NOW)).toBe(base); // no type/status
  });
});

const SCRAPE = {
  windows: [
    { rateLimitType: "five_hour" as const, utilization: 0.48, resetLabel: "3:30am (Europe/Berlin)" },
    { rateLimitType: "seven_day" as const, utilization: 0.07, resetLabel: "Jul 2, 8pm (Europe/Berlin)" },
  ],
};

describe("applyScrapedUsage", () => {
  it("stores utilization and reset label per window and marks the scrape ok", () => {
    const s = applyScrapedUsage(emptyUsage(), SCRAPE, NOW);
    expect(s.windows.five_hour.utilization).toBe(0.48);
    expect(s.windows.five_hour.resetLabel).toBe("3:30am (Europe/Berlin)");
    expect(s.windows.seven_day.utilization).toBe(0.07);
    expect(s.windows.five_hour.updatedAt).toBe(NOW);
    expect(s.lastScrapeAt).toBe(NOW);
    expect(s.lastScrapeOk).toBe(true);
  });

  it("preserves an active block from live rejected events", () => {
    const blocked = { ...emptyUsage(), blockedUntil: NOW + 3_600_000 };
    const s = applyScrapedUsage(blocked, SCRAPE, NOW);
    expect(s.blockedUntil).toBe(NOW + 3_600_000);
  });
});

describe("isStale", () => {
  const MAX = 7 * 60_000; // 7 min
  it("is fresh right after a successful scrape", () => {
    const s = applyScrapedUsage(emptyUsage(), SCRAPE, NOW);
    expect(isStale(s, NOW + 60_000, MAX)).toBe(false);
  });
  it("is stale once data ages past the window", () => {
    const s = applyScrapedUsage(emptyUsage(), SCRAPE, NOW);
    expect(isStale(s, NOW + MAX + 1, MAX)).toBe(true);
  });
  it("is stale when the most recent scrape attempt failed", () => {
    const s = { ...applyScrapedUsage(emptyUsage(), SCRAPE, NOW), lastScrapeOk: false };
    expect(isStale(s, NOW + 1000, MAX)).toBe(true);
  });
  it("is stale when no scrape has ever run", () => {
    expect(isStale(emptyUsage(), NOW, MAX)).toBe(true);
  });
});
