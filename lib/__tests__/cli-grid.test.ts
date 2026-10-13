import { describe, expect, it } from "vitest";
import { cliGridForBox } from "../cli-grid";

describe("cliGridForBox", () => {
  it("returns null until the pane has been laid out", () => {
    expect(cliGridForBox(0, 0)).toBeNull();
    expect(cliGridForBox(15, 200)).toBeNull();
    expect(cliGridForBox(200, 15)).toBeNull();
  });

  it("fits a short pane instead of the 80 by 24 default", () => {
    const grid = cliGridForBox(320, 120);
    expect(grid).toEqual({
      cols: Math.floor(320 / 8.4),
      rows: Math.floor(120 / 17),
    });
    expect(grid!.cols).toBeLessThan(80);
    expect(grid!.rows).toBeLessThan(24);
  });
});
