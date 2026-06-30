import OpenAI from "openai";
import { getConfig } from "./config";
import { getProvider } from "./providers";
import { readSecrets } from "./secrets";

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
  // Cap the request so a hung provider can't block the route (improve/review
  // have a 120s maxDuration); the default SDK timeout is ~10 min.
  return new OpenAI({ apiKey: aiApiKey, baseURL: aiBaseUrl, timeout: 30_000 });
}

/** Back-compat alias. */
export const getOpenAI = getAiClient;

export function getModel(): string {
  return getConfig().aiModel;
}

export interface ProviderTestResult {
  provider: string;
  /** Human label for the UI. */
  label: string;
  ok: boolean;
  /** Model the test actually hit (default or the one passed in). */
  model?: string;
  /** Short, actionable message when ok === false. */
  error?: string;
}

/** Map an SDK/HTTP error to a short, actionable German message. */
export function friendlyAiError(err: unknown): string {
  const e = err as { status?: number; message?: string; code?: string };
  const status = e?.status;
  const msg = (e?.message || "").replace(/\s+/g, " ").trim().slice(0, 240);
  if (status === 401) return "Ungültiger oder fehlender API-Key (401).";
  if (status === 403)
    return "Zugriff verweigert (403) — der Key darf dieses Modell nicht nutzen. Wähle ein anderes Modell oder gib den Zugriff beim Provider frei.";
  if (status === 404)
    return "Nicht gefunden (404) — prüfe die Modell-ID für diesen Provider.";
  if (status === 429) return "Rate-Limit erreicht (429) — später erneut versuchen.";
  if (status && status >= 500) return `Provider-Fehler (${status}) — später erneut versuchen.`;
  return msg || "Unbekannter Fehler.";
}

/**
 * Verify a provider's stored key actually works by making one minimal chat
 * completion against the given (or default) model. Tests the provider id passed
 * in — not necessarily the active one — so the Settings UI can check every
 * configured key. Never throws: failures come back as `{ ok: false, error }`.
 *
 * No token cap is set on purpose: some providers' newer models reject
 * `max_tokens` (they want `max_completion_tokens`), and "ping" already yields a
 * tiny reply. This exercises the real auth + model-access path, so it catches a
 * gated model returning 403 (the Groq default-model case), not just the key.
 */
export async function testProvider(
  providerId: string,
  model?: string,
): Promise<ProviderTestResult> {
  const provider = getProvider(providerId);
  const key = readSecrets().providerKeys?.[provider.id];
  if (!key)
    return { provider: provider.id, label: provider.label, ok: false, error: "Kein API-Key gesetzt." };

  // Short timeout + no retries: this is a connectivity probe, and the /test
  // route fans out over every keyed provider with a 60s maxDuration — one
  // unresponsive provider must not stall the whole batch.
  const client = new OpenAI({
    apiKey: key,
    baseURL: provider.baseUrl,
    timeout: 15_000,
    maxRetries: 0,
  });
  const useModel = model?.trim() || provider.defaultModel;
  try {
    await client.chat.completions.create({
      model: useModel,
      messages: [{ role: "user", content: "ping" }],
    });
    return { provider: provider.id, label: provider.label, ok: true, model: useModel };
  } catch (err) {
    return {
      provider: provider.id,
      label: provider.label,
      ok: false,
      model: useModel,
      error: friendlyAiError(err),
    };
  }
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

/**
 * Models for the Settings/Setup dropdown of the ACTIVE provider: the provider's
 * curated list first (always available, no key required), enriched with the
 * live `/models` result when a key is present. Deduplicated, curated order kept.
 * Never throws — a live-listing failure degrades to the curated list.
 */
export async function listModelsForUi(): Promise<string[]> {
  const { aiProvider } = getConfig();
  const curated = getProvider(aiProvider).models ?? [];
  let live: string[] = [];
  try {
    live = await listChatModels();
  } catch {
    live = [];
  }
  return [...new Set([...curated, ...live])];
}
