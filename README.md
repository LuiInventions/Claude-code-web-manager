# Claude Code Control Center

A local **control center** for your projects and **Claude Code** — a web app that
runs **exclusively on `127.0.0.1`** and starts, manages, and reviews multiple
Claude Code sessions.

<img width="1920" height="1080" alt="Desktop Screenshot 2026 06 28 - 19 27 23 07" src="https://github.com/user-attachments/assets/961f27e3-c90e-4594-bbbc-ce2fa462e56b" />

> ⚠️ **Security warning — this app is intentionally powerful.**
> It can launch **Claude Code in `--dangerously-skip-permissions` mode** and push
> repositories. It is meant **for local, personal use only** and therefore binds
> **exclusively to the loopback address** (`127.0.0.1`). **Never** expose it
> externally (no `0.0.0.0`, no reverse proxy, no port forwarding).

---

## Features

### Dashboard

The dashboard scans your configured `PROJECTS_DIR` and shows a card for every
direct subfolder — including project name, path, last-modified date, size,
detected tech stack, Git status (branch, dirty/clean state, most recent
commits), and a README excerpt. Clicking a card opens a detail view with a
full file tree and rendered README. The list refreshes automatically and on
demand.

### Claude Code Session Management

The **Launcher** is where you start and supervise Claude Code sessions. You
choose a project, write a prompt, and optionally let an OpenAI model sharpen
it before work begins. Claude Code then opens in a live terminal grid of up to
six parallel sessions — each box stably numbered #1–#6. Sessions are backed by
real server-side PTYs, so they survive browser reloads without losing output.

Once sessions are running, the built-in **review assistant** reads each
terminal's scrollback, asks a language model to classify what is already done
and what is still open, and presents the result as a formatted Markdown report
on its own page. The report can optionally be read aloud via text-to-speech
(Cartesia Sonic).

### GitHub Integration

The GitHub section lets you clone any repository you have access to and work
on it with Claude Code exactly like a local project. Each repo card has an
**Update** button that commits the local folder's changes, merges in anything
the remote gained in the meantime, and pushes — one click, one repo. Pushing
only happens when you press it; it never happens automatically.

### Settings

Model, voice, API key status, and other runtime options can be adjusted at any
time through the Settings page — no server restart required.

---

## Tech stack

- **Next.js 16** (App Router) + **TypeScript** + **React 19** + **Tailwind CSS v4**
- **Custom Node server** (`server.ts`) — binds to `127.0.0.1`, hosts Next plus a
  **`ws` WebSocket server**; HMR upgrades go to Next, `/ws/*` to us.
- **`node-pty`** (real PTYs for the Claude sessions), **`child_process`** (Git)
- **OpenAI SDK** — Responses API (prompt improvement + session review)
- **Cartesia** — TTS (Sonic) for reading the reviews aloud
- **`xterm.js`**, **`highlight.js`**, **`react-markdown`**, **`lucide-react`**

---

## Requirements

- **Windows 11**, **Node.js ≥ 20.9** (developed/tested with Node 24)
- **git** on your `PATH`
- **Claude Code CLI** (`claude`) installed and logged in
- An **OpenAI API key** (prompt improver + review). For reading reviews aloud you
  additionally need a **Cartesia API key** (TTS) — without it everything works
  except the speech output.

---

## Setup

Open powershell terminal

### 1 — Clone the repository

```powershell
git clone https://github.com/LuiInventions/Claude-code-web-manager
```

```powershell
cd Claude-code-web-manager
```

### 2 — Install & configure

A PowerShell script handles installation and API-key configuration end to end:

```powershell
# From the project root, in PowerShell:
.\setup.ps1
```

The script will:

1. Verify Node.js and git are available.
2. Run `npm install`.
3. Create `.env.local` from `.env.example` if it does not exist yet.
4. Interactively prompt for your `OPENAI_API_KEY`, optional `CARTESIA_API_KEY`,
   and `PROJECTS_DIR`, then write them into `.env.local`.

If PowerShell blocks the script, run it once for the current process only:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

Then start the dev server and open the app:

```powershell
npm run dev
```

Open in your browser: **http://127.0.0.1:3100**

### Manual setup (alternative)

```powershell
npm install
copy .env.example .env.local
#   -> set OPENAI_API_KEY (or have it set in the shell environment)
#   -> set PROJECTS_DIR to your projects folder
npm run dev
```

---

## Configuration

Configured via `.env.local` **or** at runtime via the **Settings page**.
Priority order (highest first): `.data/settings.json` (Settings UI) →
`.env.local` → default.

| Variable | Meaning | Default |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI key — **server-side only**, never in the frontend | – (required) |
| `OPENAI_MODEL` | Model for prompt improver & review | `gpt-5.4-mini` |
| `CARTESIA_API_KEY` | Cartesia key — TTS (read reviews aloud); server-side only | – (for speech output) |
| `CARTESIA_VOICE` | Cartesia voice; selectable in Settings | Sebastian – Orator |
| `CARTESIA_TTS_MODEL` | TTS model | `sonic-turbo` |
| `PROJECTS_DIR` | Folder whose direct subfolders are treated as projects | your home folder |
| `HOST` | Bind address — **do not change** | `127.0.0.1` |
| `PORT` | Port | `3100` |
| `CLAUDE_BIN` | Optional explicit path to the Claude CLI | auto (`where claude`) |

> API keys are used **server-side only** and never reach the frontend. The
> Settings page only shows **whether** a key is set.

---

## Scripts

```powershell
npm run dev        # Dev server (custom server.ts, watch mode)
npm run build      # Production build (Next)
npm run start      # Production server
npm run test       # Unit tests (vitest)
npm run typecheck  # tsc --noEmit
npm run lint       # ESLint
```

---

## Architecture

```
server.ts                Custom server: Next + ws, binds 127.0.0.1
lib/
  config.ts              Configuration (env + settings.json)
  paths.ts, store.ts     Path / JSON helpers
  projects.ts            Project scan
  stack-detect.ts        Stack / framework detection
  git.ts                 Git status
  indexer.ts             Persistent project index
  openai.ts              OpenAI client + model list
  prompt-improver.ts     Prompt improvement for Claude
  session-review.ts      Session review: output context + LLM → {markdown, speech}
  console-read.ts        PTY scrollback → readable text tail
  bot-summary.ts         Structured session overview (pure)
  voice.ts               Cartesia TTS
  launcher-store.ts      Launcher history
  window-instances.ts    Stable #1–#N numbering
  server/
    ws-hub.ts            WebSocket dispatch (/ws/*)
    claude-pty.ts        Server-side Claude sessions (PTY registry)
    claude-runner.ts     Spawns Claude Code, parses stream-json
    bot-collect.ts       Collects live + persisted sessions
app/
  api/                   Route handlers (fs, projects, index, launcher
                         [incl. /launcher/review], settings, models, open,
                         github [incl. /github/update], voice [tts, voices])
  components/            Shell, UI primitives, sections
.data/                   Local storage (gitignored):
                         settings.json, index.json, launcher.json
```

Live streaming: **WebSocket** for the Claude sessions (`/ws/claude-pty`,
`/ws/claude`).

---

## Security notes

- **Loopback only:** the server binds hard to `127.0.0.1`. Do not change `HOST`.
- **Full privileges:** the Claude launcher runs commands with your user
  privileges. This is intentional — run the app locally and only for yourself.
- **Claude Code** is started with `--dangerously-skip-permissions` and can modify
  files in the selected project folder. Review the (improved) prompt before
  starting.
- **No secrets in the frontend:** API keys stay server-side.

---

## License

MIT — see [LICENSE](LICENSE).
