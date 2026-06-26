import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseResetLabel, parseUsagePanel } from "../usage-parse";

const fixture = readFileSync(
  join(__dirname, "fixtures", "usage-panel.txt"),
  "utf8",
);

describe("parseUsagePanel", () => {
  it("extracts five_hour and seven_day utilization from a real /usage capture", () => {
    const parsed = parseUsagePanel(fixture);
    expect(parsed).not.toBeNull();
    const byType = Object.fromEntries(
      parsed!.windows.map((w) => [w.rateLimitType, w]),
    );
    expect(byType.five_hour.utilization).toBeCloseTo(0.48, 2);
    expect(byType.seven_day.utilization).toBeCloseTo(0.07, 2);
  });

  it("captures the human reset label for display", () => {
    const parsed = parseUsagePanel(fixture);
    const byType = Object.fromEntries(
      parsed!.windows.map((w) => [w.rateLimitType, w]),
    );
    expect(byType.five_hour.resetLabel).toContain("3:30am");
    expect(byType.seven_day.resetLabel).toContain("Jul 2, 8pm");
  });

  it("parses a clean synthetic panel exactly", () => {
    const clean =
      "Current session ████ 92% used Resets 9:00pm (Europe/Berlin)" +
      "Current week (all models) ██ 33% used Resets Jul 5, 8pm (Europe/Berlin)" +
      "What's contributing to your limits usage?";
    const parsed = parseUsagePanel(clean);
    const byType = Object.fromEntries(
      parsed!.windows.map((w) => [w.rateLimitType, w]),
    );
    expect(byType.five_hour.utilization).toBe(0.92);
    expect(byType.five_hour.resetLabel).toBe("9:00pm (Europe/Berlin)");
    expect(byType.seven_day.utilization).toBe(0.33);
    expect(byType.seven_day.resetLabel).toBe("Jul 5, 8pm (Europe/Berlin)");
  });

  it("returns null when the session percentage is absent", () => {
    expect(parseUsagePanel("just some boot noise, no panel here")).toBeNull();
    expect(parseUsagePanel("")).toBeNull();
  });
});

describe("parseResetLabel", () => {
  // Fixed anchor: 26 Jun 2026, 12:00 UTC. Europe/Berlin is UTC+2 (CEST) here.
  const NOW = Date.UTC(2026, 5, 26, 12, 0, 0);

  it("rolls a past time-only label to tomorrow in its timezone", () => {
    // 03:30 CEST today = 01:30 UTC, already past NOW → next day.
    expect(parseResetLabel("3:30am (Europe/Berlin)", NOW)).toBe(
      Date.UTC(2026, 5, 27, 1, 30),
    );
  });

  it("keeps a still-future time-only label on the same day", () => {
    // 21:00 CEST today = 19:00 UTC, still ahead of NOW.
    expect(parseResetLabel("9:00pm (Europe/Berlin)", NOW)).toBe(
      Date.UTC(2026, 5, 26, 19, 0),
    );
  });

  it("resolves a dated label to that calendar day in its timezone", () => {
    // Jul 2, 20:00 CEST = 18:00 UTC.
    expect(parseResetLabel("Jul 2, 8pm (Europe/Berlin)", NOW)).toBe(
      Date.UTC(2026, 6, 2, 18, 0),
    );
  });

  it("handles 12am (midnight) correctly", () => {
    // 00:00 CEST today = 25 Jun 22:00 UTC, past → next midnight = 26 Jun 22:00 UTC.
    expect(parseResetLabel("12am (Europe/Berlin)", NOW)).toBe(
      Date.UTC(2026, 5, 26, 22, 0),
    );
  });

  it("returns null for an unparseable label", () => {
    expect(parseResetLabel("soon", NOW)).toBeNull();
    expect(parseResetLabel("", NOW)).toBeNull();
  });
});
