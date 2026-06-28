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
