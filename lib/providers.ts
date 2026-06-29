/**
 * Registry of AI providers for prompt improvement + session review.
 *
 * Every provider here exposes an OpenAI-compatible `/chat/completions` endpoint,
 * so the single `openai` SDK is reused with a per-provider `baseUrl` + API key.
 * Base URLs are stored WITHOUT a trailing slash so the SDK appends
 * `/chat/completions` and `/models` cleanly.
 *
 * Base URLs / default models verified against official docs (June 2026).
 */
export interface AiProvider {
  /** Stable id used in settings + as the secrets key. */
  id: string;
  /** Human label for the dropdown. */
  label: string;
  /** OpenAI-compatible base URL (no trailing slash). */
  baseUrl: string;
  /** Environment variable the key mirrors to (for .env / shell use). */
  envVar: string;
  /** Initial model id when this provider is first selected. */
  defaultModel: string;
  /** Whether GET {baseUrl}/models returns a usable list (drives the model dropdown). */
  listModels: boolean;
  /** Where the user creates an API key (shown as a hint). */
  keysUrl: string;
}

export const DEFAULT_PROVIDER_ID = "openai";

export const PROVIDERS: AiProvider[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    envVar: "OPENAI_API_KEY",
    defaultModel: "gpt-5.4-mini",
    listModels: true,
    keysUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    envVar: "GROQ_API_KEY",
    defaultModel: "openai/gpt-oss-20b",
    listModels: true,
    keysUrl: "https://console.groq.com/keys",
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    baseUrl: "https://api.x.ai/v1",
    envVar: "XAI_API_KEY",
    defaultModel: "grok-4.3",
    listModels: false,
    keysUrl: "https://console.x.ai",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    envVar: "OPENROUTER_API_KEY",
    defaultModel: "anthropic/claude-opus-4.6",
    listModels: true,
    keysUrl: "https://openrouter.ai/settings/keys",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    envVar: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-v4-flash",
    listModels: true,
    keysUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "mistral",
    label: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    envVar: "MISTRAL_API_KEY",
    defaultModel: "mistral-medium-latest",
    listModels: true,
    keysUrl: "https://console.mistral.ai",
  },
  {
    id: "together",
    label: "Together AI",
    baseUrl: "https://api.together.ai/v1",
    envVar: "TOGETHER_API_KEY",
    defaultModel: "Qwen/Qwen3.5-9B",
    listModels: true,
    keysUrl: "https://api.together.ai/settings/api-keys",
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    envVar: "FIREWORKS_API_KEY",
    defaultModel: "accounts/fireworks/models/deepseek-v4-pro",
    listModels: false,
    keysUrl: "https://fireworks.ai/api-keys",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    baseUrl: "https://api.perplexity.ai/v1",
    envVar: "PERPLEXITY_API_KEY",
    defaultModel: "sonar-pro",
    listModels: true,
    keysUrl: "https://console.perplexity.ai",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envVar: "GEMINI_API_KEY",
    defaultModel: "gemini-3.5-flash",
    listModels: true,
    keysUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    envVar: "CEREBRAS_API_KEY",
    defaultModel: "llama-3.3-70b",
    listModels: true,
    keysUrl: "https://cloud.cerebras.ai",
  },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

/** Look up a provider by id; falls back to the default (OpenAI) for unknown ids. */
export function getProvider(id: string | undefined): AiProvider {
  return (id && BY_ID.get(id)) || BY_ID.get(DEFAULT_PROVIDER_ID)!;
}
