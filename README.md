# Claude Code Control Center

A local **control center** for your projects and **Claude Code** — a web app that
runs **exclusively on `127.0.0.1`** and starts, manages, and reviews multiple
Claude Code sessions.

<img width="1920" height="1080" alt="Desktop Screenshot 2026 06 28 - 19 27 23 07" src="https://github.com/user-attachments/assets/961f27e3-c90e-4594-bbbc-ce2fa462e56b" />

---

## Features

### Local Projects

The Local Projects view scans your configured `PROJECTS_DIR` and shows a card for every
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

Choose your **AI provider** (OpenAI, Groq, xAI/Grok, OpenRouter, DeepSeek,
Mistral, Together, Fireworks, Perplexity, Google Gemini, Cerebras — 11 in all),
enter its API key, and pick a model. Voice and other runtime options are here
too — no server restart required. The AI provider is **optional**: without a key
the prompt improver and session review are simply disabled, and everything else
keeps working. The app opens on the **Launcher** by default.

---

## Tech stack

- **Next.js 15** (App Router) + **TypeScript** + **React 19** + **Tailwind CSS v4**
- **Electron** desktop shell (optional) — packages the whole thing as a Windows `.exe`
- **Custom Node server** (`server.ts`) — binds to `127.0.0.1`, hosts Next plus a
  **`ws` WebSocket server**; HMR upgrades go to Next, `/ws/*` to us.
- **`node-pty`** (real PTYs for the Claude sessions), **`child_process`** (Git)
- **OpenAI SDK** — chat completions across **11 OpenAI-compatible providers**
  (OpenAI, Groq, xAI, OpenRouter, DeepSeek, Mistral, Together, Fireworks,
  Perplexity, Gemini, Cerebras) for prompt improvement + session review
- **Cartesia** — TTS (Sonic) for reading the reviews aloud
- **`xterm.js`**, **`highlight.js`**, **`react-markdown`**, **`lucide-react`**

---

## Requirements

- **Windows 11**, **Node.js ≥ 20.9** (developed/tested with Node 24)
- **git** on your `PATH`
- **Claude Code CLI** (`claude`) installed and logged in
- **Optional:** an API key for any one of the 11 AI providers (prompt improver +
  review). Without it the app still launches and supervises Claude sessions —
  only the AI-assisted features are disabled. For reading reviews aloud you also
  need a **Cartesia API key** (TTS).

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
| `OPENAI_API_KEY` | OpenAI key — **server-side only**, never in the frontend | – (optional) |
| `GROQ_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `TOGETHER_API_KEY`, `FIREWORKS_API_KEY`, `PERPLEXITY_API_KEY`, `GEMINI_API_KEY`, `CEREBRAS_API_KEY` | Keys for the other AI providers — server-side only | – (optional) |
| `CARTESIA_API_KEY` | Cartesia key — TTS (read reviews aloud); server-side only | – (for speech output) |
| `CARTESIA_VOICE` | Cartesia voice; selectable in Settings | Sebastian – Orator |
| `CARTESIA_TTS_MODEL` | TTS model | `sonic-turbo` |
| `PROJECTS_DIR` | Folder whose direct subfolders are treated as projects | your home folder |
| `HOST` | Bind address — **do not change** | `127.0.0.1` |
| `PORT` | Port | `3100` |
| `CLAUDE_BIN` | Optional explicit path to the Claude CLI | auto (`where claude`) |

> The active provider + model are chosen in **Settings** (stored in
> `.data/settings.json` as `aiProvider` / `aiModel`). API keys are used
> **server-side only** and never reach the frontend — the Settings page only
> shows **whether** a key is set. In the desktop app keys are encrypted.

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

---

## Desktop app (.exe)

The control center can be packaged as a standalone **Windows desktop app** that
renders the whole UI in its own window while still running the server on
`127.0.0.1` internally.

```powershell
npm run electron:build
```

This produces, in `build/dist/`, an **NSIS installer** and a **portable**
`.exe` — both self-contained (no `npm install` or internet needed at runtime).
On first launch the app shows a **setup screen** asking for your projects folder
(with a native folder picker) and API keys. Keys are stored **encrypted**
(Windows DPAPI via Electron `safeStorage`) in your user profile — never in the
project folder — and remain editable later under **Settings**. User data
(`settings.json`) is written to the per-user `userData` directory, so an
installed app keeps working across updates.

For development with the desktop shell (runs from source, Next in dev mode):

```powershell
npm run electron:dev
```

All Electron wrapper code and the build output live under `build/`.

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
