# Jarvis Control Center

> Mission control for **Claude Code**, **Grok**, and **ChatGPT Codex** — on this PC,
> in a cloned GitHub repo, or over SSH on your own server. The app itself binds to **`127.0.0.1`**.

<p align="center">
  <a href="https://github.com/LuiInventions/jarvis-control-center/releases/latest">
    <img alt="Download the Windows installer" src="https://img.shields.io/badge/⬇%20Download-Windows%20Installer%20(.exe)-2ea44f?style=for-the-badge&logo=windows&logoColor=white" />
  </a>
  &nbsp;
  <a href="https://github.com/LuiInventions/jarvis-control-center/releases/latest">
    <img alt="Latest release" src="https://img.shields.io/github/v/release/LuiInventions/jarvis-control-center?style=for-the-badge&label=latest&color=24292e" />
  </a>
</p>

<p align="center">
  <b>No Node, no terminal, no setup</b> — grab the installer and you're running in two
  clicks. Prefer source? Jump to <a href="#option-b--from-source">Option B</a>.
</p>

> [!TIP]
> **v1.9.24** is the current release. The sidebar order is **Remote**, **GitHub**,
> **Local**, **Repos**, **Sessions**, **Jarvis**. Jarvis is a chat with GPT 6 Luna
> that drives the app through the local MCP server and keeps the conversation.
> Running GitHub, Local, and Remote sessions are numbered, and a tool reads a
> session's command-window text. Remote starts a code CLI on your server and
> can upload and download files there. Dropping or choosing a folder asks for
> confirmation, then uploads it. **Bild hochladen** pastes images into a new
> `image_set` folder. Older sets are buttons in one row. Choosing one shows the
> pictures saved on this PC, and the set can be deleted.
> **Dateien hochladen** and **Bild hochladen** are also on GitHub and Local and
> write into the folder on this PC. **Repos → New repo** creates the repository
> in the clones folder. That path is fixed. **Repos → Update** commits local
> changes, merges what GitHub gained, and pushes.
> The installer is `jarvis-control-center-Setup-1.9.24.exe`. v1.8.0 was withdrawn.
> v1.9.6 has no installer. [**Changelog**](CHANGELOG.md)

<img width="1920" height="1080" alt="Jarvis Control Center" src="https://github.com/user-attachments/assets/961f27e3-c90e-4594-bbbc-ce2fa462e56b" />

---

## What it is

A terminal gives you one session, no view of the server, and a manual `git add` /
`git commit` / `git push` after the agent is done.

**Jarvis Control Center** is one window for the whole loop:

- **Remote** — log into your server with SSH and start Claude Code, Grok, or Codex there, in a folder you pick, with the server's files beside the terminal.
- **GitHub** — start the same CLI inside a repo you cloned. **Repos** keeps the token, the clone, and a one-click **Update** that commits and pushes for you.
- **Local** — the same launcher against a folder on this PC.
- **Sessions** — every running agent as a character in a pixel office
- **Jarvis** — a chat with GPT 6 Luna. It calls the local MCP tools, including the numbered session lists and the command-window read.

