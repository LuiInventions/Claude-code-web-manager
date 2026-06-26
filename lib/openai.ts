import OpenAI from "openai";
import { getConfig } from "./config";

/** OpenAI client + helpers. The API key is read server-side only. */

export function getOpenAI(): OpenAI {
  const { openaiApiKey } = getConfig();
  if (!openaiApiKey) {
    throw new Error(
      "OPENAI_API_KEY ist nicht gesetzt. Trage ihn in .env.local ein.",
    );
  }
  return new OpenAI({ apiKey: openaiApiKey });
}

export function getModel(): string {
  return getConfig().openaiModel;
}

const NON_TEXT =
  /(transcribe|tts|audio|image|realtime|search|embedding|moderation|whisper|dall)/i;

/** Chat/reasoning-capable model ids for the Settings dropdown. */
export async function listChatModels(): Promise<string[]> {
  const client = getOpenAI();
  const res = await client.models.list();
  return res.data
    .map((m) => m.id)
    .filter((id) => /^(gpt-|o\d)/.test(id) && !NON_TEXT.test(id))
    .sort();
}
