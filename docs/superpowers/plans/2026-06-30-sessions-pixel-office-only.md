# Pixel-Office-Only Sessions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Pixel Office the only Sessions visualization — remove the Flow-Graph and all alternatives, enrich the office (rooms/objects/characters, subagents as people, finer activity incl. which file/command), fix numbering to match the Launcher, and release v1.4.0.

**Architecture:** Pure parser (`session-activity.ts`) gains `tool`/`detail`; pure `sessions.ts` gains Launcher-consistent `numberSessions()` + `avatarVariant()`; the server passes the new fields through; the `sessionsView` setting + Flow-Graph + `d3-force` are deleted; `PixelOfficeView.tsx` is rewritten as a multi-room canvas office.

**Tech Stack:** Next.js 15 / React 19, TypeScript, Canvas 2D (hand-drawn pixel art, no assets), vitest, electron-builder.

## Global Constraints

- Version source of truth: `package.json` → bump `1.3.0` → `1.4.0` (verbatim).
- Offline / self-contained: **no third-party sprite assets or engines**; pixel art is hand-drawn `<canvas>` rects only.
- No new alternative visualization — the toggle and `sessionsView` setting are removed, not replaced.
- Dev tooling needs `npm install --include=dev` (global `NODE_ENV=production` + npm `omit=dev` skip devDeps otherwise).
- `npm run lint` is known-broken in a fresh tree (eslint-config-next exports) — not a gate.
- Real gates: `npm run typecheck`, `npm run test`, `npm run build`.
- Credits: keep the pixel-agents footer credit; remove the agent-flow credit.
- Commit message footer line: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- `lib/session-activity.ts` (modify) — `ToolKind`, `detectTool()`, `tool`/`detail` on `ActivitySignal`.
- `lib/__tests__/session-activity.test.ts` (modify) — tool/detail tests.
- `lib/sessions.ts` (modify) — remove `SessionView`; add `numberSessions()`, `avatarVariant()`, `CHARACTER_VARIANTS`; `tool`/`detail` on `VisualSession`; re-export `ToolKind`.
- `lib/__tests__/sessions.test.ts` (modify) — numbering + variant tests.
- `lib/server/claude-pty.ts` (modify) — `tool`/`detail` on `PtySessionInfo` + passthrough.
- `lib/settings.ts`, `lib/config.ts`, `app/api/settings/route.ts` (modify) — drop `sessionsView`.
- `app/components/sections/SessionsSection.tsx` (modify) — remove toggle, render office only.
- `app/components/sections/sessions/FlowGraphView.tsx` (**delete**).
- `app/components/sections/sessions/PixelOfficeView.tsx` (rewrite) — multi-room office.
- `package.json` (+ `package-lock.json`) — remove `d3-force`/`@types/d3-force`; bump version.
- `CHANGELOG.md` (create), `README.md` (modify).

---

### Task 1: Parser — current tool + target (`tool`/`detail`)

**Files:**
- Modify: `lib/session-activity.ts`
- Test: `lib/__tests__/session-activity.test.ts`

**Interfaces:**
- Produces: `export type ToolKind = "edit"|"read"|"search"|"bash"|"web"|"task"|"other";`
  `detectTool(tail: string): { tool: ToolKind; detail?: string } | undefined;`
  `ActivitySignal` gains optional `tool?: ToolKind; detail?: string;` (set only while running).

- [ ] **Step 1: Write failing tests** in `lib/__tests__/session-activity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { detectActivity, detectTool } from "../session-activity";

describe("detectTool", () => {
  it("edit → file basename", () => {
    expect(detectTool("● Edit(app/components/sections/sessions/PixelOfficeView.tsx)"))
      .toEqual({ tool: "edit", detail: "PixelOfficeView.tsx" });
  });
  it("read → file basename, strips key + quotes", () => {
    expect(detectTool('● Read(file_path: "lib/sessions.ts")'))
      .toEqual({ tool: "read", detail: "sessions.ts" });
  });
  it("bash → truncated command", () => {
    expect(detectTool("● Bash(npm run build)")).toEqual({ tool: "bash", detail: "npm run build" });
  });
  it("search → pattern", () => {
    expect(detectTool('● Grep(pattern: "useEffect")')?.tool).toBe("search");
  });
  it("web → host", () => {
    expect(detectTool("● WebFetch(https://github.com/foo/bar)"))
      .toEqual({ tool: "web", detail: "github.com" });
  });
  it("uses the LAST tool near the tail", () => {
    expect(detectTool("● Read(a.ts)\n● Edit(b.ts)")?.detail).toBe("b.ts");
  });
  it("returns undefined when no tool present", () => {
    expect(detectTool("╭─ > │ waiting for input")).toBeUndefined();
  });
});

describe("detectActivity tool wiring", () => {
  it("attaches tool/detail while running", () => {
    const r = detectActivity({ tail: "● Edit(lib/x.ts)", status: "running", lastDataAtMs: 0, now: 0 });
    expect(r.activity).toBe("working");
    expect(r.tool).toBe("edit");
    expect(r.detail).toBe("x.ts");
  });
  it("omits tool when done", () => {
    const r = detectActivity({ tail: "● Edit(lib/x.ts)", status: "done", lastDataAtMs: 0, now: 0 });
    expect(r.tool).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npm test -- session-activity` → FAIL (`detectTool` not exported).

