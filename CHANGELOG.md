# Changelog

All notable changes to Jarvis Control Center are documented here. Versions
follow `package.json`. From 1.9.6 each `v*` tag publishes
`jarvis-control-center-Setup-<version>.exe`. Earlier installers were named
`cc-control-center-Setup-<version>.exe`.

## 1.9.6 — 2026-10-12

### Jarvis Control Center

- The app, the window title, and the Windows installer are **Jarvis Control Center** (`jarvis-control-center-Setup-1.9.6.exe`). Settings from the previous install are copied into the new profile folder. The setup screen shows once more.
- The interface is black, with quiet borders and no glow.
- After a remote login the SSH pane on the right closes. The left rail shows the server, counts 1–6, **Start without prompt**, and **Trennen**.
- A code CLI on the server reuses the SSH login that is already open. A second SSH connection is not started, so a server that asks for keyboard-interactive on every connection no longer ends that session with code 255.

## 1.9.5 — 2026-10-12

### Remote tab, and VS Codium stays local

- **Remote** is its own tab. The launcher is Local and GitHub only.
- The center asks for `user@IP` first. SSH starts in the background. The password field appears only after that ssh process asks for a password, and the 2FA field only after the server asks for a code.
- The ssh session is visible on the right from the moment it starts. Once connected, the left side can start the chosen code CLI with **Start without prompt** and ×1–×6.
- **VS Codium** no longer uses the server login. It opens `codium` or `code serve-web` in the same local folder the launcher uses for Local.
- SSH is started from the real `ssh.exe` path. A missing OpenSSH install no longer shows up as `File not found`.

## 1.9.4 — 2026-10-12

### Remote login — two fields, then the code if the server asks

- The Sessions tab is the pixel office again. Server login is not on that tab.
- Under Remote in the launcher the form is `user@IP` and the password. The 2FA field opens only after ssh has started and the server asks for a code.

## 1.9.3 — 2026-10-12

### Startup — 1.9.2 crashed before the window opened

The Windows build workaround lived in `next.config.mjs`. The packaged app
inlines that file into `server.cjs`. `createRequire(import.meta.url)` then
received `undefined` and the process exited. The workaround now runs only
while `next build` produces the installer.

## 1.9.2 — 2026-10-12

### Remote server — launcher, Sessions, and VS Codium

- The launcher source list is **Local**, **GitHub**, or **Remote**. Under Remote, saved servers are selectable, and **Neu** adds another server.
- Login is the `ssh` command line: IP, user, password, and a 2FA code when the server asks. The code is not stored. **IP und Passwort speichern** keeps the host, user, and password.
- Once connected, the launcher starts the chosen code CLI on that server. The Sessions tab can also start Claude, Grok, or Codex there.
- **VS Codium** is its own tab. It shows `codium` or `code serve-web` from the connected server.

## 1.9.1 — 2026-10-11

### Installer — Setup no longer unpacks tens of thousands of files

The app's own code is small. The old Setup.exe was not: `asar` was off, so NSIS
unpacked the whole production `node_modules` tree (tens of thousands of files)
from a non-solid LZMA 7z into a temp folder and then copied every file again.
Windows then scanned each new file. That is the 3–4 minute install. The new
package is one archive plus the few native binaries that cannot live inside it,
and the installer extracts that archive straight into the install folder.

- The app is now one `app.asar`. Native pieces that cannot live in an archive
  stay unpacked: `node-pty` (including its conpty/winpty helper) and the
  Next/sharp `.node` binaries.
- The installer payload is a zip (deflate), extracted directly into the install
  folder. The per-user NSIS wizard is unchanged.
- `.next/cache` (the webpack compile cache, about 100MB) is no longer shipped,
  nor are source maps or node-pty prebuilds for other operating systems.

## 1.9.0 — 2026-10-11

Built on **1.7.0**. Release **1.8.0** (the per-folder warm pool of six pre-spawned
Claude sessions) was faulty and has been removed from `main` and from the releases.

### Code CLIs — Claude Code, Grok, and ChatGPT Codex

- The launcher starts one of three coding CLIs. Pick it on the first-run screen
  or change it later in **Settings → Code CLI**. The choice is stored in
  `.data/settings.json` as `codeCli` (`claude`, `grok`, or `codex`).
- **Claude Code** (`claude`) still launches with `--dangerously-skip-permissions`.
- **Grok** (`grok`, Grok Build) launches with `--permission-mode bypassPermissions`.
- **ChatGPT Codex** (`codex`) launches with `--dangerously-bypass-approvals-and-sandbox`.
- Model and effort dropdowns follow the selected CLI. An empty "Standard" omits
  the flag. The Claude usage bar and its rate-limit block apply only when Claude
  Code is selected.

### Faster session open

- The PTY starts as soon as the launcher box mounts. xterm loads in parallel and
  replays any output that arrived early. The launcher also preloads xterm.
- Claude's update check is skipped for sessions started here
  (`DISABLE_AUTOUPDATER`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`), unless
  those variables are already set.
- On boot the server runs `<cli> --version` once so the binary is in the OS
  cache. It does not keep idle agent sessions.
- The Claude `/usage` scrape no longer runs at the same moment as a live
  session, and it waits 25s after startup.

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
