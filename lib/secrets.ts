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
