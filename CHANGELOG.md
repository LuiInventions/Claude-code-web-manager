# Changelog

All notable changes to Claude Code Control Center are documented here. Versions
follow `package.json`; each `v*` tag publishes a self-contained Windows installer
(`cc-control-center-Setup-<version>.exe`) via GitHub Actions.

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
