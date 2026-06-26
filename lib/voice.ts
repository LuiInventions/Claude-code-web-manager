import { getConfig } from "./config";

/**
 * Voice (STT + TTS) via Cartesia.
 * - STT: ink-whisper (multilingual; we use German). Send WAV/webm/mp3 etc.
 * - TTS: Sonic with a German voice (default "Sebastian – Orator").
 */

const BASE = "https://api.cartesia.ai";

/**
 * Make text safe to read ALOUD. Cartesia Sonic spells standalone all-caps
 * tokens letter by letter (e.g. "README" → "R-E-A-D-M-E"). The user wants the
 * bot to NEVER spell anything out — always whole words, even if the result
 * sounds slightly off. We title-case each standalone run of 2+ capital letters
 * (README → Readme, PR → Pr, RED-GREEN → Red-Green) so it is pronounced as a
 * word. Single capitals and camelCase identifiers (getURL) are left untouched.
 */
export function humanizeForSpeech(text: string): string {
  return text.replace(
    /\b[A-ZÄÖÜ]{2,}\b/g,
    (w) => w[0] + w.slice(1).toLowerCase(),
  );
}

function authHeaders(): Record<string, string> {
  const cfg = getConfig();
  if (!cfg.cartesiaApiKey) throw new Error("CARTESIA_API_KEY ist nicht gesetzt.");
  return {
    "X-API-Key": cfg.cartesiaApiKey,
    "Cartesia-Version": cfg.cartesiaVersion,
  };
}

export async function transcribe(
  audio: Buffer,
  filename: string,
  mime: string,
): Promise<string> {
  const cfg = getConfig();
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(audio)], { type: mime || "audio/wav" }), filename);
  fd.append("model", cfg.cartesiaSttModel);
  fd.append("language", cfg.voiceLanguage);
  const r = await fetch(`${BASE}/stt`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  if (!r.ok) throw new Error(`Cartesia STT ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const d = await r.json();
  return String(d.text ?? "").trim();
}

export async function synthesize(
  text: string,
): Promise<{ audio: Buffer; contentType: string }> {
  const cfg = getConfig();
  const r = await fetch(`${BASE}/tts/bytes`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      model_id: cfg.cartesiaTtsModel,
      transcript: humanizeForSpeech(text),
      voice: { mode: "id", id: cfg.cartesiaVoice },
      language: cfg.voiceLanguage,
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
    }),
  });
  if (!r.ok) throw new Error(`Cartesia TTS ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return { audio: Buffer.from(await r.arrayBuffer()), contentType: "audio/mpeg" };
}

export interface VoiceOption {
  id: string;
  name: string;
  gender: string;
}

export async function listGermanVoices(): Promise<VoiceOption[]> {
  const cfg = getConfig();
  if (!cfg.cartesiaApiKey) return [];
  const r = await fetch(
    `${BASE}/voices?language=${encodeURIComponent(cfg.voiceLanguage)}&limit=100`,
    { headers: authHeaders() },
  );
  if (!r.ok) return [];
  const d = await r.json();
  return (d.data ?? []).map(
    (v: { id: string; name: string; gender?: string }) => ({
      id: v.id,
      name: v.name,
      gender: v.gender ?? "",
    }),
  );
}
