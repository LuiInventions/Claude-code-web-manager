import { describe, it, expect } from "vitest";
import { detectActivity, detectTool, IDLE_MS } from "../session-activity";

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

describe("detectTool — current tool + target", () => {
  it("edit → file basename", () => {
    expect(detectTool("● Edit(app/components/sections/sessions/PixelOfficeView.tsx)")).toEqual({
      tool: "edit",
      detail: "PixelOfficeView.tsx",
    });
  });

  it("read → file basename, strips key + quotes", () => {
    expect(detectTool('● Read(file_path: "lib/sessions.ts")')).toEqual({
      tool: "read",
      detail: "sessions.ts",
    });
  });

  it("bash → the command", () => {
    expect(detectTool("● Bash(npm run build)")).toEqual({ tool: "bash", detail: "npm run build" });
  });

  it("bash → truncates a long command", () => {
    const cmd = "npm run build && npm run test && npm run lint && echo done please";
    expect(detectTool(`● Bash(${cmd})`)?.detail).toHaveLength(40);
  });

  it("search → the pattern", () => {
    const r = detectTool('● Grep(pattern: "useEffect")');
    expect(r?.tool).toBe("search");
    expect(r?.detail).toBe("useEffect");
  });

  it("web → the host", () => {
    expect(detectTool("● WebFetch(https://github.com/foo/bar)")).toEqual({
      tool: "web",
      detail: "github.com",
    });
  });

  it("uses the LAST (most recent) tool near the tail", () => {
    expect(detectTool("● Read(a.ts)\n● Edit(b.ts)")?.detail).toBe("b.ts");
  });

  it("returns undefined when no tool is present", () => {
    expect(detectTool("╭───────────╮\n│ >         │\n╰───────────╯")).toBeUndefined();
  });
});

describe("detectActivity — tool/detail wiring", () => {
  it("attaches tool + detail while running", () => {
    const r = detectActivity(input({ tail: "● Edit(lib/x.ts)" }));
    expect(r.activity).toBe("working");
    expect(r.tool).toBe("edit");
    expect(r.detail).toBe("x.ts");
  });

  it("omits tool/detail once the session is finished", () => {
    const r = detectActivity(input({ status: "done", tail: "● Edit(lib/x.ts)" }));
    expect(r.tool).toBeUndefined();
    expect(r.detail).toBeUndefined();
  });
});
