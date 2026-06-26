import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseUsagePanel } from "../usage-parse";

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
