# Electron Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the existing Next.js + custom Node control center as a standalone Windows `.exe` (Electron) with a first-run setup screen, encrypted key storage, and editable keys in Settings — still running on `127.0.0.1` internally.

**Architecture:** Electron is additive. The custom Node server is refactored into a callable `startServer()` used by both the CLI dev workflow and the Electron main process. Keys live in an encrypted `safeStorage` store owned by Electron-main and exposed to the in-process Next server via a `globalThis` bridge; outside Electron everything falls back to env / a gitignored dev store. All Electron wrapper code and the produced `.exe` live under a new `build/` folder.

**Tech Stack:** Electron, electron-builder, Next.js 16, React 19, node-pty, TypeScript, vitest, esbuild.

## Global Constraints

- Platform: **Windows only** this iteration. Node ≥ 20.9.
- Server binds **`127.0.0.1` loopback only** — never change `HOST` to `0.0.0.0`.
- **Never delete anything in the user's project folder.** Secrets/settings live in Electron `userData` (packaged) or `.data/` (dev), never in the project tree.
- API keys: GET endpoints **never** return plaintext key values — only boolean status.
- Existing `npm run dev` browser workflow must keep working unchanged.
- All existing vitest tests must stay green.
- Electron wrapper + builder config + exe output go under **`build/`**.
- Self-contained `.exe` (deps baked in). Auto-`npm install` only as a from-source safety net.

---

### Task 1: Refactor `server.ts` into a reusable `startServer()`

**Files:**
- Create: `lib/server/start.ts`
- Modify: `server.ts` (becomes a thin CLI entry)

**Interfaces:**
- Produces: `startServer(opts?: { quiet?: boolean }): Promise<{ host: string; port: number; close: () => Promise<void> }>` in `lib/server/start.ts`.

- [ ] **Step 1: Create `lib/server/start.ts`**

