import { describe, it, expect } from "vitest";
import {
  stripAnsi,
  normalizeConsoleText,
  tailText,
  formatConsoleList,
  type ConsoleSummary,
} from "../console-read";

describe("stripAnsi", () => {
  it("removes SGR colour codes", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });
  it("removes cursor-move / clear sequences", () => {
    expect(stripAnsi("a\x1b[2K\x1b[1Gb")).toBe("ab");
  });
  it("drops stray control chars but keeps tab/newline/CR", () => {
    expect(stripAnsi("a\x07b\tc\nd\re")).toBe("ab\tc\nd\re");
  });
  it("leaves plain text untouched", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });
});

describe("normalizeConsoleText", () => {
  it("collapses carriage-return overwrites (spinners/progress)", () => {
    // A spinner that rewrites the same line should leave only the final state.
    expect(normalizeConsoleText("Working /\rWorking |\rDone")).toBe("Done");
  });
  it("keeps real newlines as separate lines", () => {
    expect(normalizeConsoleText("line1\nline2")).toBe("line1\nline2");
  });
  it("strips ANSI before collapsing", () => {
    expect(normalizeConsoleText("\x1b[32mok\x1b[0m\nnext")).toBe("ok\nnext");
  });
});

describe("tailText", () => {
  it("keeps only the last maxLines lines", () => {
    const input = Array.from({ length: 100 }, (_, i) => `L${i}`).join("\n");
    const out = tailText(input, 5);
    expect(out.split("\n")).toEqual(["L95", "L96", "L97", "L98", "L99"]);
  });
  it("caps the total length, keeping the END", () => {
    const out = tailText("x".repeat(10_000), 1000, 100);
    expect(out.length).toBeLessThanOrEqual(101); // leading ellipsis + 100
    expect(out.endsWith("x")).toBe(true);
  });
  it("trims trailing blank lines", () => {
    expect(tailText("done\n\n\n")).toBe("done");
  });
});

describe("formatConsoleList", () => {
  const base: Omit<ConsoleSummary, "instance" | "status" | "prompt"> = {
    id: "c_1",
    projectName: "jarvis",
    startedAt: 0,
  };
  it("reports the empty case", () => {
    expect(formatConsoleList([])).toMatch(/keine/i);
  });
  it("numbers consoles by instance with status + task", () => {
    const out = formatConsoleList([
      { ...base, instance: 1, status: "running", prompt: "fix the login bug" },
      { ...base, instance: 2, status: "done", prompt: "" },
    ]);
    expect(out).toMatch(/#1/);
    expect(out).toMatch(/läuft/);
    expect(out).toMatch(/fix the login bug/);
    expect(out).toMatch(/#2/);
    expect(out).toMatch(/fertig/);
  });
});