It ships as a **Windows desktop app**
([**download the `.exe`**](https://github.com/LuiInventions/jarvis-control-center/releases/latest))
or as a **web app** you start from source. The control center listens only on
loopback. Remote is an SSH session *from* that app out to a host you name.

---

## Table of contents

- [Highlights](#highlights)
- [Features](#features)
  - [Remote](#remote)
  - [GitHub and Repos](#github-and-repos)
  - [Local](#local)
  - [VS Codium](#vs-codium)
  - [Files](#files)
  - [Sessions](#sessions)
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

- 🛰️ **Remote first** — `user@IP`, then the password and a 2FA code only when SSH asks. **Starten** opens 1–6 live terminals on the server, reusing the login that is already open.
- 🐙 **GitHub, with the commit written for you** — connect a token, clone, create a repo, flip public/private. **Update** lists the changed files, then commits them (`Update via Control Center`), merges remote commits, and pushes.
- 📁 **Clones survive an upgrade** — they live in `%LOCALAPPDATA%\Jarvis Control Center\github_repos`, outside the program folder the installer replaces. A missing clone is fetched again with the saved token.
- 📤 **Remote files** — upload into the current server folder, and download a file or folder onto this PC.
- 🚀 **Claude Code, Grok, or ChatGPT Codex** — pick the CLI once. Local, GitHub, and Remote all start that CLI. Up to six sessions, real server-side PTYs that survive a reload.
- 📄 **Click a file** — Local, GitHub, and Remote open it where the terminals sit. CodeMirror for text; images, PDF, audio, and video in the viewer.
- 🎮 **Sessions office** — running agents as pixel characters, labeled **GitHub**, **Lokal**, or **Server**.
- 🎨 **Six themes** — Dusk is the default. Ink, Moss, Tide, Clay, and Plum sit next to it.
- 🔒 **Loopback app, encrypted keys** — the window talks to `127.0.0.1`. API keys and the GitHub token are encrypted at rest in the desktop build (Windows DPAPI).

---

## Features

The sidebar, top to bottom: **Remote**, **GitHub**, **Local**, **Repos**, **Sessions**, then **Settings**.

### Remote

Remote is the first tab. It is how you run a code CLI on a machine that is not this PC.

1. Enter **`user@IP`** (or pick a saved server) and press **Verbinden**. SSH starts in the background. The password field appears when the server asks for a password, and the 2FA field when it asks for a code. The code is not stored. **IP und Passwort speichern** keeps the host, user, and password.
2. Once you are in, the left rail matches the other launchers: **Session count** (1–6), **Ordner**, **Starten**, and the server's file list. The connected IP is shown in green next to **Trennen**.
3. **Starten** opens that many terminals in the folder in **Ordner**. Each one is the code CLI from Settings (Claude Code, Grok, or Codex), with an empty prompt, so you talk to it in the terminal. The CLI reuses the SSH login that is already open. A second connection is not started.
4. Click a folder in the list to put that path into **Ordner**. Left-click a file to open it. **Dateien** and **Sessions** switch the main area between the file and the terminals. **Dateien hochladen** sends files into that folder. Right-click a file or folder and choose **Herunterladen** to save it on this PC.

A saved server can be chosen again from the dropdown. **Trennen** closes the session.

### GitHub and Repos

Two tabs share one clone:

- **GitHub** starts the code CLI in a cloned repo. The rail is a **Repo** dropdown, **Session count**, **Starten**, and that repo's files. Without a connected account the tab asks you to connect GitHub under **Repos**.
- **Repos** is the account. Paste a personal access token, clone repos you can see, create a repository (public or private) in the clones folder, and change visibility later. The folder path for a new repo is fixed.

Cloned repos are stored in `%LOCALAPPDATA%\Jarvis Control Center\github_repos`
(a source checkout uses `github_repos` in the working directory). **Ordner öffnen**
on GitHub opens that folder. An upgrade deletes the program folder and leaves
the clones in place. A clone whose folder is gone is cloned again with the saved
token. A clone that is still on disk is moved and keeps its files.

Each repo card lists uncommitted files — edits from the CLI, from VS Codium, or
by hand. **Update** opens those files, and **Pushen** then:

1. `git add -A` and a commit with the message `Update via Control Center`, when the working tree is dirty.
2. `git fetch`, then a merge when the remote is ahead. A conflict aborts the merge. A commit from step 1 stays.
3. `git push` to `origin/<branch>`.

The GitHub token is sent as an auth header for that call. It is not written into `.git/config`.

`git user.name` and `git user.email` have to be set on the machine, or the commit step stops.

### Local

local is the same rail against a folder on this PC: **Session count**, **Ordner**, **Starten**, the file list, and **Ordner öffnen** (the projects folder from Settings). **Starten** opens the selected code CLI there. Clicking a subfolder writes that path into **Ordner**.

A Claude Code session shows the usage bar. Grok and Codex do not.

### VS Codium

VS Codium is not in the sidebar in this release, and it is not started with the app. The section below describes the editor as it worked when the tab was shown: `codium serve-web` (or `code serve-web` when Codium is not installed) in the Local folder. **Neu laden** refreshes it. **Erneut versuchen** starts it again.

The editor is on this PC. The Remote SSH login is separate and is not used to open it.

On Windows the `.cmd` shim is started through `cmd.exe`, so `serve-web` actually returns its port.

### Files

A left-click in the file list on **Local**, **GitHub**, or **Remote** opens the file in the area the terminals use. Text opens in CodeMirror with line numbers and color, and can be edited and saved. Images, PDF, audio, and video use the viewer. While a session is running, **Dateien** and **Sessions** switch that area. Folder lists use **Zurück**.

### Sessions

The **Sessions** tab draws every launcher session that is still running as a pixel office, in the style of [pixel-agents](https://github.com/pixel-agents-hq/pixel-agents). The office is built into the app.

Each character has its own name. Above the name is where it was started: **GitHub**, **Lokal**, or **Server**. Clicking the name opens that tab. The pose follows the live tool — typing, reading, a shell command, waiting — and in-session subagents are their own small characters. The assets ship with the app.

### Settings

- **Code CLI** — Claude Code (`claude`), Grok (`grok`), or ChatGPT Codex (`codex`). Local, GitHub, and Remote all start this binary. Model and effort stay on the CLI's own defaults (**Standard**).
- **Theme** — Ink, Dusk, Moss, Tide, Clay, Plum. Dusk is used when none is saved.
- **AI provider** *(optional)* — OpenAI, Groq, xAI (Grok), OpenRouter, DeepSeek, Mistral, Together, Fireworks, Perplexity, Google Gemini, or Cerebras. Pick a model from that provider's list. The key stays server-side. The UI shows only whether it is set.
- **Voice** *(optional)* — Cartesia for speech-to-text and reading text aloud, Picovoice for a local wake-word.
- **Projects folder** — the directory Local treats as home. A native folder picker is used in the desktop app.

The first-run screen asks for the projects folder, the code CLI, and an optional provider key. After an update that screen runs once more. The GitHub token, saved keys, and clones stay.

---

## A typical session

```text
Remote ──▶ user@IP ──▶ SSH ──▶ Ordner ──▶ Starten ──▶ CLI on the server
GitHub ──▶ pick a clone ──▶ Starten ──▶ CLI in the repo ──▶ Repos ──▶ Update
Local  ──▶ Ordner ──▶ Starten ──▶ CLI here ──▶ VS Codium on the same folder
                                      │
                                      ▼
                    live terminals  #1 … #6    Dateien ⇄ Sessions
                                      │
                                      ▼
                         Sessions office  (GitHub / Lokal / Server)
```

You connect, start the CLI, watch it in the terminal or the office, open files beside it, and send the repo back to GitHub with **Update**.

---

## Quick start

Most people want **Option A**. **Option B** is for running from source.

### Option A — Desktop app (.exe)

**No Node.js, no terminal, no `npm install`.**

1. **Download the installer** from the
   [**latest release**](https://github.com/LuiInventions/jarvis-control-center/releases/latest):
   **`jarvis-control-center-Setup-<version>.exe`**.
2. **Run it.** It installs per-user (no admin rights) and adds a Start-menu shortcut. The UI is its own window. The loopback server stays inside the process.
3. **First launch → setup screen.** Pick your projects folder, choose the code CLI (Claude Code, Grok, or ChatGPT Codex), and optionally an AI provider and key.

> **Publisher.** The app is published by **LT Digital Concepts (Luis Kleemann)**.
> Until the build is signed with a CA-issued certificate, Windows SmartScreen may
> show an "Unknown publisher" prompt. Click **More info → Run anyway**. The
> signing pipeline is described in [`build/SIGNING.md`](build/SIGNING.md).

> **Updating keeps your data.** The welcome screen runs once so you can
> re-confirm the provider and model. The per-user profile — GitHub token, saved
> keys, saved SSH logins — stays. Clones live under
> `%LOCALAPPDATA%\Jarvis Control Center\github_repos`, so replacing the program
> folder does not delete them.

The installer bundles Node and the app runtime. You still install the **code CLI**
you selected (`claude`, `grok`, or `codex`) and log in to it. Remote needs the
**OpenSSH Client**. VS Codium needs **VS Codium** or **VS Code** on this PC.
Keys are encrypted with Windows DPAPI in your user profile.

<details>
<summary><strong>Build the installer yourself instead</strong></summary>

```powershell
npm install
npm run electron:build
```

This produces, in `build/dist/`, a self-contained **NSIS installer**
(`jarvis-control-center-Setup-<version>.exe`). For developing the desktop shell,
`npm run electron:dev` runs it from source with Next.js in dev mode and DevTools available.

</details>

### Option B — From source

Open a **PowerShell** terminal.

**1. Clone**

```powershell
git clone https://github.com/LuiInventions/jarvis-control-center
cd jarvis-control-center
```

**2. Install & configure (guided)**

```powershell
.\setup.ps1
```

It verifies Node.js and git, runs `npm install`, creates `.env.local` from
`.env.example`, and prompts for `OPENAI_API_KEY`, an optional `CARTESIA_API_KEY`,
and your projects folder.

If PowerShell blocks the script:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

**3. Start**

```powershell
npm run dev
```

Then open **http://127.0.0.1:3100**. Missing settings show the same first-run screen as the desktop build.

In a source checkout, GitHub clones land in `github_repos` inside the working directory.

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

- **Windows 11**, **Node.js ≥ 20.9** (developed and tested on Node 24) for a source checkout. The installer does not need Node.
- **git** on your `PATH`, with `user.name` and `user.email` set (Repos → Update commits as you).
- **One code CLI**, installed and logged in: **Claude Code** (`claude`), **Grok** (`grok`, [Grok Build](https://x.ai/cli)), or **ChatGPT Codex** (`codex`).
- **OpenSSH Client** for the Remote tab (`ssh.exe`, the Windows optional feature).
- **VS Codium** or **VS Code** for the editor tab. Codium is preferred when both are installed.
- *(Optional)* an API key for one of 11 AI providers — OpenAI, Groq, xAI/Grok, OpenRouter, DeepSeek, Mistral, Together, Fireworks, Perplexity, Gemini, Cerebras.
- *(Optional)* a **Cartesia** key for voice, and a **Picovoice** key for the local wake-word.

---

## Configuration

Settings come from `.env.local` **or** the in-app **Settings** page / first-run screen.
Precedence, highest first: **Settings UI** (`.data/settings.json`) → **environment**
(`.env.local`) → **built-in default**.

| Variable | What it controls | Default |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI key. **Server-side only.** | – *(optional)* |
| `GROQ_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `TOGETHER_API_KEY`, `FIREWORKS_API_KEY`, `PERPLEXITY_API_KEY`, `GEMINI_API_KEY`, `CEREBRAS_API_KEY` | Keys for the other providers. Server-side only. | – *(optional)* |
| `OPENAI_MODEL` | Legacy OpenAI model. Provider and model are chosen in Settings (`aiProvider` / `aiModel`). | `gpt-5.4-mini` |
| `CARTESIA_API_KEY` | Cartesia key — voice in (STT) and out (TTS). Server-side only. | – *(optional)* |
| `CARTESIA_VOICE` | TTS voice (selectable in Settings) | Sebastian – Orator |
| `CARTESIA_TTS_MODEL` | Text-to-speech model | `sonic-turbo` |
| `CARTESIA_STT_MODEL` | Speech-to-text model | `ink-whisper` |
| `VOICE_LANGUAGE` | Voice language | `de` |
| `PICOVOICE_ACCESS_KEY` | Local wake-word (Porcupine) | – |
| `PROJECTS_DIR` | Folder Local starts from, until you pick another in the app | `./projects` |
| `HOST` | Bind address. Leave this. | `127.0.0.1` |
| `PORT` | Port | `3100` |
| `CLAUDE_BIN` | Explicit path to the Claude CLI | auto (`where claude`) |

The code CLI is `codeCli` in `.data/settings.json`: `claude`, `grok`, or `codex`.

**Clone folder.** The desktop app sets `CCC_GITHUB_DIR` to
`%LOCALAPPDATA%\Jarvis Control Center\github_repos` before the server starts.
A dev run uses `<cwd>/github_repos`. That path is not a Settings field.

> **Keys never reach the frontend.** The UI shows whether each key is set. In a
> source checkout, keys from setup or Settings go to a gitignored
> `.data/secrets.json`. In the desktop build they are encrypted with Windows DPAPI.

`PROJECTS_DIR` defaults to a folder inside the app directory. Point it elsewhere
from Settings or the environment (absolute path).

---

## How it works

A **custom Node server** (`server.ts`) binds to `127.0.0.1` and hosts Next.js and a
**`ws` WebSocket server** on the same port. Code-CLI sessions stream over WebSocket
and run as **`node-pty`** PTYs, which is why they survive a reload.

**Remote** opens one OpenSSH session (`ssh.exe`). After login, a broker inside
that same session starts the code CLI. A second SSH connection is not opened.
Server files are listed and read through that session.

**Repos → Update** calls `gitSyncAndPush`: commit when the tree is dirty, fetch,
merge, push. The token rides on the git command as an HTTP header.

**VS Codium** spawns `serve-web` on the Local folder and the window embeds that URL.

```text
server.ts                  Next + ws, binds 127.0.0.1
lib/
  config.ts                Env + settings.json + secrets
  code-clis.ts             Claude Code, Grok, ChatGPT Codex
  git.ts                   Status, and Update (commit + merge + push)
  github-store.ts          Connected repos
  remote-ssh.ts            SSH login, saved servers
  editor-bin.ts            VS Codium / VS Code spawn (Windows .cmd shim)
  server/
    claude-pty.ts          PTY registry
    remote-broker.ts       SSH session forward
    remote-session.ts      CLI on the connected server
    local-codium.ts        serve-web on the Local folder
    codium-proxy.ts        Loopback proxy in front of the editor
app/
  components/sections/     Remote, GitHub, Local, Repos, VS Codium, Sessions
  api/remote, api/github, api/codium
build/                     Electron main, preload, NSIS installer
```

Desktop user data (settings, secrets, launcher state) lives in the Electron
`userData` directory. Clones live beside it, under Local AppData, so an
installer upgrade can replace the program folder and leave the repos.

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
Electron · `ws` · `node-pty` · CodeMirror 6 · OpenAI SDK · Cartesia · `xterm.js` ·
`highlight.js` · `react-markdown` · `lucide-react`.

---

## Security

- **Loopback only.** The server binds to `127.0.0.1`. Leave `HOST` as it is. The app has no login of its own and is meant for one person on this PC.
- **Remote is outbound SSH.** You type the host. The password can be saved. The 2FA code is not. The code CLI then runs as that user on that server.
- **The CLI runs with your privileges, and permission prompts are skipped** for sessions started here: Claude Code uses `--dangerously-skip-permissions`, Grok uses `--permission-mode bypassPermissions`, Codex uses `--dangerously-bypass-approvals-and-sandbox`.
- **Update pushes when you press Pushen** on the file list for that repo. The commit message is `Update via Control Center`.
- **Secrets stay server-side.** The UI reports whether a key is set. The desktop build encrypts keys at rest with Windows DPAPI. The GitHub token is not written into `.git/config`.

---

## License

MIT — see [LICENSE](LICENSE).