```ts
import { createServer, type Server } from "node:http";
import next from "next";
import { getConfig } from "../config";
import { handleWsUpgrade } from "./ws-hub";
import { startUsagePoller } from "./usage-poller";

export interface RunningServer {
  host: string;
  port: number;
  close: () => Promise<void>;
}

/**
 * Boots Next + the ws hub on the loopback interface. Used by the CLI entry
 * (server.ts) and by the Electron main process.
 */
export async function startServer(opts: { quiet?: boolean } = {}): Promise<RunningServer> {
  const { host, port } = getConfig();
  const dev = process.env.NODE_ENV !== "production";

  const app = next({ dev, hostname: host, port });
  await app.prepare();

  const handle = app.getRequestHandler();
  const upgrade = app.getUpgradeHandler();

  const server: Server = createServer((req, res) => {
    handle(req, res);
  });

  server.on("upgrade", (req, socket, head) => {
    const url = req.url || "";
    if (url.startsWith("/ws/")) {
      handleWsUpgrade(req, socket, head);
    } else {
      upgrade(req, socket, head);
    }
  });

  server.on("error", (err) => {
    console.error("[control-center] server error:", err);
  });

  await new Promise<void>((resolve) => {
    server.listen(port, host, () => {
      if (!opts.quiet) {
        console.log(
          `\n  ▸ Claude Code Control Center  →  http://${host}:${port}   (loopback only)\n`,
        );
      }
      startUsagePoller();
      resolve();
    });
  });

  return {
    host,
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
```

- [ ] **Step 2: Rewrite `server.ts` as a thin CLI entry**

```ts
import "./lib/load-env";
import { startServer } from "./lib/server/start";

startServer().catch((err) => {
  console.error("[control-center] failed to start:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Verify dev server still boots**

Run: `npm run dev` (wait for the loopback line, then Ctrl+C)
Expected: `▸ Claude Code Control Center → http://127.0.0.1:3100 (loopback only)`

- [ ] **Step 4: Verify tests still pass**

Run: `npm test`
Expected: all existing suites PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/server/start.ts server.ts
git commit -m "refactor: extract startServer() for reuse by Electron main"
```

---

### Task 2: Server-side secrets layer (`lib/secrets.ts`)

**Files:**
- Create: `lib/secrets.ts`
- Test: `lib/__tests__/secrets.test.ts`

**Interfaces:**
- Produces:
  - `interface Secrets { openaiApiKey?: string; cartesiaApiKey?: string; picovoiceAccessKey?: string }`
  - `interface SecretsStatus { hasOpenai: boolean; hasCartesia: boolean; hasPicovoice: boolean }`
  - `interface SecretsBridge { get(): Secrets; set(patch: Secrets): void }` installed by Electron main at `globalThis.__ccc_secrets`.
  - `readSecrets(): Secrets`
  - `writeSecrets(patch: Secrets): SecretsStatus`
  - `secretsStatus(): SecretsStatus`
- Precedence in `readSecrets()`: Electron bridge → gitignored dev store (`.data/secrets.json`, only when no bridge) → `process.env`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/secrets.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DEV_FILE = path.join(process.cwd(), ".data", "secrets.json");

async function fresh() {
  // re-import with a clean module registry so env is re-read
  return (await import("../secrets?" + Math.random())) as typeof import("../secrets");
}

describe("secrets layer", () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__ccc_secrets;
    delete process.env.OPENAI_API_KEY;
    delete process.env.CARTESIA_API_KEY;
    delete process.env.PICOVOICE_ACCESS_KEY;
    try { fs.rmSync(DEV_FILE, { force: true }); } catch {}
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__ccc_secrets;
    try { fs.rmSync(DEV_FILE, { force: true }); } catch {}
  });

  it("falls back to env when no bridge and no dev store", async () => {
    process.env.OPENAI_API_KEY = "sk-env";
    const { readSecrets } = await fresh();
    expect(readSecrets().openaiApiKey).toBe("sk-env");
  });

  it("bridge overrides env", async () => {
    process.env.OPENAI_API_KEY = "sk-env";
    (globalThis as Record<string, unknown>).__ccc_secrets = {
      get: () => ({ openaiApiKey: "sk-bridge" }),
      set: () => {},
    };
    const { readSecrets } = await fresh();
    expect(readSecrets().openaiApiKey).toBe("sk-bridge");
  });

  it("writeSecrets persists to dev store when no bridge", async () => {
    const { writeSecrets, readSecrets } = await fresh();
    const status = writeSecrets({ openaiApiKey: "sk-dev" });
    expect(status.hasOpenai).toBe(true);
    expect(readSecrets().openaiApiKey).toBe("sk-dev");
  });

  it("empty string clears a secret", async () => {
    const { writeSecrets } = await fresh();
    writeSecrets({ openaiApiKey: "sk-dev" });
    const status = writeSecrets({ openaiApiKey: "" });
    expect(status.hasOpenai).toBe(false);
  });

  it("writeSecrets routes through the bridge when present", async () => {
    let captured: unknown = null;
    (globalThis as Record<string, unknown>).__ccc_secrets = {
      get: () => (captured as { openaiApiKey?: string }) ?? {},
      set: (p: unknown) => { captured = p; },
    };
    const { writeSecrets } = await fresh();
    writeSecrets({ openaiApiKey: "sk-bridge" });
    expect((captured as { openaiApiKey?: string }).openaiApiKey).toBe("sk-bridge");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/secrets.test.ts`
Expected: FAIL — cannot find module `../secrets`.

- [ ] **Step 3: Implement `lib/secrets.ts`**

```ts
import fs from "node:fs";
import path from "node:path";

export interface Secrets {
  openaiApiKey?: string;
  cartesiaApiKey?: string;
  picovoiceAccessKey?: string;
}

export interface SecretsStatus {
  hasOpenai: boolean;
  hasCartesia: boolean;
  hasPicovoice: boolean;
}

/** Installed by the Electron main process (safeStorage-backed). Absent in dev/tests. */
export interface SecretsBridge {
  get(): Secrets;
  set(patch: Secrets): void;
}

declare global {
  // eslint-disable-next-line no-var
  var __ccc_secrets: SecretsBridge | undefined;
}

const ENV_MAP = {
  openaiApiKey: "OPENAI_API_KEY",
  cartesiaApiKey: "CARTESIA_API_KEY",
  picovoiceAccessKey: "PICOVOICE_ACCESS_KEY",
} as const;

type Key = keyof typeof ENV_MAP;
const KEYS = Object.keys(ENV_MAP) as Key[];

/** Plaintext, gitignored, DEV-ONLY fallback so the setup screen works under `npm run dev`. */
const DEV_FILE = path.join(process.cwd(), ".data", "secrets.json");

function readDevStore(): Secrets {
  try {
    const raw = fs.readFileSync(DEV_FILE, "utf8");
    const p = JSON.parse(raw);
    return p && typeof p === "object" ? (p as Secrets) : {};
  } catch {
    return {};
  }
}

function writeDevStore(s: Secrets): void {
  fs.mkdirSync(path.dirname(DEV_FILE), { recursive: true });
  const tmp = DEV_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), "utf8");
  fs.renameSync(tmp, DEV_FILE);
}

export function readSecrets(): Secrets {
  const bridge = globalThis.__ccc_secrets;
  const fromBridge = bridge ? bridge.get() : {};
  const fromDev = bridge ? {} : readDevStore();
  const out: Secrets = {};
  for (const key of KEYS) {
    out[key] =
      fromBridge[key]?.trim() ||
      fromDev[key]?.trim() ||
      process.env[ENV_MAP[key]]?.trim() ||
      undefined;
  }
  return out;
}

export function writeSecrets(patch: Secrets): SecretsStatus {
  const clean: Secrets = {};
  for (const key of KEYS) {
    if (key in patch) {
      const v = patch[key]?.trim();
      clean[key] = v ? v : undefined; // undefined => clear
    }
  }
  const bridge = globalThis.__ccc_secrets;
  if (bridge) {
    bridge.set(clean);
  } else {
    const next = { ...readDevStore() };
    for (const key of KEYS) {
      if (key in clean) {
        if (clean[key]) next[key] = clean[key];
        else delete next[key];
      }
    }
    writeDevStore(next);
  }
  return secretsStatus();
}

export function secretsStatus(): SecretsStatus {
  const s = readSecrets();
  return {
    hasOpenai: Boolean(s.openaiApiKey),
    hasCartesia: Boolean(s.cartesiaApiKey),
    hasPicovoice: Boolean(s.picovoiceAccessKey),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/__tests__/secrets.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/secrets.ts lib/__tests__/secrets.test.ts
git commit -m "feat: add secrets layer (bridge -> dev store -> env precedence)"
```

---

### Task 3: Wire `config.ts` to the secrets layer

**Files:**
- Modify: `lib/config.ts`
- Test: `lib/__tests__/config.test.ts` (create)

**Interfaces:**
- Consumes: `readSecrets()` from Task 2.
- Produces: `AppConfig.picovoiceAccessKey` still present; `PublicConfig` gains `hasPicovoiceKey: boolean` and `ready: boolean`.
- `ready` = `hasApiKey && projectsDir exists on disk`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/config.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";

async function fresh() {
  return (await import("../config?" + Math.random())) as typeof import("../config");
}

describe("config precedence", () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__ccc_secrets;
    delete process.env.OPENAI_API_KEY;
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__ccc_secrets;
    delete process.env.OPENAI_API_KEY;
  });

  it("reads openai key from env when no bridge", async () => {
    process.env.OPENAI_API_KEY = "sk-env";
    const { getConfig } = await fresh();
    expect(getConfig().openaiApiKey).toBe("sk-env");
  });

  it("bridge secret overrides env in config", async () => {
    process.env.OPENAI_API_KEY = "sk-env";
    (globalThis as Record<string, unknown>).__ccc_secrets = {
      get: () => ({ openaiApiKey: "sk-bridge" }),
      set: () => {},
    };
    const { getConfig } = await fresh();
    expect(getConfig().openaiApiKey).toBe("sk-bridge");
  });

  it("public config exposes status flags, never the key", async () => {
    process.env.OPENAI_API_KEY = "sk-env";
    const { getPublicConfig } = await fresh();
    const pub = getPublicConfig();
    expect(pub.hasApiKey).toBe(true);
    expect(JSON.stringify(pub)).not.toContain("sk-env");
    expect(typeof pub.hasPicovoiceKey).toBe("boolean");
    expect(typeof pub.ready).toBe("boolean");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/config.test.ts`
Expected: FAIL — `hasPicovoiceKey` / `ready` undefined.

- [ ] **Step 3: Edit `lib/config.ts`**

Add imports at top (after the existing `readSettings` import):

```ts
import { existsSync } from "node:fs";
import { readSecrets } from "./secrets";
```

Inside `getConfig()`, add near the top of the function:

```ts
  const secrets = readSecrets();
```

Change these three lines in the returned object:

```ts
    openaiApiKey: secrets.openaiApiKey,
    cartesiaApiKey: secrets.cartesiaApiKey,
    picovoiceAccessKey: secrets.picovoiceAccessKey,
```

Extend `PublicConfig`:

```ts
export interface PublicConfig {
  projectsDir: string;
  openaiModel: string;
  hasApiKey: boolean;
  hasCartesiaKey: boolean;
  hasPicovoiceKey: boolean;
  ready: boolean;
  cartesiaVoice: string;
  host: string;
  port: number;
}
```

Update `getPublicConfig()`:

```ts
export function getPublicConfig(): PublicConfig {
  const c = getConfig();
  const hasApiKey = Boolean(c.openaiApiKey);
  return {
    projectsDir: c.projectsDir,
    openaiModel: c.openaiModel,
    hasApiKey,
    hasCartesiaKey: Boolean(c.cartesiaApiKey),
    hasPicovoiceKey: Boolean(c.picovoiceAccessKey),
    ready: hasApiKey && existsSync(c.projectsDir),
    cartesiaVoice: c.cartesiaVoice,
    host: c.host,
    port: c.port,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/__tests__/config.test.ts && npm test`
Expected: new suite PASS; full suite still PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/config.ts lib/__tests__/config.test.ts
git commit -m "feat: source API keys from secrets layer; expose readiness flags"
```

---

### Task 4: `/api/secrets` route

**Files:**
- Create: `app/api/secrets/route.ts`

**Interfaces:**
- Consumes: `secretsStatus()`, `writeSecrets()`, type `Secrets` from Task 2.
- Produces: `GET /api/secrets` → `SecretsStatus`; `POST /api/secrets` with body `{ openaiApiKey?, cartesiaApiKey?, picovoiceAccessKey? }` → `SecretsStatus`.

- [ ] **Step 1: Implement the route**

```ts
import type { NextRequest } from "next/server";
import { secretsStatus, writeSecrets, type Secrets } from "@/lib/secrets";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(secretsStatus());
}

export async function POST(req: NextRequest) {
  let body: Secrets;
  try {
    body = (await req.json()) as Secrets;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const patch: Secrets = {};
  if (typeof body.openaiApiKey === "string") patch.openaiApiKey = body.openaiApiKey;
  if (typeof body.cartesiaApiKey === "string") patch.cartesiaApiKey = body.cartesiaApiKey;
  if (typeof body.picovoiceAccessKey === "string") patch.picovoiceAccessKey = body.picovoiceAccessKey;
  const status = writeSecrets(patch);
  return Response.json(status);
}
```

- [ ] **Step 2: Manual smoke test**

Run `npm run dev`, then in a second terminal:

```bash
curl -s -X POST http://127.0.0.1:3100/api/secrets -H "content-type: application/json" -d "{\"openaiApiKey\":\"sk-test\"}"
curl -s http://127.0.0.1:3100/api/secrets
```

Expected: both return `{"hasOpenai":true,"hasCartesia":false,"hasPicovoice":false}`. Then clear:

```bash
curl -s -X POST http://127.0.0.1:3100/api/secrets -H "content-type: application/json" -d "{\"openaiApiKey\":\"\"}"
```

Expected: `hasOpenai:false`.

- [ ] **Step 3: Commit**

```bash
git add app/api/secrets/route.ts
git commit -m "feat: add /api/secrets (status + write via secrets layer)"
```

---

### Task 5: Setup screen + readiness gate

**Files:**
- Create: `app/components/SetupScreen.tsx`
- Create: `app/components/AppGate.tsx`
- Create: `app/desktop.d.ts` (window.cccDesktop typing)
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `GET /api/settings` (now includes `ready`, `hasApiKey`, `hasPicovoiceKey`), `POST /api/secrets`, `POST /api/settings`.
- Optional desktop bridge: `window.cccDesktop?.pickFolder(): Promise<string | null>` and `window.cccDesktop?.isDesktop`.
- Produces: `AppGate` renders `<SetupScreen onReady={...}/>` while `ready === false`, else `<Shell/>`.

- [ ] **Step 1: Create `app/desktop.d.ts`**

```ts
export {};

declare global {
  interface Window {
    cccDesktop?: {
      isDesktop: true;
      pickFolder: () => Promise<string | null>;
    };
  }
}
```

- [ ] **Step 2: Create `app/components/SetupScreen.tsx`**

```tsx
"use client";

import { useState } from "react";
import { FolderOpen, KeyRound, Rocket } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button, Card, Input } from "./ui";

export default function SetupScreen({ onReady }: { onReady: () => void }) {
  const [projectsDir, setProjectsDir] = useState("");
  const [openai, setOpenai] = useState("");
  const [cartesia, setCartesia] = useState("");
  const [picovoice, setPicovoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const desktop = typeof window !== "undefined" ? window.cccDesktop : undefined;

  const pick = async () => {
    const dir = await desktop?.pickFolder();
    if (dir) setProjectsDir(dir);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!projectsDir.trim()) throw new Error("Bitte einen Projektordner wählen.");
      if (!openai.trim()) throw new Error("OpenAI API-Key ist erforderlich.");

      const sec = await fetch("/api/secrets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          openaiApiKey: openai.trim(),
          cartesiaApiKey: cartesia.trim(),
          picovoiceAccessKey: picovoice.trim(),
        }),
      });
      if (!sec.ok) throw new Error("Keys konnten nicht gespeichert werden.");

      const set = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectsDir: projectsDir.trim() }),
      });
      const d = await set.json();
      if (d.error) throw new Error(d.error);

      onReady();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center overflow-auto bg-surface p-6">
      <div className="w-full max-w-lg space-y-4">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold text-ink">Willkommen</h1>
          <p className="text-sm text-faint">
            Einmalige Einrichtung — alles bleibt lokal auf diesem Rechner.
          </p>
        </div>

        <Card className="space-y-3 p-5">
          <Field icon={FolderOpen} title="Projektordner" hint="Direkte Unterordner werden als Projekte gelistet." />
          <div className="flex gap-2">
            <Input
              value={projectsDir}
              onChange={(e) => setProjectsDir(e.target.value)}
              placeholder="C:\\Users\\you\\projects"
              className="font-mono text-[13px]"
            />
            {desktop && (
              <Button variant="ghost" icon={FolderOpen} onClick={pick}>
                Wählen
              </Button>
            )}
          </div>
        </Card>

        <Card className="space-y-3 p-5">
          <Field icon={KeyRound} title="OpenAI API-Key" hint="Erforderlich. Wird verschlüsselt gespeichert." />
          <Input type="password" value={openai} onChange={(e) => setOpenai(e.target.value)} placeholder="sk-..." className="font-mono text-[13px]" />
          <Field icon={KeyRound} title="Cartesia API-Key (optional)" hint="Für Sprachausgabe (TTS)." />
          <Input type="password" value={cartesia} onChange={(e) => setCartesia(e.target.value)} placeholder="leer lassen, wenn nicht genutzt" className="font-mono text-[13px]" />
          <Field icon={KeyRound} title="Picovoice Access-Key (optional)" hint="Für lokales Wake-Word." />
          <Input type="password" value={picovoice} onChange={(e) => setPicovoice(e.target.value)} placeholder="leer lassen, wenn nicht genutzt" className="font-mono text-[13px]" />
        </Card>

        {error && <p className="text-sm text-danger">{error}</p>}

        <Button variant="primary" icon={Rocket} onClick={submit} loading={busy} className="w-full">
          Loslegen
        </Button>
      </div>
    </div>
  );
}

function Field({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-faint" />
      <div>
        <div className="text-sm font-medium text-ink">{title}</div>
        <div className="text-xs text-faint">{hint}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `app/components/AppGate.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "./Shell";
import SetupScreen from "./SetupScreen";
import { Spinner } from "./ui";

export default function AppGate() {
  const [ready, setReady] = useState<boolean | null>(null);

  const check = useCallback(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((c: { ready?: boolean }) => setReady(Boolean(c.ready)))
      .catch(() => setReady(false));
  }, []);

  useEffect(() => check(), [check]);

  if (ready === null) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  return ready ? <Shell /> : <SetupScreen onReady={check} />;
}
```

- [ ] **Step 4: Update `app/page.tsx`**

```tsx
import AppGate from "./components/AppGate";

export default function Home() {
  return <AppGate />;
}
```

- [ ] **Step 5: Manual verify**

Run `npm run dev`. With no valid `projectsDir`/OpenAI key, the Setup screen appears. Fill OpenAI key + a real folder path → "Loslegen" → the normal app loads. Confirm `Button`/`Input`/`Spinner`/`Card` prop names match `app/components/ui.tsx` (adjust if exports differ — e.g. `variant`/`icon`/`loading`).

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add app/components/SetupScreen.tsx app/components/AppGate.tsx app/desktop.d.ts app/page.tsx
git commit -m "feat: first-run setup screen with readiness gate"
```

---

### Task 6: Editable keys in Settings

**Files:**
- Modify: `app/components/sections/SettingsSection.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/secrets` (Task 4), extended `PublicConfig` (Task 3).
- Behavior: each key shows `set/missing` plus a masked input; saving a non-empty value writes it, an explicit "Clear" sends `""`. GET never returns key values.

- [ ] **Step 1: Extend `PublicConfig` interface in the file**

Add `hasPicovoiceKey: boolean;` and `ready: boolean;` to the local `interface PublicConfig` near the top of `SettingsSection.tsx`.

- [ ] **Step 2: Add key state + save helper**

Add near the other `useState` hooks:

```tsx
  const [openaiKey, setOpenaiKey] = useState("");
  const [cartesiaKey, setCartesiaKey] = useState("");
  const [picovoiceKey, setPicovoiceKey] = useState("");
```

Add below the `save` function:

```tsx
  const saveKey = async (
    field: "openaiApiKey" | "cartesiaApiKey" | "picovoiceAccessKey",
    value: string,
  ) => {
    setSaving(true);
    setError(null);
    try {
      await fetch("/api/secrets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      const c = await fetch("/api/settings").then((r) => r.json());
      setCfg(c);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
```

- [ ] **Step 3: Replace static key rows with editable rows**

Inside the keys `Card`, replace the OpenAI row with:

```tsx
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label icon={KeyRound} title="OpenAI API key" hint="Reasoning + prompt improver. Encrypted at rest." />
              <Badge tone={cfg.hasApiKey ? "running" : "danger"} dot>
                {cfg.hasApiKey ? "set" : "missing"}
              </Badge>
            </div>
            <div className="flex gap-2">
              <Input type="password" value={openaiKey} onChange={(e) => setOpenaiKey(e.target.value)} placeholder="sk-… (leave blank to keep)" className="font-mono text-[13px]" />
              <Button variant="ghost" onClick={() => { saveKey("openaiApiKey", openaiKey); setOpenaiKey(""); }} disabled={!openaiKey.trim()}>Save</Button>
              <Button variant="ghost" onClick={() => saveKey("openaiApiKey", "")} disabled={!cfg.hasApiKey}>Clear</Button>
            </div>
          </div>
          <div className="h-px bg-line" />
```

Add analogous blocks for Cartesia (`cartesiaApiKey`, `cfg.hasCartesiaKey`, state `cartesiaKey`, title "Cartesia API key", hint "Speech (STT + TTS). Encrypted at rest.") and Picovoice (`picovoiceAccessKey`, `cfg.hasPicovoiceKey`, state `picovoiceKey`, title "Picovoice Access key", hint "Local wake-word. Encrypted at rest."). Keep the existing Server row last.

- [ ] **Step 4: Manual verify**

Run `npm run dev` → Settings. Enter a key → Save → badge flips to "set". Clear → "missing". Reload → status persists. `GET /api/settings` contains no `sk-` value.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add app/components/sections/SettingsSection.tsx
git commit -m "feat: edit/clear API keys from Settings (encrypted store)"
```

---

### Task 7: Electron wrapper (`build/electron/`)

**Files:**
- Create: `build/electron/secrets.ts`
- Create: `build/electron/preload.ts`
- Create: `build/electron/main.ts`
- Create: `build/electron/tsconfig.json`

**Interfaces:**
- `secrets.ts` produces: `loadSecretStore(): Secrets`, `saveSecretStore(patch): Secrets`, `installBridge(): void` (sets `globalThis.__ccc_secrets` and mirrors values into `process.env`).
- `preload.ts` exposes `window.cccDesktop = { isDesktop: true, pickFolder() }` via `contextBridge` + `ipcRenderer.invoke("ccc:pick-folder")`.
- `main.ts` orchestrates: ensure deps (from source only) → install bridge → start server → window → IPC.

- [ ] **Step 1: Create `build/electron/secrets.ts`**

```ts
import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

type Secrets = {
  openaiApiKey?: string;
  cartesiaApiKey?: string;
  picovoiceAccessKey?: string;
};

const ENV_MAP: Record<keyof Secrets, string> = {
  openaiApiKey: "OPENAI_API_KEY",
  cartesiaApiKey: "CARTESIA_API_KEY",
  picovoiceAccessKey: "PICOVOICE_ACCESS_KEY",
};

const STORE = () => path.join(app.getPath("userData"), "secrets.enc");

let cache: Secrets = {};

export function loadSecretStore(): Secrets {
  try {
    const buf = fs.readFileSync(STORE());
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString("utf8");
    cache = JSON.parse(json) as Secrets;
  } catch {
    cache = {};
  }
  return cache;
}

export function saveSecretStore(patch: Secrets): Secrets {
  const next: Secrets = { ...cache };
  for (const key of Object.keys(ENV_MAP) as (keyof Secrets)[]) {
    if (key in patch) {
      const v = patch[key]?.trim();
      if (v) next[key] = v;
      else delete next[key];
    }
  }
  cache = next;
  const json = JSON.stringify(next);
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, "utf8");
  fs.mkdirSync(path.dirname(STORE()), { recursive: true });
  fs.writeFileSync(STORE(), data);
  mirrorEnv();
  return next;
}

function mirrorEnv() {
  for (const key of Object.keys(ENV_MAP) as (keyof Secrets)[]) {
    const env = ENV_MAP[key];
    if (cache[key]) process.env[env] = cache[key] as string;
    else delete process.env[env];
  }
}

/** Install the in-process bridge the Next server reads via globalThis.__ccc_secrets. */
export function installBridge(): void {
  loadSecretStore();
  mirrorEnv();
  (globalThis as Record<string, unknown>).__ccc_secrets = {
    get: () => cache,
    set: (patch: Secrets) => saveSecretStore(patch),
  };
}
```

- [ ] **Step 2: Create `build/electron/preload.ts`**

```ts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("cccDesktop", {
  isDesktop: true,
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("ccc:pick-folder"),
});
```

- [ ] **Step 3: Create `build/electron/main.ts`**

```ts
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { installBridge } from "./secrets";

// Project root: packaged => resources, dev => two levels up from build/electron.
const ROOT = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "..", "..");

function ensureDepsFromSource() {
  if (app.isPackaged) return; // packaged app ships node_modules
  if (fs.existsSync(path.join(ROOT, "node_modules"))) return;
  const r = spawnSync("npm", ["install"], { cwd: ROOT, stdio: "inherit", shell: true });
  if (r.status !== 0) throw new Error("npm install failed");
}

async function boot() {
  ensureDepsFromSource();
  installBridge();
  process.env.NODE_ENV = "production";

  // server.cjs is produced by the build step (Task 8) from lib/server/start.ts.
  const { startServer } = require(path.join(__dirname, "dist", "server.cjs")) as {
    startServer: (o?: { quiet?: boolean }) => Promise<{ host: string; port: number }>;
  };

  let info: { host: string; port: number };
  try {
    info = await startServer({ quiet: true });
  } catch (err) {
    dialog.showErrorBox("Serverstart fehlgeschlagen", String(err));
    app.quit();
    return;
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: "#0b0b0f",
    title: "Claude Code Control Center",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  await win.loadURL(`http://${info.host}:${info.port}`);
}

ipcMain.handle("ccc:pick-folder", async () => {
  const res = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
});

app.whenReady().then(boot);
app.on("window-all-closed", () => app.quit());
```

- [ ] **Step 4: Create `build/electron/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "./out",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node", "electron"]
  },
  "include": ["main.ts", "preload.ts", "secrets.ts"]
}
```

- [ ] **Step 5: Commit**

```bash
git add build/electron/secrets.ts build/electron/preload.ts build/electron/main.ts build/electron/tsconfig.json
git commit -m "feat: electron main, preload, and safeStorage secret store"
```

---

### Task 8: Build pipeline + packaging

**Files:**
- Create: `build/electron-builder.yml`
- Create: `build/scripts/bundle-server.mjs`
- Modify: `package.json` (devDeps + scripts + `main` field)
- Modify: `.gitignore` (track `build/` source, ignore only build output)

**Interfaces:**
- Consumes: `startServer()` (Task 1), Electron wrapper (Task 7).
- Produces: `npm run electron:dev`, `npm run electron:build` → `build/dist/*.exe`.

- [ ] **Step 1: Add dev dependencies**

```bash
npm install --save-dev electron electron-builder esbuild cross-env
```

- [ ] **Step 2: Create `build/scripts/bundle-server.mjs`**

```js
// Bundles the custom server (start + lib) to a single CJS file Electron requires,
// and compiles the electron main/preload/secrets entries to JS.
// Native + framework deps stay external (resolved from node_modules, asarUnpacked).
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const electronDir = path.join(root, "build", "electron");

await build({
  entryPoints: [path.join(root, "lib", "server", "start.ts")],
  outfile: path.join(electronDir, "dist", "server.cjs"),
  platform: "node",
  format: "cjs",
  bundle: true,
  target: "node20",
  external: ["next", "node-pty", "electron", "openai", "ws"],
  banner: { js: "// generated — do not edit" },
});

await build({
  entryPoints: [
    path.join(electronDir, "main.ts"),
    path.join(electronDir, "preload.ts"),
    path.join(electronDir, "secrets.ts"),
  ],
  outdir: electronDir,
  platform: "node",
  format: "cjs",
  bundle: false,
  target: "node20",
  external: ["electron"],
});

console.log("bundled server + electron entries");
```

- [ ] **Step 3: Edit `package.json`**

Add a top-level `"main": "build/electron/main.js"`. Add to `scripts`:

```json
    "bundle:server": "node build/scripts/bundle-server.mjs",
    "electron:dev": "npm run bundle:server && cross-env NODE_ENV=production electron build/electron/main.js",
    "electron:build": "next build && npm run bundle:server && electron-builder --config build/electron-builder.yml"
```

- [ ] **Step 4: Create `build/electron-builder.yml`**

```yaml
appId: com.luis.claudecontrolcenter
productName: Claude Code Control Center
directories:
  output: build/dist
  buildResources: build/resources
files:
  - build/electron/**/*.js
  - build/electron/dist/**/*
  - .next/**/*
  - next.config.ts
  - package.json
  - node_modules/**/*
asarUnpack:
  - node_modules/node-pty/**/*
  - .next/**/*
win:
  target:
    - nsis
    - portable
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

- [ ] **Step 5: Edit `.gitignore`**

Replace the line `/build` with:

```gitignore
# electron build output (keep build/ source tracked)
/build/dist/
/build/electron/dist/
/build/electron/*.js
```

- [ ] **Step 6: Dev run of the desktop shell**

Run: `npm run electron:dev`
Expected: a native window opens showing the app (Setup screen on first run, else normal UI). The folder-picker button works. Closing the window exits the process.

- [ ] **Step 7: Produce the `.exe`**

Run: `npm run electron:build`
Expected: `build/dist/` contains an NSIS installer `*.exe` and a portable `*.exe`. Launch the portable exe → Setup → enter key + folder → app works; relaunch → straight to the app (keys persisted, encrypted).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json build/electron-builder.yml build/scripts/bundle-server.mjs .gitignore
git commit -m "build: electron packaging pipeline -> self-contained .exe under build/"
```

---

### Task 9: Docs + final verification

**Files:**
- Modify: `README.md` (add a "Desktop app" section)

- [ ] **Step 1: Add README section**

Append under Setup a "Desktop app (.exe)" section describing `npm run electron:build`, the `build/dist/` output, the first-run setup, encrypted (DPAPI/safeStorage) key storage in the user profile (never in the project folder), editable keys in Settings, and `npm run electron:dev` for development.

- [ ] **Step 2: Full verification pass**

Run:
```bash
npm test
npm run typecheck
npm run lint
```
Expected: tests PASS, no type errors, lint clean (fix any issues surfaced).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the desktop (.exe) build"
```

---

## Self-Review Notes

- **Spec coverage:** standalone windowed app (Tasks 7/8), first-run prompt (Task 5), keys in settings (Task 6), encrypted storage (Task 7 secrets.ts + Task 2 bridge), loopback only (Task 1), never touch project folder (storage in userData/.data — Tasks 2/7), self-contained exe + from-source auto-install (Task 7 ensureDeps + Task 8), everything under build/ (Tasks 7/8).
- **Precedence consistency:** `readSecrets()` order (bridge → dev store → env) is identical in `lib/secrets.ts` and asserted in Tasks 2 & 3.
- **Naming consistency:** `globalThis.__ccc_secrets`, `SecretsStatus { hasOpenai, hasCartesia, hasPicovoice }`, `PublicConfig.ready`, `window.cccDesktop.pickFolder` used identically across tasks.
- **Known integration risk:** bundling the custom Next server for the packaged app (Task 8) is the most likely place to need iteration (esbuild externals, asarUnpack of `.next`/`node-pty`). Core app logic (Tasks 1–6) is fully testable via `npm run dev` independent of packaging.
