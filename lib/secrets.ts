import fs from "node:fs";
import path from "node:path";
import { PROVIDERS } from "./providers";

/**
 * Secret store: per-provider AI API keys plus the two non-LLM keys.
 * Keys are held encrypted by the Electron main process (safeStorage) and
 * exposed to the in-process Next server via `globalThis.__ccc_secrets`.
 * Outside Electron (tests/CLI dev) everything falls back to a gitignored dev
 * store and then `process.env`.
 */
export interface Secrets {
  /** AI API keys keyed by provider id, e.g. { openai: "sk-…", groq: "gsk-…" }. */
  providerKeys?: Record<string, string | undefined>;
  cartesiaApiKey?: string;
  picovoiceAccessKey?: string;
  /** Legacy single-key field; migrated into providerKeys.openai on read/write. */
  openaiApiKey?: string;
  /**
   * SSH password for the user's own server. Written only when the Sessions
   * checkbox is checked. Never returned by secretsStatus().
   */
  remoteSshPassword?: string;
  /** SSH passwords keyed by server id (`user@host`). Empty string clears one id. */
  remoteSshPasswords?: Record<string, string | undefined>;
}

export interface SecretsStatus {
  /** provider id -> whether a key is set */
  providers: Record<string, boolean>;
  hasCartesia: boolean;
  hasPicovoice: boolean;
  /** True when an SSH password is stored. The password itself is not included. */
  hasRemotePassword: boolean;
}

/** Installed by the Electron main process (safeStorage-backed). Absent in dev/tests. */
export interface SecretsBridge {
  get(): Secrets;
  set(patch: Secrets): void;
}

declare global {
  var __ccc_secrets: SecretsBridge | undefined;
}

/** Plaintext, gitignored, DEV-ONLY fallback so setup works under `npm run dev`. */
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

/** Migrate the legacy `openaiApiKey` field into `providerKeys.openai`. */
function normalize(s: Secrets): Secrets {
  const providerKeys: Record<string, string | undefined> = { ...(s.providerKeys ?? {}) };
  if (typeof s.openaiApiKey === "string" && s.openaiApiKey && !providerKeys.openai) {
    providerKeys.openai = s.openaiApiKey;
  }
  return {
    providerKeys,
    cartesiaApiKey: s.cartesiaApiKey,
    picovoiceAccessKey: s.picovoiceAccessKey,
    remoteSshPassword: typeof s.remoteSshPassword === "string" ? s.remoteSshPassword : undefined,
    remoteSshPasswords: { ...(s.remoteSshPasswords ?? {}) },
  };
}

export function readSecrets(): Secrets {
  const bridge = globalThis.__ccc_secrets;
  const fromBridge = bridge ? normalize(bridge.get()) : {};
  const fromDev = bridge ? {} : normalize(readDevStore());

  const providerKeys: Record<string, string> = {};
  for (const p of PROVIDERS) {
    const v =
      fromBridge.providerKeys?.[p.id]?.trim() ||
      fromDev.providerKeys?.[p.id]?.trim() ||
      process.env[p.envVar]?.trim() ||
      undefined;
    if (v) providerKeys[p.id] = v;
  }

  const cartesiaApiKey =
    fromBridge.cartesiaApiKey?.trim() ||
    fromDev.cartesiaApiKey?.trim() ||
    process.env.CARTESIA_API_KEY?.trim() ||
    undefined;
  const picovoiceAccessKey =
    fromBridge.picovoiceAccessKey?.trim() ||
    fromDev.picovoiceAccessKey?.trim() ||
    process.env.PICOVOICE_ACCESS_KEY?.trim() ||
    undefined;
  const remoteSshPassword =
    fromBridge.remoteSshPassword?.trim() || fromDev.remoteSshPassword?.trim() || undefined;
  const remoteSshPasswords: Record<string, string> = {};
  const passwordSources = [fromBridge.remoteSshPasswords, fromDev.remoteSshPasswords];
  for (const source of passwordSources) {
    for (const [id, val] of Object.entries(source ?? {})) {
      const v = typeof val === "string" ? val.trim() : "";
      if (v && !remoteSshPasswords[id]) remoteSshPasswords[id] = v;
    }
  }

  return {
    providerKeys,
    cartesiaApiKey,
    picovoiceAccessKey,
    openaiApiKey: providerKeys.openai,
    remoteSshPassword,
    remoteSshPasswords,
  };
}

/** Apply a write patch in place. Empty string clears a key; absent keys untouched. */
function applyPatch(target: Secrets, patch: Secrets): void {
  const norm = normalize(patch);
  target.providerKeys = target.providerKeys ?? {};
  for (const [id, val] of Object.entries(norm.providerKeys ?? {})) {
    const v = (val ?? "").trim();
    if (v) target.providerKeys[id] = v;
    else delete target.providerKeys[id];
  }
  for (const key of ["cartesiaApiKey", "picovoiceAccessKey", "remoteSshPassword"] as const) {
    if (key in patch) {
      const v = (patch[key] ?? "").trim();
      if (v) target[key] = v;
      else delete target[key];
    }
  }
  if (patch.remoteSshPasswords && typeof patch.remoteSshPasswords === "object") {
    target.remoteSshPasswords = target.remoteSshPasswords ?? {};
    for (const [id, val] of Object.entries(patch.remoteSshPasswords)) {
      const v = (val ?? "").trim();
      if (v) target.remoteSshPasswords[id] = v;
      else delete target.remoteSshPasswords[id];
    }
  }
}

export function writeSecrets(patch: Secrets): SecretsStatus {
  const bridge = globalThis.__ccc_secrets;
  if (bridge) {
    // Pass the RAW patch: the Electron store merges with the same "key in patch"
    // semantics so untouched keys (e.g. cartesia) are never cleared.
    bridge.set(patch);
  } else {
    const next = normalize(readDevStore());
    applyPatch(next, patch);
    writeDevStore(next);
  }
  return secretsStatus();
}

export function secretsStatus(): SecretsStatus {
  const s = readSecrets();
  const providers: Record<string, boolean> = {};
  for (const p of PROVIDERS) providers[p.id] = Boolean(s.providerKeys?.[p.id]);
  return {
    providers,
    hasCartesia: Boolean(s.cartesiaApiKey),
    hasPicovoice: Boolean(s.picovoiceAccessKey),
    hasRemotePassword:
      Boolean(s.remoteSshPassword) ||
      Object.values(s.remoteSshPasswords ?? {}).some((v) => Boolean(v)),
  };
}