- [ ] **Step 3: Implement** in `lib/session-activity.ts`:

```ts
export type ToolKind = "edit" | "read" | "search" | "bash" | "web" | "task" | "other";

// Capture every tool marker so we can take the LAST (most recent) one.
const TOOL_CALL_RE =
  /\b(Edit|MultiEdit|Write|NotebookEdit|Read|Grep|Glob|Search|Bash|WebFetch|WebSearch|Task)\(([^)]*)\)/g;

const TOOL_KIND: Record<string, ToolKind> = {
  Edit: "edit", MultiEdit: "edit", Write: "edit", NotebookEdit: "edit",
  Read: "read", Grep: "search", Glob: "search", Search: "search",
  Bash: "bash", WebFetch: "web", WebSearch: "web", Task: "task",
};

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

/** Strip a leading `key:` and surrounding quotes from a tool-arg string. */
function cleanArg(raw: string): string {
  let s = raw.trim().replace(/^\w+\s*:\s*/, "").trim();
  s = s.replace(/^["'`]|["'`]$/g, "").trim();
  // For multi-arg calls (e.g. Edit(path, old, new)) keep the first segment.
  const comma = s.indexOf(",");
  if (comma > 0) s = s.slice(0, comma).trim();
  return s;
}

function hostOf(url: string): string {
  const m = url.match(/^[a-z]+:\/\/([^/]+)/i);
  return m ? m[1] : url;
}

/** The most recent tool call near the tail, mapped to a kind + short target. */
export function detectTool(tail: string): { tool: ToolKind; detail?: string } | undefined {
  const matches = [...tail.matchAll(TOOL_CALL_RE)];
  const m = matches[matches.length - 1];
  if (!m) return undefined;
  const tool = TOOL_KIND[m[1]] ?? "other";
  const arg = cleanArg(m[2] || "");
  if (!arg) return { tool };
  let detail: string;
  if (tool === "edit" || tool === "read") detail = basename(arg);
  else if (tool === "web") detail = hostOf(arg);
  else detail = arg.length > 40 ? arg.slice(0, 39) + "…" : arg;
  return { tool, detail };
}
```

Then extend `ActivitySignal` and `detectActivity` (set tool/detail only while running):

```ts
export interface ActivitySignal {
  activity: LiveActivity;
  subagents: DetectedSubagent[];
  tool?: ToolKind;
  detail?: string;
}
// inside detectActivity, in the running branch, replace the final return with:
const t = detectTool(tail);
return { activity, subagents: detectSubagents(tail), tool: t?.tool, detail: t?.detail };
```

- [ ] **Step 4: Run, verify pass** — `npm test -- session-activity` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/session-activity.ts lib/__tests__/session-activity.test.ts
git commit -m "feat(sessions): parse current tool + target (file/command) from the output tail"
```

---

### Task 2: `sessions.ts` — numbering, variant, fields; drop `SessionView`

**Files:**
- Modify: `lib/sessions.ts`
- Test: `lib/__tests__/sessions.test.ts`

**Interfaces:**
- Consumes: `numberInstances` from `./window-instances`; `ToolKind` from `./session-activity`.
- Produces: `numberSessions(sessions: VisualSession[]): Map<string, number>`;
  `CHARACTER_VARIANTS = 6`; `avatarVariant(id: string): number`;
  `VisualSession` gains `tool?: ToolKind; detail?: string;`; `SessionView` removed.

- [ ] **Step 1: Write failing tests** (append to `lib/__tests__/sessions.test.ts`):

