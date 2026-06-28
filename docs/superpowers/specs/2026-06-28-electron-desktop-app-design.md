# Electron Desktop App — Design Spec

**Date:** 2026-06-28
**Project:** Claude Code Control Center
**Status:** Approved (brainstorming) → ready for implementation planning

## Goal

Ship the existing Next.js + custom Node control center as a standalone Windows
desktop application (`.exe`) with its own application window. The app still runs
its server on `127.0.0.1` internally (loopback only). On first run it prompts for
the API keys and the projects folder; all of these remain editable in Settings.

## Constraints (explicit user requirements)

1. **Standalone windowed app** — a `.exe` that renders the whole GUI as its own
   app, not a browser tab. Internally still localhost.
2. **First-run prompt** — API keys and project path are requested after launch
   and configurable in Settings afterwards.
3. **Self-contained `.exe`** — all dependencies (incl. native `node-pty` and the
   Next production build) are baked into the executable; no `npm install` or
   internet needed at runtime. As a safety net, when running **from source**
   (unpackaged) and `node_modules` is missing, Electron-main runs `npm install`
   before starting the server.
4. **Never delete anything from the project folder.** Secrets/settings live in
   Electron `userData`, not in the project tree.
5. **Everything for the desktop app + the `.exe` goes in a new `build/` folder**
   (Electron wrapper code, builder config, and the produced installer/exe output).

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Wrapper technology | **Electron** (node-pty native module runs in the Electron Node runtime without rebuild gymnastics) |
| Key storage | **Electron `safeStorage`** (Windows DPAPI, bound to the user account), encrypted blob in `userData` |
| First-run UX | **In-app React setup screen** (same UI/components as Settings), shown while required fields are missing |
| Dependency handling | **Self-contained `.exe`**; auto-`npm install` only as a from-source safety net |
| Output location | New **`build/`** folder holds the Electron wrapper + builder config + exe output |

## Architecture

Electron is **additive**. The existing web workflow (`npm run dev`, browser at
`http://127.0.0.1:3100`) keeps working unchanged. The Next server runs **in the
same Node process as Electron-main** (not a child process) so it can reach
`safeStorage` directly and so `node-pty` loads in the Electron Node runtime.

```
build/
  electron/
    main.ts        Electron main: ensure deps (from source only), load secrets,
                   start the Next server in-process, create the BrowserWindow,
                   native folder-picker IPC, error dialogs.
    preload.ts     Minimal contextIsolated IPC bridge: folder-picker + app info.
    secrets.ts     Encrypted key store via safeStorage (encrypt/decrypt/read/write).
    tsconfig.json  Compiles electron/*.ts (CommonJS, Node target).
  electron-builder.yml   Packaging config (NSIS installer + portable exe target).
  dist/            electron-builder output: the produced .exe / installer.

server.ts          Refactored: exports `startServer()` used by BOTH the CLI start
                   and Electron-main. Thin CLI entry remains for `npm run dev`.

lib/
  secrets.ts       Server-side secret access. In Electron: reads decrypted keys
                   from the safeStorage store. Outside Electron (tests/CLI dev):
                   gracefully falls back to env, never crashes.
  config.ts        getConfig() precedence updated to: safeStorage secrets →
                   env / .env.local → defaults.
```

### Startup sequence (packaged app)

1. Electron-main starts.
2. (From-source only) if `node_modules` missing → run `npm install`, wait.
3. Load + decrypt secrets and read `settings.json` (projects path, model, voice).
4. Inject resolved values so the server/config layer can read them.
5. Start the Next **production** server on `127.0.0.1:<port>` in-process.
6. Create `BrowserWindow` pointing at `http://127.0.0.1:<port>`.
7. React app checks readiness: if projects path **or** OpenAI key missing →
   render the **Setup screen**; otherwise the normal app.

## Components

### 1. `build/electron/secrets.ts` + `lib/secrets.ts` (key storage & config)

- Keys handled: `OPENAI_API_KEY`, `CARTESIA_API_KEY`, `PICOVOICE_ACCESS_KEY`.
- `safeStorage.encryptString()` → blob stored at
  `app.getPath('userData')/secrets.enc`.
- Decrypted in-memory shape (synthetic):
  `{ "openaiApiKey": "sk-REDACTED", "cartesiaApiKey": "REDACTED", "picovoiceAccessKey": "REDACTED" }`.
  No date fields.
- `getConfig()` precedence becomes **safeStorage secrets → env/.env.local →
  default**. Dev workflow (env) stays intact; outside Electron the secrets layer
  returns nothing and everything falls back to env.
- Projects path, model, voice stay in `settings.json` (not secret). Existing
  shape (synthetic): `{ "projectsDir": "C:\\Users\\you\\projects", "githubDir":
  "...", "openaiModel": "gpt-5.4-mini", "cartesiaVoice": "<voice-id>" }`.
- Config must read secrets **live** (per request), because keys can change at
  runtime via Settings — not just at process start.

### 2. Setup screen (new React component)

- Appears when required fields are missing (projects path **or** OpenAI key).
- Fields: projects path (with **native folder-picker** via IPC), OpenAI key
  (required), Cartesia key (optional), Picovoice key (optional).
- Save → `POST /api/secrets` (keys) + `POST /api/settings` (path) → app reloads
  into the normal state.

### 3. Settings page (extended)

- One **masked input per key** (allows set / overwrite / clear).
- GET **never** returns plaintext key values — only `set/missing` status (as
  today). New `POST /api/secrets` writes encrypted via the secrets layer.

### 4. Packaging (`build/electron-builder.yml`)

- `electron-builder` produces the `.exe`: **NSIS installer** + a **portable exe**
  target.
- Build pipeline: `next build` → compile `build/electron/*.ts` → `electron-builder`.
- `node-pty` packed correctly as a native dep (`asarUnpack` / `files` rules).
- New npm scripts: `electron:dev` (server + Electron with DevTools),
  `electron:build` (produces the exe into `build/dist`).

## Error handling

- Server start failure / port in use → native Electron error dialog instead of a
  silent crash.
- `safeStorage` unavailable (tests/CLI) → fall back to env, no crash.
- Missing/invalid secrets at runtime → API routes already handle a missing key by
  reporting status; the Setup screen guides the user to provide it.

## Testing

- All existing vitest tests stay green (the secrets layer degrades to env-only
  when Electron is absent).
- New tests:
  - `lib/secrets.ts` precedence logic (secret present vs absent → correct source).
  - `config.ts` merge precedence (safeStorage secret overrides env overrides default).
- Electron-main / packaging are verified manually (build + launch the exe), not
  unit-tested.

## Out of scope (YAGNI for now)

- Tray icon, autostart, auto-update.
- macOS/Linux packaging (Windows-only for this iteration).
- Code signing of the installer.
