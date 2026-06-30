# Claude Code Control Center

> A local mission control for **Claude Code** and your projects — a single app that
> launches, supervises, and reviews up to six Claude Code sessions at once.
> Runs **exclusively on `127.0.0.1`**, for you and only you.

<p align="center">
  <a href="https://github.com/LuiInventions/Claude-code-web-manager/releases/latest">
    <img alt="Download the Windows installer" src="https://img.shields.io/badge/⬇%20Download-Windows%20Installer%20(.exe)-2ea44f?style=for-the-badge&logo=windows&logoColor=white" />
  </a>
  &nbsp;
  <a href="https://github.com/LuiInventions/Claude-code-web-manager/releases/latest">
    <img alt="Latest release" src="https://img.shields.io/github/v/release/LuiInventions/Claude-code-web-manager?style=for-the-badge&label=latest&color=24292e" />
  </a>
</p>

<p align="center">
  <b>No Node, no terminal, no setup</b> — grab the installer and you're running in two
  clicks. Prefer source? Jump to <a href="#option-b--from-source">Option B</a>.
</p>

<img width="1920" height="1080" alt="Desktop Screenshot 2026 06 28 - 19 27 23 07" src="https://github.com/user-attachments/assets/961f27e3-c90e-4594-bbbc-ce2fa462e56b" />

---

## What it is

Claude Code is powerful on the command line, but a terminal gives you one session,
no overview of your projects, and no memory of what each run actually accomplished.

**Claude Code Control Center** wraps it in a real interface:

- **Browse your projects** as cards — stack, Git status, size, README — and drill into any of them.
- **Launch Claude Code** with a prompt (optionally AI-improved or split into parallel
  sub-tasks) into a grid of live terminals that survive browser reloads.
- **Review** what each session did — a language model reads the terminal output and
  tells you what's done and what's still open, optionally read aloud.
- **Work on GitHub repos** as if they were local: clone, edit with Claude, then
  commit + pull + push with one click.

