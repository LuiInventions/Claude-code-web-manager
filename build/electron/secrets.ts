import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

type Secrets = {
  /** AI API keys keyed by provider id (openai, groq, …). */
  providerKeys?: Record<string, string>;
  cartesiaApiKey?: string;
  picovoiceAccessKey?: string;
  /** Legacy single-key field — migrated into providerKeys.openai. */
  openaiApiKey?: string;
};

const STORE = () => path.join(app.getPath("userData"), "secrets.enc");

let cache: Secrets = { providerKeys: {} };

/** Best-effort diagnostic line into the same startup log main.ts writes. */
function note(msg: string): void {
  try {
    fs.appendFileSync(
      path.join(app.getPath("userData"), "startup.log"),
      `[${new Date().toISOString()}] [secrets] ${msg}\n`,
    );
  } catch {
    /* ignore */
  }
  // eslint-disable-next-line no-console
  console.warn("[secrets] " + msg);
}

/** Migrate a legacy { openaiApiKey } blob into providerKeys.openai. */
function normalize(s: Secrets): Secrets {
  const providerKeys: Record<string, string> = { ...(s.providerKeys ?? {}) };
  if (typeof s.openaiApiKey === "string" && s.openaiApiKey && !providerKeys.openai) {
    providerKeys.openai = s.openaiApiKey;
  }
  return {
    providerKeys,
    cartesiaApiKey: s.cartesiaApiKey,
    picovoiceAccessKey: s.picovoiceAccessKey,
  };
}

export function loadSecretStore(): Secrets {
  if (!safeStorage.isEncryptionAvailable()) {
    note("OS encryption (DPAPI) unavailable — secrets will be stored as PLAINTEXT on disk");
  }
  try {
    const buf = fs.readFileSync(STORE());
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString("utf8");
    cache = normalize(JSON.parse(json) as Secrets);
  } catch (err) {
    // ENOENT is normal (no secrets saved yet). Anything else means the store is
    // unreadable/corrupt — surface it instead of silently dropping all keys.
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      note("failed to read/decrypt secrets.enc — keys reset this session: " + String(err));
    }
    cache = { providerKeys: {} };
  }
  return cache;
}

/** Merge a RAW patch into the store. Empty string clears a key; absent keys untouched. */
export function saveSecretStore(patch: Secrets): Secrets {
  const next: Secrets = {
    providerKeys: { ...(cache.providerKeys ?? {}) },
    cartesiaApiKey: cache.cartesiaApiKey,
    picovoiceAccessKey: cache.picovoiceAccessKey,
  };

  // legacy single field -> providerKeys.openai
  if (typeof patch.openaiApiKey === "string") {
    const v = patch.openaiApiKey.trim();
    if (v) next.providerKeys!.openai = v;
    else delete next.providerKeys!.openai;
  }
  if (patch.providerKeys && typeof patch.providerKeys === "object") {
    for (const [id, val] of Object.entries(patch.providerKeys)) {
      const v = (val ?? "").trim();
      if (v) next.providerKeys![id] = v;
      else delete next.providerKeys![id];
    }
  }
  for (const key of ["cartesiaApiKey", "picovoiceAccessKey"] as const) {
    if (key in patch) {
      const v = (patch[key] ?? "").trim();
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

/** Mirror the non-LLM keys + the OpenAI key to env (back-compat for env readers). */
function mirrorEnv() {
  const set = (env: string, val: string | undefined) => {
    if (val) process.env[env] = val;
    else delete process.env[env];
  };
  set("CARTESIA_API_KEY", cache.cartesiaApiKey);
  set("PICOVOICE_ACCESS_KEY", cache.picovoiceAccessKey);
  set("OPENAI_API_KEY", cache.providerKeys?.openai);
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