```ts
import { numberSessions, avatarVariant, CHARACTER_VARIANTS } from "../sessions";

const vs = (id: string, startedAt: number) =>
  ({ id, projectName: id, prompt: "", status: "running", startedAt }) as any;

describe("numberSessions", () => {
  it("numbers oldest = #1, regardless of array order", () => {
    const a = vs("a", 100), b = vs("b", 200), c = vs("c", 300);
    const newestFirst = numberSessions([c, b, a]); // as the API returns them
    expect(newestFirst.get("a")).toBe(1);
    expect(newestFirst.get("b")).toBe(2);
    expect(newestFirst.get("c")).toBe(3);
    const oldestFirst = numberSessions([a, b, c]);
    expect(oldestFirst.get("a")).toBe(1);
    expect(oldestFirst.get("c")).toBe(3);
  });
  it("breaks startedAt ties by id, numbers are unique", () => {
    const m = numberSessions([vs("y", 5), vs("x", 5)]);
    expect(m.get("x")).toBe(1);
    expect(m.get("y")).toBe(2);
  });
});

describe("avatarVariant", () => {
  it("is stable and within [0, CHARACTER_VARIANTS)", () => {
    for (const id of ["a", "b", "session-123"]) {
      const v = avatarVariant(id);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(CHARACTER_VARIANTS);
      expect(avatarVariant(id)).toBe(v);
    }
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npm test -- sessions` → FAIL.

- [ ] **Step 3: Implement** in `lib/sessions.ts`:
  - Add import: `import { numberInstances } from "./window-instances";`
  - Re-export type: `export type { ToolKind } from "./session-activity";`
  - Remove the line `export type SessionView = "pixel" | "flow";`
  - Add `tool?: ToolKind; detail?: string;` to the `VisualSession` interface.
  - Add:

```ts
/** Number of distinct hand-drawn character looks in the office. */
export const CHARACTER_VARIANTS = 6;

/** Deterministic 0..5 character look for a session id (hair/skin/shirt). */
export function avatarVariant(id: string): number {
  return avatarIndex(id, CHARACTER_VARIANTS);
}

/**
 * Stable 1-based number per session, identical to the Launcher's numbering
 * (oldest = #1). Keyed on `startedAt` (PTY spawn time = the Launcher's
 * `createdAt` analogue), ties broken by id — exactly numberInstances' order.
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
```

- [ ] **Step 4: Run, verify pass** — `npm test -- sessions` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sessions.ts lib/__tests__/sessions.test.ts
git commit -m "feat(sessions): Launcher-consistent numberSessions() + avatarVariant(); drop SessionView"
```

---

### Task 3: Server passthrough — `tool`/`detail`

**Files:**
- Modify: `lib/server/claude-pty.ts`

**Interfaces:**
- Consumes: `ToolKind` from `../session-activity`; `detectActivity()` now returns `tool`/`detail`.
- Produces: `PtySessionInfo` gains `tool?: ToolKind; detail?: string;`.

- [ ] **Step 1: Edit** — add `ToolKind` to the import from `../session-activity`; add `tool?: ToolKind; detail?: string;` to `PtySessionInfo`; in `listPtySessions`, destructure and spread:

```ts
const { activity, subagents, tool, detail } = detectActivity({
  tail: tailText(s.buffer), status: s.status, lastDataAtMs: s.lastDataAt, now,
});
return { id: s.id, status: s.status, exitCode: s.exitCode,
         activity, subagents, tool, detail, lastActivityAt: s.lastDataAt, ...s.meta };
```

- [ ] **Step 2: Verify** — `npm run typecheck` → no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/server/claude-pty.ts
git commit -m "feat(sessions): pass tool/detail through listPtySessions"
```

---

### Task 4: Remove the alternative view (setting, toggle, Flow-Graph, d3-force)

**Files:**
- Modify: `lib/settings.ts`, `lib/config.ts`, `app/api/settings/route.ts`, `app/components/sections/SessionsSection.tsx`, `package.json`
- Delete: `app/components/sections/sessions/FlowGraphView.tsx`

- [ ] **Step 1: Drop `sessionsView`** from `lib/settings.ts` (the `sessionsView?` field + comment), `lib/config.ts` (the field decl + the `sessionsView: settings.sessionsView === "flow" ? "flow" : "pixel",` derivation), and `app/api/settings/route.ts` (the two `sessionsView?` type fields + the `if (body.sessionsView === ...) patch.sessionsView = ...` block).

- [ ] **Step 2: Rewrite `SessionsSection.tsx`** — no toggle, no view state, no settings I/O; render the office directly. Full file:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Boxes, RefreshCw } from "lucide-react";
import { EmptyState } from "../ui";
import type { VisualSession } from "@/lib/sessions";
import PixelOfficeView from "./sessions/PixelOfficeView";

