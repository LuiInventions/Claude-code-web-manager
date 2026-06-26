import os from "node:os";
import path from "node:path";
import { readSettings } from "./settings";

/**
 * Central configuration. Precedence (highest first):
 *   1. .data/settings.json  (runtime, set via the Settings UI)
 *   2. environment / .env.local
 *   3. built-in defaults
 *
 * API keys come ONLY from the environment and are never sent to the browser.
 * Voice (STT + TTS) is powered by Cartesia.
 */

export interface AppConfig {
  host: string;
  port: number;
  projectsDir: string;
  githubDir: string;
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

  const host = process.env.HOST?.trim() || "127.0.0.1";
  const port = Number.parseInt(process.env.PORT || "3100", 10) || 3100;

  const projectsDir =
    settings.projectsDir?.trim() ||
    process.env.PROJECTS_DIR?.trim() ||
    os.homedir();

  const githubDir =
    settings.githubDir?.trim() ||
    process.env.GITHUB_DIR?.trim() ||
    path.join(path.resolve(projectsDir), "github");

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
    openaiApiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
    openaiModel,
    openaiSummaryModel: process.env.OPENAI_SUMMARY_MODEL?.trim() || "gpt-4o-mini",
    cartesiaApiKey: process.env.CARTESIA_API_KEY?.trim() || undefined,
    cartesiaVersion: process.env.CARTESIA_VERSION?.trim() || "2026-03-01",
    cartesiaTtsModel: process.env.CARTESIA_TTS_MODEL?.trim() || "sonic-turbo",
    cartesiaSttModel: process.env.CARTESIA_STT_MODEL?.trim() || "ink-whisper",
    cartesiaVoice,
    voiceLanguage: process.env.VOICE_LANGUAGE?.trim() || "de",
    picovoiceAccessKey: process.env.PICOVOICE_ACCESS_KEY?.trim() || undefined,
    claudeBin: process.env.CLAUDE_BIN?.trim() || "claude",
    dataDir: path.join(process.cwd(), ".data"),
  };
}

/** Browser-safe subset. NEVER contains API keys. */
export interface PublicConfig {
  projectsDir: string;
  openaiModel: string;
  hasApiKey: boolean;
  hasCartesiaKey: boolean;
  cartesiaVoice: string;
  host: string;
  port: number;
}

export function getPublicConfig(): PublicConfig {
  const c = getConfig();
  return {
    projectsDir: c.projectsDir,
    openaiModel: c.openaiModel,
    hasApiKey: Boolean(c.openaiApiKey),
    hasCartesiaKey: Boolean(c.cartesiaApiKey),
    cartesiaVoice: c.cartesiaVoice,
    host: c.host,
    port: c.port,
  };
}
