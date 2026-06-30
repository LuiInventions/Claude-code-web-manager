# Changelog

All notable changes to Claude Code Control Center are documented here. Versions
follow `package.json`; each `v*` tag publishes a self-contained Windows installer
(`cc-control-center-Setup-<version>.exe`) via GitHub Actions.

## 1.7.0 — 2026-06-30

### Sessions — still camera, full-bleed office, live captions, agent numbers, richer layout

Bug-fix + enhancement pass on the vendored pixel-agents office. The engine in
`app/components/sessions/office/engine/**` (rendering, sprites, pathfinding, FSM)
is unchanged — all work is in the adapter, the canvas host (prop-gated), a new
thin overlay layer, and the default layout.

- **Camera no longer follows on click.** `OfficeCanvas` gained an opt-out prop
  `followCameraOnSelect` (default `true`, preserving upstream); the Sessions tab
  passes `false`, so clicking a character only selects it (tooltip/info) and the
  camera stays put.
- **The office fills the whole container — no brown border.** New `fitToContent`
  mode computes an integer "cover" fit to the non-VOID content bounding box (the
  layout's empty top rows were the brown band), then locks zoom + pan (no camera
  follow, no wheel/drag pan, re-fit only on container resize). The cover zoom is
  intentionally not clamped to `ZOOM_MAX` so a small office in a large/high-DPR
  canvas still fully covers.
- **Live desk captions.** The activity overlay shows the current file/command for
  the running tool — `✎ App.tsx` (edit), `$ npm run build` (bash), `Reading …`,
  `Searching …`, etc. — sourced from the `tool`/`detail` the server already
  parses in `lib/session-activity.ts`.
- **Permanent `#N` badge over every character**, matching the Launcher's session
  numbering (`numberSessions`, oldest = #1); sub-agents inherit their parent's
  number. Rendered by a new thin `OfficeOverlay` layer (the engine is untouched).
- **Richer default layout.** Added a coffee/break area (table, benches, a coffee
  "counter", pots) and more greenery across both rooms; `layoutRevision` 1 → 2.

## 1.6.0 — 2026-06-30

### Sessions — fix the brown/empty office in the packaged app

- **Fixed the "brown screen" in the Sessions tab** when Claude Code sessions are
  running. The office canvas was rendering with no sprites, floor, walls, or
  furniture — only its dark-brown background — so a running session showed an
  empty room.
- **Root cause (two compounding bugs):**
  1. `public/**` was **not included** in the packaged app
     (`build/electron-builder.yml`), so the vendored pixel-agents assets under
     `public/pixel-agents-assets/**` were missing from the installed build
     entirely.
  2. `GET /api/sessions/office-assets` resolved those assets via
     `process.cwd()`, but the packaged Electron main process `chdir()`s to
     `userData` (so `.data`/`projects` stay writable) — moving the working
     directory away from the install dir. Because the production build uses
     `next build --experimental-build-mode compile` (which skips prerendering),
     the route runs at request time with the wrong cwd. Both failures meant the
     asset loaders returned nothing and the office rendered empty.
- **Fixes:** ship `public/**` in the installer, and resolve the office assets
  from a new `CCC_APP_ROOT` env var (set by the Electron main to the app root,
  falling back to `process.cwd()` in dev / `npm start`). Added a regression test
  (`lib/__tests__/office-assets.test.ts`) that loads the shipped asset tree.

## 1.5.0 — 2026-06-30

### Sessions — the office is now the real pixel-agents engine

- **Vendored the actual [pixel-agents](https://github.com/pixel-agents-hq/pixel-agents)
  office** instead of a hand-drawn re-creation. The Sessions tab now renders
  pixel-agents' own `OfficeCanvas` and engine **byte-for-byte unchanged**:
  genuine pixel-art sprites (6 characters, ~24 furniture sets, floor/wall tiles,
  pets), real A\* pathfinding, the character animation FSM, matrix spawn/despawn
  effects, and middle-mouse pan + Ctrl-wheel zoom.
- **New adapter `useSessionMessages.ts`** is the only hand-written piece: it maps
  our live launcher sessions (`lib/sessions`) onto the office's own `OfficeState`
  (agents seated by activity, reading-vs-typing animation per tool, waiting/done
  bubbles), and renders **in-session subagents as their own pixel characters**.
- **Sprite pipeline served locally:** a new `GET /api/sessions/office-assets`
  route runs pixel-agents' own PNG decoders (`lib/pixel-agents/**`, vendored) to
  turn the bundled assets (`public/pixel-agents-assets/**`) into the sprite
  pixel-grids the office consumes — no VS Code extension host or WebSocket
  backend required.
- **Removed** the previous custom hand-drawn `PixelOfficeView.tsx`.
- **Build:** added a webpack `resolve.extensionAlias` so the vendored office's
  `.js` import specifiers resolve to their TypeScript sources; added the `pngjs`
  dependency for server-side PNG decoding.

## 1.4.0 — 2026-06-30

### Sessions — the Pixel Office is now the only visualization

- **Removed the Flow-Graph** and the pixel/flow toggle entirely. The Sessions
  tab now renders a single **pixel office** (homage to
  [pixel-agents](https://github.com/pixel-agents-hq/pixel-agents)) — no
  alternative view, no `sessionsView` setting, and the `d3-force` dependency is
  gone.
- **Multi-room office:** sessions are routed into a **Work Room** (active agents
  at desks), a **Meeting Room** (KI-Modus batches around a round table, one per
  batch), and a **Break Room** (finished sessions on couches), with hand-drawn
  furniture and props (monitors, keyboards, couches, coffee, plants, clock,
  window).
- **Finer, precise activity:** the server-side parser now derives the **current
  tool and its target** from each session's output. Desks show **what's being
  worked on right now** — the file being edited (`✎ PixelOfficeView.tsx`), the
  search pattern, the command (`$ npm run build`), or the host — and the
  character pose + monitor animate to match (typing / reading / running /
  thinking / waiting / done / error).
- **Subagents as pixel people:** in-session Task subagents are drawn as their own
  little characters beside their parent, each with its own activity.
- **Correct, consistent numbering:** each character wears a `#N` plate whose
  number is **identical to the Launcher's** (oldest = #1, via the shared
  `numberInstances`), so a session is unambiguous across both tabs. Hover or
  click a character for full details (project, prompt, model, current action,
  subagents).

## 1.3.0 — 2026-06-30

- **Native Sessions views:** rebuilt the pixel-office as a shared canvas room and
  added a d3-force flow-graph, both driven by live activity
  (working / thinking / waiting≈needs-approval / done / error) and in-session
  subagents parsed server-side (`lib/session-activity.ts`).
- **Launcher fixes:** healed the xterm panes "shifted on start" bug (deferred fit
  + `layoutNonce` refits) and added a **Close all sessions** button. Subtle
  folder outlines on Local Projects.
- **Providers:** Groq default → `llama-3.3-70b-versatile` (the gpt-oss-* models
  are gated → 403); added a per-provider **Test** button (`POST
  /api/providers/test`) and clearer AI errors.

## 1.2.0 — 2026-06-29

- Per-provider model dropdowns, setup-on-update gate, and the first **Sessions**
  tab visualizing live launcher sessions.
