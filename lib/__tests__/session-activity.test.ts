import { describe, it, expect } from "vitest";
import { detectActivity, IDLE_MS } from "../session-activity";

/** Build a detectActivity input with sensible defaults. */
function input(p: Partial<Parameters<typeof detectActivity>[0]> = {}) {
  return {
    tail: "",
    status: "running" as const,
    lastDataAtMs: 1000,
    now: 1000,
    ...p,
  };
}

describe("detectActivity — terminal status wins", () => {
  it("maps a finished (exit 0) session to done", () => {
    const r = detectActivity(input({ status: "done", tail: "● Bash(npm test)" }));
    expect(r.activity).toBe("done");
    expect(r.subagents).toEqual([]);
  });

  it("maps a failed session to error", () => {
    const r = detectActivity(input({ status: "error", tail: "esc to interrupt" }));
    expect(r.activity).toBe("error");
    expect(r.subagents).toEqual([]);
  });
});

describe("detectActivity — running heuristics", () => {
  it("is working when a tool line is the latest output", () => {
    const r = detectActivity(
      input({ tail: "Some output\n● Bash(npm run build)\n  ⎿ running…", now: 1000, lastDataAtMs: 1000 }),
    );
    expect(r.activity).toBe("working");
  });

  it("is thinking on the spinner / 'esc to interrupt' line with no tool", () => {
    const r = detectActivity(
      input({ tail: "✻ Thinking…\n  (esc to interrupt)", now: 1000, lastDataAtMs: 1000 }),
    );
    expect(r.activity).toBe("thinking");
  });

  it("prefers working over thinking when a tool is active", () => {
    const r = detectActivity(
      input({ tail: "✻ Thinking…\n● Edit(app/page.tsx)\n  (esc to interrupt)" }),
    );
    expect(r.activity).toBe("working");
  });

  it("is waiting when idle with the input box visible (needs-approval signal)", () => {
    const tail = "All done. What next?\n╭───────────────╮\n│ >             │\n╰───────────────╯";
    const r = detectActivity(input({ tail, lastDataAtMs: 0, now: IDLE_MS + 500 }));
    expect(r.activity).toBe("waiting");
  });

  it("is waiting when output has been idle a while with no busy markers", () => {
    const r = detectActivity(input({ tail: "...", lastDataAtMs: 0, now: IDLE_MS + 1 }));
    expect(r.activity).toBe("waiting");
  });

  it("is working when output is fresh and unmarked", () => {
    const r = detectActivity(input({ tail: "writing file contents...", lastDataAtMs: 1000, now: 1100 }));
    expect(r.activity).toBe("working");
  });
});

describe("detectActivity — subagents", () => {
  it("detects a Task() subagent with its label", () => {
    const r = detectActivity(
      input({ tail: "● Task(Explore the codebase for the login flow)\n  ⎿ working…" }),
    );
    expect(r.subagents).toHaveLength(1);
    expect(r.subagents[0].label).toMatch(/Explore the codebase/);
    expect(r.subagents[0].activity).toBe("working");
  });

  it("detects multiple distinct subagents", () => {
    const tail = "● Task(Write tests)\n  ⎿ done\n● Task(Refactor module)\n  ⎿ working…";
    const r = detectActivity(input({ tail }));
    expect(r.subagents.length).toBeGreaterThanOrEqual(2);
    const labels = r.subagents.map((s) => s.label);
    expect(labels.some((l) => /Write tests/.test(l))).toBe(true);
    expect(labels.some((l) => /Refactor module/.test(l))).toBe(true);
  });

  it("gives each subagent a stable, unique id", () => {
    const tail = "● Task(A)\n● Task(B)";
    const ids = detectActivity(input({ tail })).subagents.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns no subagents once the session is finished", () => {
    const r = detectActivity(input({ status: "done", tail: "● Task(A)" }));
    expect(r.subagents).toEqual([]);
  });
});