/**
 * Sessions tab — a live pixel-office view of every Claude Code session running
 * via the Launcher (homage to pixel-agents). Each session is an animated
 * character at a desk; the live-sessions endpoint is polled (~1s) so launcher
 * starts/stops appear automatically.
 */
export default function SessionsSection() {
  const [sessions, setSessions] = useState<VisualSession[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    fetch("/api/launcher/live-sessions")
      .then((r) => r.json())
      .then((d: { sessions?: VisualSession[] }) => {
        setSessions(d.sessions ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-5 py-3">
        <div className="mr-auto min-w-0">
          <h2 className="text-sm font-semibold text-ink">Sessions</h2>
          <p className="text-[11px] text-faint">
            {sessions.length} live launcher session{sessions.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          onClick={load}
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md border border-line text-faint transition-colors hover:text-ink"
          title="Refresh"
        >
          <RefreshCw className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {loaded && sessions.length === 0 ? (
          <div className="grid h-full place-items-center">
            <EmptyState
              icon={Boxes}
              title="No live sessions yet"
              description="Start a Claude Code session from the Launcher — it appears here instantly as a character in the office."
            />
          </div>
        ) : (
          <PixelOfficeView sessions={sessions} />
        )}
      </div>

      <footer className="border-t border-line px-5 py-2 text-[11px] text-faint">
        Pixel office inspired by{" "}
        <a
          className="cursor-pointer text-accent hover:underline"
          href="https://github.com/pixel-agents-hq/pixel-agents"
          target="_blank"
          rel="noreferrer"
        >
          pixel-agents
        </a>
        .
      </footer>
    </div>
  );
}
```

- [ ] **Step 3: Delete** the Flow-Graph: `git rm app/components/sections/sessions/FlowGraphView.tsx`.

- [ ] **Step 4: Remove `d3-force`** — delete `"d3-force"` from `dependencies` and `"@types/d3-force"` from `devDependencies` in `package.json`, then refresh the lockfile: `npm install --include=dev`.

- [ ] **Step 5: Verify** — `npm run typecheck` → no errors (the existing PixelOfficeView still satisfies SessionsSection; it is rewritten in Task 5).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(sessions): remove Flow-Graph, the view toggle, the sessionsView setting and d3-force"
```

---

### Task 5: Rewrite `PixelOfficeView.tsx` — multi-room office

**Files:**
- Rewrite: `app/components/sections/sessions/PixelOfficeView.tsx`

**Interfaces:**
- Consumes: `numberSessions`, `avatarVariant`, `sessionColor`, `sessionActivity`, `groupByBatch`, `VisualSession`, `LiveActivity`, `ToolKind` from `@/lib/sessions`.

**Design (single DPR-aware `<canvas>`, rAF loop, ResizeObserver, reduced-motion single-frame — keep that engine; replace the scene):**

1. **Routing (pure, top of render):** `const number = numberSessions(sessions);` Partition:
   - `meeting`: `groupByBatch(sessions)` groups where `isBatch` (≥2 share batchId).
   - `breakRoom`: non-batch sessions with `sessionActivity(s) === "done"`.
   - `work`: all other non-batch sessions.
2. **Layout** (recompute on session-set or size change): stack the **occupied** rooms vertically; each room = header band (name sign) + content grid of seats. Each occupant → `Seat { id, number, x, y, w, h, room }`; store seats in a ref and hit-test by id. Hidden rooms when empty. Canvas height grows to fit; wrapper scrolls.
3. **Drawing helpers** (hand-drawn rects, crisp, DPR-aware):
   - `drawRoomFrame(ctx, x, y, w, h, label)` — wall band, checker floor, name sign, doorway gap.
   - `drawDesk`, `drawMonitor(activity, tool, t)`, `drawCouch`, `drawCoffee`, `drawPlant`, `drawRoundTable`, `drawClock`.
   - `drawPerson(ctx, cx, top, scale, { variant, color, pose })` — extends the current function with `variant` (0..5 → hair/skin/shirt palette arrays) and `pose` (`typing|reading|running|idle|wave|shake`).
   - `drawBubble(ctx, x, y, activity)` — `!` for waiting/error, `✓` for done, animated dots for working/thinking.
   - `drawCaption(ctx, cx, y, glyph, text)` — `✎ <file>` / `⌕ <pattern>` / `$ <cmd>` / `<host>` / activity word.
4. **Per-session render:** plate `#N` (from `number`), project label, caption from `tool`/`detail` with fallback (`waiting` → "needs approval"). `pose` from `activity` + `tool` (edit→typing, read/search→reading, bash→running, thinking→idle, waiting→wave, error→shake).
5. **Subagents as people:** for each `s.subagents`, draw a full `drawPerson` (~0.8 scale) clustered beside the parent seat, each with its own activity dot + truncated label.
6. **Interaction:** hover/click hit-tests seats → DOM tooltip panel with `#N`, project, prompt, model/effort/repo, **status + current action (`tool` + full `detail`)**, subagent list (label + activity dot).
7. **Resilience:** pause rAF when `document.hidden` (visibilitychange); redraw on data change in reduced-motion; DPR ≤ 2.

- [ ] **Step 1:** Write the full rewritten `PixelOfficeView.tsx` per the design above (complete file, no placeholders).
- [ ] **Step 2: Verify** — `npm run typecheck` → clean.
- [ ] **Step 3: Verify** — `npm run build` → succeeds.
- [ ] **Step 4: Visual check** — start dev server, open Sessions with ≥1 live launcher session; confirm rooms render, `#N` matches the Launcher, captions show file/command, subagents appear as people, waiting shows the "!" bubble.
- [ ] **Step 5: Commit**

```bash
git add app/components/sections/sessions/PixelOfficeView.tsx
git commit -m "feat(sessions): multi-room pixel office — rooms, furniture, subagents-as-people, file/command captions, Launcher-consistent numbering"
```

---

### Task 6: Release prep — version, changelog, README, gates

**Files:**
- Modify: `package.json` (version), `README.md`
- Create: `CHANGELOG.md`

- [ ] **Step 1:** Bump `package.json` `"version": "1.3.0"` → `"1.4.0"`.
- [ ] **Step 2:** Create `CHANGELOG.md` with a `## 1.4.0 — 2026-06-30` entry (Pixel-Office-only Sessions; rooms/objects; subagents as people; finer activity with tool + file/command; Launcher-consistent numbering; removed Flow-Graph + `d3-force` + `sessionsView`) and a brief `## 1.3.0` entry seeded from history.
- [ ] **Step 3:** Update `README.md` Sessions section — describe the single pixel office (rooms, characters, finer activity, numbering); drop flow-graph/agent-flow mentions; ensure any version string reads 1.4.0.
- [ ] **Step 4: Gates** — run and confirm green: `npm run typecheck`, `npm run test`, `npm run build`. (`npm run lint` — run, but the eslint-config-next resolve error is not a blocker.)
- [ ] **Step 5: Commit**

```bash
git add package.json CHANGELOG.md README.md
git commit -m "chore(release): v1.4.0 — changelog, README, version bump"
```

---

### Task 7: Build the installer + publish the GitHub release

- [ ] **Step 1: Local installer build (verification)** — `npm install --include=dev` (if needed), then `npm run electron:build`. Expect `build/dist/cc-control-center-Setup-1.4.0.exe`. (Environment-heavy; if it fails locally, CI is authoritative — record the failure, don't block the tag.)
- [ ] **Step 2: Merge to main** — `git checkout main && git merge --no-ff feat/v1.4-pixel-office-only`.
- [ ] **Step 3: Push** — `git push origin main`.
- [ ] **Step 4: Tag + push tag** — `git tag v1.4.0 && git push origin v1.4.0`. GitHub Actions `release.yml` runs tests, builds the `.exe`, and `gh release create`s **cc-control-center v1.4.0** with the Setup asset.
- [ ] **Step 5: Verify** — confirm the Actions run succeeds and the release with the `.exe` asset appears at `https://github.com/LuiInventions/Claude-code-web-manager/releases`.

---

## Self-Review

**Spec coverage:** §1 removals → Task 4; §2 numbering → Task 2; §3 rooms/objects/characters/subagents → Task 5; §4 finer activity (tool/detail incl. files) → Task 1 (parse) + Task 3 (passthrough) + Task 5 (render); §5 detail panel → Task 5; §6 release → Tasks 6-7; §7 testing → Tasks 1-2 (TDD) + 5-6 (gates). All covered.

**Placeholder scan:** Task 5's canvas body is specified by design + helper signatures rather than 600 lines verbatim — the implementer writes the complete file in Step 1 (no `TODO`/`TBD`); every pure-logic task has full test + impl code.

**Type consistency:** `ToolKind`, `numberSessions`, `avatarVariant`, `CHARACTER_VARIANTS`, `detectTool`, `tool`/`detail` are used with the same names/types across Tasks 1→2→3→5. `numberSessions` returns `Map<string, number>`; `avatarVariant` returns `number` in `[0,6)`.
