import OpenAI from "openai";
import { getConfig } from "./config";
import { getProvider } from "./providers";

/**
 * AI client + helpers. The active provider's key/base URL are read server-side
 * only. Every supported provider is OpenAI-compatible, so one SDK is reused.
 */

/** True when the active provider has an API key configured. */
export function hasAiKey(): boolean {
  return Boolean(getConfig().aiApiKey);
}

/** OpenAI-compatible client for the active provider. Throws if no key. */
export function getAiClient(): OpenAI {
  const { aiApiKey, aiBaseUrl, aiProvider } = getConfig();
  if (!aiApiKey) {
    const p = getProvider(aiProvider);
    throw new Error(
      `Kein API-Key für ${p.label}. Trage ihn in den Einstellungen ein (oder wähle einen anderen Provider).`,
    );
  }
  return new OpenAI({ apiKey: aiApiKey, baseURL: aiBaseUrl });
}

/** Back-compat alias. */
export const getOpenAI = getAiClient;

export function getModel(): string {
  return getConfig().aiModel;
}

const NON_TEXT =
  /(transcribe|tts|audio|image|realtime|search|embedding|moderation|whisper|dall|vision|video|rerank)/i;

/**
 * Chat/reasoning-capable model ids for the Settings dropdown, from the active
 * provider's /models endpoint. Returns [] when the provider has no listing or
 * no key (the UI falls back to free-text entry).
 */
export async function listChatModels(): Promise<string[]> {
  const { aiProvider, aiApiKey } = getConfig();
  const provider = getProvider(aiProvider);
  if (!provider.listModels || !aiApiKey) return [];

  const client = getAiClient();
  const res = await client.models.list();
  let ids = res.data.map((m) => m.id).filter((id) => !NON_TEXT.test(id));
  // OpenAI returns many non-chat ids; keep the gpt-/o families only there.
  if (provider.id === "openai") {
    ids = ids.filter((id) => /^(gpt-|o\d|chatgpt)/.test(id));
  }
  return [...new Set(ids)].sort();
}