It ships two ways: as a ready-to-install **Windows desktop app** — just
[**download the `.exe`**](https://github.com/LuiInventions/Claude-code-web-manager/releases/latest)
and run it — or as a **web app** you start from source. Either way the server binds hard
to loopback, so nothing is ever exposed to your network.

---

## Table of contents

- [Highlights](#highlights)
- [Features](#features)
  - [Local Projects](#local-projects)
  - [Launcher — run Claude Code](#launcher--run-claude-code)
  - [Sessions — visualize your agents](#sessions--visualize-your-agents)
  - [GitHub](#github)
  - [Settings](#settings)
- [A typical session](#a-typical-session)
- [Quick start](#quick-start)
  - [Option A — Desktop app (.exe)](#option-a--desktop-app-exe)
  - [Option B — From source](#option-b--from-source)
- [Requirements](#requirements)
- [Configuration](#configuration)
- [How it works](#how-it-works)
- [Scripts](#scripts)
- [Security](#security)
- [License](#license)

---

## Highlights

- 🗂️ **Local Projects** — every folder in your projects directory at a glance.
- 🚀 **Up to 6 parallel Claude Code sessions** in a live terminal grid, backed by real
  server-side PTYs that survive page reloads.
- 🎮 **Sessions, visualized** — a dedicated tab renders every launcher session graphically,
  live: a **pixel-art office** (a character per agent, inspired by *pixel-agents*) or a
  **flow graph** (a node per session, inspired by *agent-flow*) — your pick, switchable
  any time.
- 🧠 **Prompt improver & "KI Modus"** — let any of **11 AI providers** (OpenAI, Groq,
  xAI/Grok, OpenRouter, DeepSeek, Mistral, Together, Fireworks, Perplexity, Gemini,
  Cerebras) sharpen your prompt, or split one big task into focused sub-sessions. Fully
  **optional** — without a key the app still launches and supervises Claude.
- 🎛️ **Per-launch model & effort** — pick Opus / Sonnet / Haiku / Fable and a reasoning
  effort, or keep Claude Code's defaults.
- 📋 **Session review** — an LLM reads each terminal's scrollback and reports what's done
  vs. open, as Markdown you can also have **read aloud**.
- 🎙️ **Voice in and out** — dictate prompts (speech-to-text) and an optional local
  **wake-word**, plus text-to-speech for reviews (Cartesia + Picovoice).
- 🐙 **GitHub built in** — connect a token, clone, create repos, flip visibility, and
  **commit + pull + push** in one click (never automatically).
- 🖥️ **One-click desktop app** — [download a self-contained Windows `.exe`](https://github.com/LuiInventions/Claude-code-web-manager/releases/latest);
  no Node, no terminal, keys encrypted at rest via Windows DPAPI.

---

## Features

### Local Projects

The Local Projects view scans your configured projects directory and renders a card for every
direct subfolder, showing the project **name, path, last-modified date, size, detected
tech stack**, and **Git status** (branch, clean/dirty, latest commits) plus a short
README excerpt. Click any card to open a detail view with the **full file tree** and the
**rendered README**. The list refreshes automatically and on demand.

### Launcher — run Claude Code

The Launcher is the heart of the app. The flow:

1. **Pick a project** and write a prompt.
2. **(Optional) Improve it** — your chosen AI provider rewrites the prompt to be clearer
   and more actionable before any code runs. Pick from 11 providers in Settings, or skip
   it entirely with **Start without improvement**.
3. **(Optional) KI Modus** — instead of one session, let the model **split** your task
   into 1–6 structured sub-prompts that run in parallel (e.g. "tests", "docs", "refactor").
4. **Choose model & effort** — Opus 4.8 / Sonnet 4.6 / Haiku 4.5 / Fable 5 and a reasoning
   effort (`low` → `max`), or leave both on *Standard* to use Claude Code's own defaults.
5. **Start** — Claude Code opens in a **live terminal grid of up to six sessions**, each
   box stably numbered #1–#6.

Sessions are backed by **real server-side PTYs**, so they keep running — and keep their
output — even if you reload the browser or close and reopen the desktop window. A
**usage bar** keeps token consumption visible while you work.

When a run is underway, the built-in **review assistant** reads each terminal's
scrollback, asks a language model to classify what is **already done** and what is
**still open**, and presents the result as a formatted **Markdown report** on its own
page. Reports can optionally be **read aloud** via text-to-speech (Cartesia Sonic).

### Sessions — visualize your agents

The **Sessions** tab turns the launcher's live Claude Code sessions into a graphical view —
every session you start in the Launcher shows up here within a couple of seconds, and
disappears when it's stopped. Pick the look you prefer (the choice is remembered):

- **Pixel office** — a native re-creation of
  [**pixel-agents**](https://github.com/pixel-agents-hq/pixel-agents): one shared **office
  room** (rendered on a canvas) where every session is a pixel character at its own desk.
  Each character animates to its **live activity** — typing while working, bobbing with
  thought-dots while thinking, raising an amber **"needs approval"** flag when it's waiting
  for you, a green ✓ when done, a red shake on error. **In-session subagents** (the Task
  tool) show up as smaller companions beside their parent. Hover a desk for the project,
  prompt, model, and its subagents.
- **Flow graph** — a native re-creation of
  [**agent-flow**](https://github.com/patoles/agent-flow): a **force-directed graph** of
  hex nodes. The Launcher is the root; each session is a node wired to it (**KI-Modus**
  splits fan out from a shared batch hub), and each subagent is a smaller hex linked to its
  parent. Nodes settle on their own, **pulse with their live activity colour**, and can be
  dragged around.

Both views are **built into the app** (offline, no extra install), rendered natively in the
style of the upstream projects, and driven by the same live session registry the Launcher
uses — including activity and subagent state parsed server-side — so what you see always
matches what's actually running. Full credit to the two upstream projects that inspired
each style.

### GitHub

The GitHub section lets you connect a personal access token and work with remote
repositories as if they were local projects:

- **Clone** any repo you have access to, then launch Claude Code on it just like a
  local project.
- **Create** a new repository or **change its visibility** (public ↔ private) without
  leaving the app.
- **Update** — each repo card has one button that **commits** the local changes,
  **merges in** anything the remote gained meanwhile, and **pushes**. One click, one repo.

> Pushing only ever happens when *you* press Update. Nothing is committed or pushed
> automatically.

### Settings

Choose your **AI provider** — OpenAI, Groq, xAI (Grok), OpenRouter, DeepSeek, Mistral,
Together, Fireworks, Perplexity, Google Gemini, or Cerebras (11 in all) — enter its key,
and **pick a model from a dropdown of that provider's current models**. The dropdown is
shown for **every** provider, even before you add a key, and is enriched with the
provider's live model list once a key is set. Voice, projects directory,
and **API-key status** are adjustable here too — **no server restart required**. The AI
provider is **optional**: without a key the prompt improver and session review are simply
disabled and everything else keeps working. Keys are entered here (or on the first-run
setup screen) and stored server-side — encrypted in the desktop app — and the UI only ever
shows **whether** a key is set, never its value. The app opens on the **Launcher** by
default.

---

## A typical session

```text
Local Projects ──▶ open project   Launcher ──▶ prompt ──▶ (improve / split) ──▶ Start
                                                                                  │
                                          ┌───────────────────────────────────────┘
                                          ▼
                        live terminal grid  #1  #2  #3   …  (real PTYs)
                                          │
                                          ▼
                          Review ──▶ "done / open" Markdown report ──▶ 🔊 read aloud
```

You browse to a project, hand Claude Code a task, watch it work across one or more
terminals, then ask for a review to see — in plain language — what actually got done.

---

## Quick start

There are two ways to run it. Most people want **Option A** (just an app); developers and
contributors want **Option B** (run from source).

### Option A — Desktop app (.exe)

**This is the easiest way to run the app — no Node.js, no terminal, no `npm install`.**

1. **Download the installer** from the
   [**latest release**](https://github.com/LuiInventions/Claude-code-web-manager/releases/latest):
   **`cc-control-center-Setup-<version>.exe`**.
2. **Run it.** It installs per-user (no admin rights required) and adds a Start-menu
   shortcut. The whole UI runs in its own window while the loopback server stays internal.
3. **First launch → setup screen.** Pick your projects folder (native folder picker),
   choose an AI provider and model from the dropdowns, and (optionally) enter its key.

> **Publisher & the "Unknown publisher" prompt.** The app is published by
> **LT Digital Concepts (Luis Kleemann)** — you'll see that name in the file's
> Details. Until the build is signed with a CA-issued certificate, Windows
> SmartScreen may still show an "Unknown publisher" prompt; click **More info →
> Run anyway**. The signing pipeline is wired and ready — see
> [`build/SIGNING.md`](build/SIGNING.md).

> **Updating is safe.** After installing a new version the welcome/setup screen
> runs once more (so you can re-confirm provider + model), but your data in the
> per-user profile — including your **connected GitHub token** and saved keys —
> is **kept**.

The installer is **fully self-contained** — Node, Next.js, and Claude Code's runtime
dependencies are bundled, so nothing else is downloaded at runtime. Your API keys are
stored **encrypted** (Windows DPAPI via Electron `safeStorage`) in your user profile,
never in the app folder, and stay editable later under **Settings**. User data lives in
the per-user `userData` directory, so the app keeps your settings across updates.

> You still need the **Claude Code CLI** installed and logged in. An **AI provider key**
> is **optional** (any one of 11 providers) and only powers the prompt improver, KI Modus,
> and reviews — see [Requirements](#requirements).

<details>
<summary><strong>Build the installer yourself instead</strong></summary>

```powershell
npm install
npm run electron:build
```

This produces, in `build/dist/`, a self-contained **NSIS installer**
(`cc-control-center-Setup-<version>.exe`). For developing the desktop shell,
`npm run electron:dev` runs it from source with Next.js in dev mode and DevTools available.

</details>

### Option B — From source

Open a **PowerShell** terminal.

**1. Clone**

```powershell
git clone https://github.com/LuiInventions/Claude-code-web-manager
cd Claude-code-web-manager
```

**2. Install & configure (guided)**

A PowerShell script handles install and API-key configuration end to end:

```powershell
.\setup.ps1
```

It will: verify Node.js and git are available → run `npm install` → create `.env.local`
from `.env.example` → interactively prompt for `OPENAI_API_KEY`, an optional
`CARTESIA_API_KEY`, and your projects folder, and write them into `.env.local`.

If PowerShell blocks the script, run it once for the current process only:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

**3. Start**

```powershell
npm run dev
```

Then open **http://127.0.0.1:3100**. If any required setting is missing, the app greets you
with the same **first-run setup screen** as the desktop build, so you can finish
configuration in the browser.

<details>
<summary><strong>Manual install (instead of <code>setup.ps1</code>)</strong></summary>

```powershell
npm install
copy .env.example .env.local
#   -> set OPENAI_API_KEY (or have it in the shell environment)
#   -> set PROJECTS_DIR if you want a folder other than ./projects
npm run dev
```

</details>

---

## Requirements

- **Windows 11**, **Node.js ≥ 20.9** (developed/tested on Node 24)
- **git** on your `PATH`
- **Claude Code CLI** (`claude`) installed and logged in
- *(Optional)* an API key for **any one of 11 AI providers** (OpenAI, Groq, xAI/Grok,
  OpenRouter, DeepSeek, Mistral, Together, Fireworks, Perplexity, Gemini, Cerebras) —
  powers the prompt improver, KI Modus, and reviews. Without one the app still launches
  and supervises Claude; only these AI features are disabled.
- *(Optional)* a **Cartesia API key** for voice (speech-to-text input + reading reviews
  aloud), and a **Picovoice access key** for the local wake-word. Everything else works
  without them.

---

## Configuration

Settings come from `.env.local` **or** the in-app **Settings page** / first-run screen.
Precedence, highest first: **Settings UI** (`.data/settings.json`) → **environment**
(`.env.local`) → **built-in default**.

| Variable | What it controls | Default |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI key — prompt improver, KI Modus, reviews. **Server-side only.** | – *(optional)* |
| `GROQ_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `TOGETHER_API_KEY`, `FIREWORKS_API_KEY`, `PERPLEXITY_API_KEY`, `GEMINI_API_KEY`, `CEREBRAS_API_KEY` | Keys for the other 10 AI providers. Server-side only. | – *(optional)* |
| `OPENAI_MODEL` | Legacy OpenAI model (provider + model are normally chosen in Settings → `aiProvider` / `aiModel`) | `gpt-5.4-mini` |
| `CARTESIA_API_KEY` | Cartesia key — voice in (STT) + out (TTS). Server-side only. | – *(optional)* |
| `CARTESIA_VOICE` | TTS voice (selectable in Settings) | Sebastian – Orator |
| `CARTESIA_TTS_MODEL` | Text-to-speech model | `sonic-turbo` |
| `CARTESIA_STT_MODEL` | Speech-to-text model | `ink-whisper` |
| `VOICE_LANGUAGE` | Voice language | `de` |
| `PICOVOICE_ACCESS_KEY` | Local wake-word (Porcupine) — optional | – |
| `PROJECTS_DIR` | Folder whose direct subfolders are treated as projects | `./projects` (inside the app) |
| `GITHUB_DIR` | Where cloned GitHub repos land | `./projects/github` |
| `HOST` | Bind address — **do not change** | `127.0.0.1` |
| `PORT` | Port | `3100` |
| `CLAUDE_BIN` | Explicit path to the Claude CLI | auto (`where claude`) |

> **Keys never reach the frontend.** They are used server-side only; the UI shows just
> *whether* each key is set. In a source checkout, keys entered via the setup/Settings
> screens are written to a gitignored `.data/secrets.json`; in the desktop build they are
> encrypted with Windows DPAPI.

Paths default to folders **inside the app directory** (not your home folder), so a fresh
checkout is self-contained. Point `PROJECTS_DIR` / `GITHUB_DIR` elsewhere via the Settings
UI or environment variables (use absolute paths).

---

## How it works

A **custom Node server** (`server.ts`) binds to `127.0.0.1` and hosts both Next.js and a
**`ws` WebSocket server** on the same port: HMR upgrades go to Next, everything under
`/ws/*` goes to us. Claude Code sessions stream over WebSocket (`/ws/claude-pty`,
`/ws/claude`) and run as real **`node-pty`** PTYs on the server, which is why they survive
reloads. Git runs via `child_process`; an **OpenAI-compatible SDK** (Chat Completions,
across all 11 providers) powers prompt improvement, splitting, and review; **Cartesia**
handles voice; the desktop shell is **Electron**.

```text
server.ts                Custom server: Next + ws, binds 127.0.0.1
lib/
  config.ts              Configuration (env + settings.json + secrets)
  secrets.ts             API-key storage (DPAPI in desktop, .data file in dev)
  paths.ts, store.ts     Path / JSON helpers
  projects.ts            Project scan
  stack-detect.ts        Stack / framework detection
  git.ts                 Git status
  indexer.ts             Persistent project index
  openai.ts              OpenAI client + model list
  prompt-improver.ts     Prompt improvement for Claude
  prompt-splitter.ts     "KI Modus" — split one prompt into sub-sessions
  session-review.ts      Session review: output context + LLM → {markdown, speech}
  console-read.ts        PTY scrollback → readable text tail
  usage-store.ts         Token-usage tracking for the launcher
  voice.ts               Cartesia STT + TTS
  launcher-store.ts      Launcher history
  window-instances.ts    Stable #1–#N numbering
  server/
    ws-hub.ts            WebSocket dispatch (/ws/*)
    claude-pty.ts        Server-side Claude sessions (PTY registry)
    claude-runner.ts     Spawns Claude Code, parses stream-json
    bot-collect.ts       Collects live + persisted sessions
app/
  api/                   Route handlers (fs, projects, index, launcher
                         [improve, split, review, sessions, usage], settings,
                         models, secrets, open, github [+ create, update,
                         visibility, changes], voice [tts, voices])
  components/            Shell, sections (Local Projects/Launcher/Sessions/GitHub/Settings),
                         sessions/ (pixel-office + flow-graph views), setup
build/                   Electron wrapper + electron-builder config + build scripts
.data/                   Local storage (gitignored): settings.json, secrets.json,
                         index.json, launcher.json
```

---

## Scripts

```powershell
npm run dev            # Dev server (custom server.ts, watch mode)
npm run build          # Production build (Next, compile mode)
npm run start          # Production server
npm run test           # Unit tests (vitest)
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint
npm run electron:dev   # Desktop app from source (own window, DevTools)
npm run electron:build # Self-contained Windows .exe -> build/dist/
```

**Tech stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v4 ·
Electron · `ws` · `node-pty` · OpenAI SDK · Cartesia · `xterm.js` · `highlight.js` ·
`react-markdown` · `lucide-react`.

---

## Security

- **Loopback only** — the server binds hard to `127.0.0.1`. Do not set `HOST` to
  `0.0.0.0`; this app has no authentication and is meant for one local user.
- **Full privileges** — the Launcher runs commands with *your* user privileges, by design.
  Run it locally, only for yourself.
- **Claude Code runs with `--dangerously-skip-permissions`** and can modify files in the
  selected project folder. Review the (improved) prompt before you press Start.
- **No secrets in the frontend** — API keys stay server-side; the UI only reports whether
  a key is set. In the desktop build keys are encrypted at rest (Windows DPAPI).

---

## License

MIT — see [LICENSE](LICENSE).
