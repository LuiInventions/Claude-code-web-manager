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
}

export interface SecretsStatus {
  /** provider id -> whether a key is set */
  providers: Record<string, boolean>;
  hasCartesia: boolean;
  hasPicovoice: boolean;
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

  return { providerKeys, cartesiaApiKey, picovoiceAccessKey, openaiApiKey: providerKeys.openai };
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
  for (const key of ["cartesiaApiKey", "picovoiceAccessKey"] as const) {
    if (key in patch) {
      const v = (patch[key] ?? "").trim();
      if (v) target[key] = v;
      else delete target[key];
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
  };
}
