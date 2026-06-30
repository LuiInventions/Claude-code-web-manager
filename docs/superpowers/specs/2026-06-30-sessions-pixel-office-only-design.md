# v1.4.0 — Pixel Office is the only Sessions view

**Date:** 2026-06-30
**Branch:** `feat/v1.4-pixel-office-only`
**Status:** Design — awaiting user review

## Goal

Make the **Pixel Office the single, exclusive** visualization of live launcher
sessions. Remove the Flow-Graph entirely and every other separate/alternative
session display. Enrich the office into a faithful native re-creation of the
[pixel-agents](https://github.com/pixel-agents-hq/pixel-agents) concept — real
**rooms**, **furniture/objects**, **per-session pixel characters**, and
**subagents drawn as their own pixel people** — driven by **finer, more precise
live activity** (including *which file/command is being worked on*). Fix session
**numbering** so it is correct, unique, and identical to the Launcher's. Ship as
**v1.4.0**: changelog, README, `.exe` build, GitHub release.

Approved decision: **faithful native re-creation** — keep our own offline
`<canvas>` renderer (no third-party sprite assets / engine, per the v1.3 "no
vendoring" decision); enrich it to match the pixel-agents visual language.

## Non-goals

- No vendoring of upstream sprite packs (JIK-A-4) or the upstream OfficeState/Vite engine.
- No change to the launcher PTY model (still interactive `claude --dangerously-skip-permissions`).
- No new alternative visualization, ever — the toggle and the `sessionsView`
  setting are removed, not replaced.

---

## 1. Removals (cleanup — no alternative kept)

| File | Change |
| --- | --- |
| `app/components/sections/sessions/FlowGraphView.tsx` | **Delete.** |
| `app/components/sections/SessionsSection.tsx` | Remove the pixel/flow **toggle**, `view` state, the `sessionsView` settings read/write, the `Network`/`Gamepad2`/`ToggleBtn` machinery and the agent-flow footer credit. Render `<PixelOfficeView>` directly. Keep: header session count, refresh button, empty state, footer (pixel-agents credit only). |
| `lib/sessions.ts` | Remove `export type SessionView`. |
| `lib/settings.ts` | Remove the `sessionsView?` field. |
| `lib/config.ts` | Remove the `sessionsView` field + its derivation (lines ~146-147, ~179). |
| `app/api/settings/route.ts` | Remove the `sessionsView` read + patch. |
| `package.json` (+ `package-lock.json`) | Remove `d3-force` and `@types/d3-force` (only the flow graph used them). |
| `README.md` | Rewrite the Sessions section (drop flow-graph + agent-flow; describe the office). |

Old persisted `settings.json` values like `sessionsView: "flow"` need no
migration — the settings reader only picks known fields, so an unknown key is
ignored.

---

## 2. Numbering fix (correctness core)

**Bug today:** the Launcher numbers sessions **oldest = #1**
(`numberInstances`, keyed on `createdAt`), but the Sessions view numbers by the
`/api/launcher/live-sessions` array order, which is **newest-first**
(`listPtySessions` sorts `startedAt` DESC) with `index = i + 1`. So the same
session shows **different numbers** in the Launcher vs. the Sessions view.

**Fix:** number sessions with the *same algorithm* the Launcher uses. Add to
`lib/sessions.ts`:

```ts
import { numberInstances } from "./window-instances";

/**
 * Stable 1-based number per session, identical to the Launcher's numbering
 * (oldest = #1). Keyed on `startedAt` (the PTY spawn time, the analogue of the
 * Launcher's `createdAt`), ties broken by id — exactly numberInstances' order.
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

Why this matches the Launcher: both derive #N from real spawn time, oldest = #1,
tie-broken by id. On fresh start the Launcher sets `createdAt = startedAt + i`;
on restore it reassigns descending keys from the server's newest-first list — in
both cases oldest → smallest key → #1, the same ordering as ascending
`startedAt`. The office reads #N from this map, so a session shows the **same
number** in both tabs, stable across polls, unique. Unit-tested.

---

## 3. The Pixel Office — rooms, objects, characters

One DPR-aware `<canvas>` (keep the existing rAF loop / `ResizeObserver` /
`prefers-reduced-motion` engine), but the scene becomes a multi-room office.
Each session is routed to **exactly one** room, deterministically:

- **Meeting Room** — every session in a multi-session **KI-Modus batch**
  (`batchId` shared by ≥2). Characters seated around a **round table** labelled
  `KI-Modus · N`. Reuses `groupByBatch`; this replaces the flow graph's batch hub.
- **Break Room** — non-batch sessions whose activity is **`done`**: relaxing on
  couches by a coffee machine + plant, calm idle + ✓.
- **Work Room** — every other non-batch session (working / thinking / waiting /
  error): seated at **desks**.

Room assignment order: batch → done → work (a done session inside a batch stays
in the Meeting Room with the batch). Rooms are drawn as walled zones with a name
sign + doorway; rooms with no occupants are hidden so the canvas isn't empty.

**Objects / furniture (the pixel-agents "Bausteine"), all hand-drawn rects:**
desks, animated monitors, keyboards, office chairs, couches, coffee
machine + mug, potted plants, round meeting table, wall clock, window on the
back wall, rug, room signs, doorways.

**Characters:** one per session. `avatarVariant(id)` (new, pure, in
`sessions.ts`) picks 1 of **6 deterministic looks** (hair/skin/shirt) so
sessions are visually distinct beyond their existing `sessionColor(id)`.

**Numbering display:** each character wears a `#N` name-plate (from
`numberSessions`), with the project label + activity caption beneath. The plate
makes multiple sessions "klar unterscheidbar und konsistent".

**Subagents as pixel people:** each `DetectedSubagent` is drawn as its **own
pixel character** (full `drawPerson`, ~0.8 scale — clearly a person, not a dot)
**pairing beside its parent's desk/seat**, with its own activity pose + a small
truncated task label and activity dot. A parent with N subagents shows N people
clustered at its workstation.

---

## 4. Finer activity — precise state + *what's being worked on*

Extend the pure parser `lib/session-activity.ts` (TDD) to surface the **current
tool** and **its target**, so the office shows genuinely precise activity rather
than a coarse blob:

```ts
export type ToolKind = "edit" | "read" | "search" | "bash" | "web" | "task" | "other";

export interface ActivitySignal {
  activity: LiveActivity;
  subagents: DetectedSubagent[];
  tool?: ToolKind;    // most recent tool near the tail (running sessions only)
  detail?: string;    // short target: file basename / search pattern / command
}
```

Detection (heuristic, over the normalized tail): take the **last** tool marker
`Name(args)` near the end. Map name → `ToolKind`
(`Edit|MultiEdit|Write|NotebookEdit→edit`, `Read→read`,
`Grep|Glob|Search→search`, `Bash→bash`, `WebFetch|WebSearch→web`, `Task→task`,
else `other`). Derive `detail` from the args: **file basename** for edit/read
(e.g. `Edit(app/.../PixelOfficeView.tsx)` → `PixelOfficeView.tsx`), the
**pattern** for search, the **command** (truncated) for bash, the URL/query for
web. `tool`/`detail` are omitted when the session isn't running or nothing
matches (graceful degrade).

**Office rendering of the precise state** (per character):
- **working + edit** → typing hands + monitor scrolling code + caption `✎ <file>`.
- **working + read/search** → reading pose + caption `⌕ <file or pattern>`.
- **working + bash** → caption `$ <command>` + a console glyph on the monitor.
- **working + web** → caption `<host>` + a globe glyph (drawn, not emoji).
- **thinking** → idle bob + thought-dots, monitor dim-pulsing.
- **waiting** → character turns to the viewer + **"!" speech bubble** (the
  needs-you signal), amber accent.
- **done** → calm + green ✓ (Break Room).
- **error** → red shake + "!".

The full path / full command shows in the hover/click detail panel; the desk
caption shows the short `detail`. `claude-pty.ts` `PtySessionInfo` gains
`tool?`/`detail?` and `listPtySessions` passes them through; `VisualSession`
gains the same optional fields.

---

## 5. Interaction & detail panel

Hover or click a character → a DOM-overlay panel (kept from today, refreshed):
`#N` + project, prompt (clamped), model, effort, repo, **status + current
action (`tool` + full `detail`)**, and the subagent list (label + activity dot).
Hit-testing maps canvas seats to sessions by id, resolved fresh each poll.

---

## 6. Release v1.4.0

1. **Version:** `package.json` `1.3.0` → `1.4.0` (sole source; `lib/version.ts`
   / `CCC_APP_VERSION` derive from it). The bump intentionally re-runs first-run
   setup (`setupVersion` gate) while keeping tokens/keys in `userData`.
2. **`CHANGELOG.md`** (new): a `## 1.4.0 — <date>` entry describing the
   Pixel-Office-only Sessions view, finer activity (tool + file/command),
   subagents-as-people, the numbering fix, and the flow-graph/`d3-force` removal.
   Seed a `## 1.3.0` entry from the existing history for context.
3. **README:** rewrite the Sessions section; ensure version mentions read 1.4.0.
4. **Gates (in a `--include=dev` tree — global `NODE_ENV=production` +
   npm `omit=dev` otherwise skip devDeps):** `npm run typecheck`, `npm run test`
   (incl. new numbering + tool-detection tests), `npm run build`. `npm run lint`
   is known-broken in a fresh tree (eslint-config-next exports) and is **not** a
   release gate (next build sets `eslint.ignoreDuringBuilds`); run it but don't
   block on that specific failure.
5. **Local installer build:** `npm run electron:build` →
   `build/dist/cc-control-center-Setup-1.4.0.exe` (NSIS-only) to verify locally.
6. **Publish:** branch `feat/v1.4-pixel-office-only` → review → merge to `main`,
   push, then `git tag v1.4.0 && git push origin v1.4.0`. GitHub Actions
   `release.yml` runs tests, builds the `.exe`, and `gh release create`s
   **cc-control-center v1.4.0** with the Setup asset. (`gh` is not installed
   locally; the tag-triggered CI is the authoritative publish path.)

---

## 7. Testing strategy

- **TDD (vitest)** for the pure logic:
  - `lib/__tests__/sessions.test.ts` — `numberSessions` assigns oldest = #1,
    unique, stable, and matches `numberInstances` ordering for the same inputs;
    `avatarVariant` is stable and in range. Keep existing `groupByBatch` /
    `avatarIndex` tests.
  - `lib/__tests__/session-activity.test.ts` — `tool`/`detail` extraction over
    sample Claude TUI tails (Edit/Read/Grep/Bash/WebFetch/Task), basename
    derivation, graceful omit when running-but-no-tool and when done/error.
- **Canvas views** are verified visually + by typecheck/build; their data inputs
  are covered by the pure tests above.
- Full gate run before tagging.

## 8. Risks

- Activity/tool/detail heuristics track Claude Code's TUI wording and degrade to
  coarse `working`/status when nothing matches — documented as heuristic.
- Numbering equivalence assumes `startedAt` order == Launcher `createdAt` order;
  true because both derive from spawn time (oldest = #1). Asserted by a test.
- `electron:build` is environment-heavy; the CI `v1.4.0` build is authoritative.
- Removing `d3-force` is safe — only `FlowGraphView` imported it.
