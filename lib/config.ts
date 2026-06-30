import path from "node:path";
import { existsSync } from "node:fs";
import { readSettings } from "./settings";
import { readSecrets, secretsStatus } from "./secrets";
import { PROVIDERS, DEFAULT_PROVIDER_ID, getProvider } from "./providers";
import { appVersion } from "./version";

/**
 * Central configuration. Precedence (highest first):
 *   1. .data/settings.json  (runtime, set via the Settings UI)
 *   2. environment / .env.local
 *   3. built-in defaults
 *
 * API keys come ONLY from the environment and are never sent to the browser.
 * Voice (STT + TTS) is powered by Cartesia.
 *
 * Paths default to folders INSIDE the app directory (not the user's home), so a
 * fresh checkout is self-contained: Dashboard projects live under `./projects`
 * and GitHub clones under `./projects/github`. Override either via the Settings
 * UI or the PROJECTS_DIR / GITHUB_DIR environment variables.
 */

export interface AppConfig {
  host: string;
  port: number;
  projectsDir: string;
  githubDir: string;
  /** Active AI provider id (e.g. "openai", "groq"). */
  aiProvider: string;
  /** OpenAI-compatible base URL for the active provider. */
  aiBaseUrl: string;
  /** API key for the active provider (undefined → AI features disabled). */
  aiApiKey: string | undefined;
  /** Active model id for the selected provider. */
  aiModel: string;
  /** Back-compat alias of the active provider's key when provider is OpenAI. */
  openaiApiKey: string | undefined;
  openaiModel: string;
  openaiSummaryModel: string;
  cartesiaApiKey: string | undefined;
  cartesiaVersion: string;
  cartesiaTtsModel: string;
  cartesiaSttModel: string;
  cartesiaVoice: string;
  voiceLanguage: string;
  /** Picovoice AccessKey for the local Porcupine wake-word engine (free tier). */
  picovoiceAccessKey: string | undefined;
  claudeBin: string;
  dataDir: string;
}

/** Verified available on this account (gpt-5.4 family). */
export const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
/** Cartesia "Sebastian – Orator" — German, masculine, eloquent. */
export const DEFAULT_CARTESIA_VOICE = "b7187e84-fe22-4344-ba4a-bc013fcb533e";

export function getConfig(): AppConfig {
  const settings = readSettings();
  const secrets = readSecrets();

  const host = process.env.HOST?.trim() || "127.0.0.1";
  const port = Number.parseInt(process.env.PORT || "3100", 10) || 3100;

  const projectsDir =
    settings.projectsDir?.trim() ||
    process.env.PROJECTS_DIR?.trim() ||
    path.join(process.cwd(), "projects");

  const githubDir =
    settings.githubDir?.trim() ||
    process.env.GITHUB_DIR?.trim() ||
    path.join(path.resolve(projectsDir), "github");

  const aiProvider = settings.aiProvider?.trim() || DEFAULT_PROVIDER_ID;
  const provider = getProvider(aiProvider);
  const aiApiKey = secrets.providerKeys?.[provider.id];
  const aiModel =
    settings.aiModel?.trim() ||
    (provider.id === "openai"
      ? settings.openaiModel?.trim() || process.env.OPENAI_MODEL?.trim()
      : undefined) ||
    provider.defaultModel;

  const openaiModel =
    settings.openaiModel?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    DEFAULT_OPENAI_MODEL;

  const cartesiaVoice =
    settings.cartesiaVoice?.trim() ||
    process.env.CARTESIA_VOICE?.trim() ||
    DEFAULT_CARTESIA_VOICE;

  return {
    host,
    port,
    projectsDir: path.resolve(projectsDir),
    githubDir: path.resolve(githubDir),
    aiProvider: provider.id,
    aiBaseUrl: provider.baseUrl,
    aiApiKey,
    aiModel,
    openaiApiKey: secrets.providerKeys?.openai,
    openaiModel,
    openaiSummaryModel: process.env.OPENAI_SUMMARY_MODEL?.trim() || "gpt-4o-mini",
    cartesiaApiKey: secrets.cartesiaApiKey,
    cartesiaVersion: process.env.CARTESIA_VERSION?.trim() || "2026-03-01",
    cartesiaTtsModel: process.env.CARTESIA_TTS_MODEL?.trim() || "sonic-turbo",
    cartesiaSttModel: process.env.CARTESIA_STT_MODEL?.trim() || "ink-whisper",
    cartesiaVoice,
    voiceLanguage: process.env.VOICE_LANGUAGE?.trim() || "de",
    picovoiceAccessKey: secrets.picovoiceAccessKey,
    claudeBin: process.env.CLAUDE_BIN?.trim() || "claude",
    dataDir: path.join(process.cwd(), ".data"),
  };
}

/** Browser-safe subset. NEVER contains API keys. */
export interface PublicConfig {
  projectsDir: string;
  aiProvider: string;
  aiModel: string;
  /** Whether the ACTIVE provider has a key (drives optional AI features). */
  hasAiKey: boolean;
  /** All providers for the dropdown, each with its curated current models. */
  providers: {
    id: string;
    label: string;
    keysUrl: string;
    listModels: boolean;
    defaultModel: string;
    models: string[];
  }[];
  /** Which provider ids currently have a key set. */
  providerStatus: Record<string, boolean>;
  hasCartesiaKey: boolean;
  hasPicovoiceKey: boolean;
  /**
   * Ready = a valid projects folder exists AND setup was completed on THIS app
   * version. A version bump (e.g. 1.1 → 1.2) flips this false so the
   * welcome/provider screen runs again; the GitHub token is left untouched.
   */
  ready: boolean;
  /** Running app version (drives the setup-after-update gate). */
  appVersion: string;
  cartesiaVoice: string;
  host: string;
  port: number;
}

export function getPublicConfig(): PublicConfig {
  const c = getConfig();
  const status = secretsStatus();
  const settings = readSettings();
  const version = appVersion();
  return {
    projectsDir: c.projectsDir,
    aiProvider: c.aiProvider,
    aiModel: c.aiModel,
    hasAiKey: Boolean(c.aiApiKey),
    providers: PROVIDERS.map((p) => ({
      id: p.id,
      label: p.label,
      keysUrl: p.keysUrl,
      listModels: p.listModels,
      defaultModel: p.defaultModel,
      models: p.models,
    })),
    providerStatus: status.providers,
    hasCartesiaKey: status.hasCartesia,
    hasPicovoiceKey: status.hasPicovoice,
    // Setup is (re)required when no folder exists OR the stamped setupVersion
    // doesn't match this build — the version gate forces the welcome screen
    // after an update while leaving the GitHub token + other userData in place.
    ready: existsSync(c.projectsDir) && settings.setupVersion === version,
    appVersion: version,
    cartesiaVoice: c.cartesiaVoice,
    host: c.host,
    port: c.port,
  };
}
