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
  /** Initial model id when this provider is first selected (must be in `models`). */
  defaultModel: string;
  /**
   * Curated list of the provider's current models, shown in the dropdown even
   * without an API key. When a key IS set and `listModels` is true, the live
   * `GET {baseUrl}/models` result is merged on top (see `listModelsForUi`), so
   * this list is the always-available baseline, not an exhaustive catalogue.
   */
  models: string[];
  /** Whether GET {baseUrl}/models returns a usable list (enriches the dropdown). */
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
    models: [
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
      "gpt-5.3",
      "o4",
      "o4-mini",
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4o",
      "gpt-4o-mini",
    ],
    listModels: true,
    keysUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    envVar: "GROQ_API_KEY",
    // The gpt-oss-* models are gated on Groq (require accepting separate terms),
    // so using one as the default makes the very first "Improve prompt" call fail
    // with 403 acces denied. Default to a model available to every key instead.
    defaultModel: "llama-3.3-70b-versatile",
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "qwen3-32b",
      "moonshotai/kimi-k2-instruct",
      "deepseek-r1-distill-llama-70b",
      "openai/gpt-oss-20b",
      "openai/gpt-oss-120b",
    ],
    listModels: true,
    keysUrl: "https://console.groq.com/keys",
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    baseUrl: "https://api.x.ai/v1",
    envVar: "XAI_API_KEY",
    defaultModel: "grok-4.3",
    models: [
      "grok-4.3",
      "grok-4.3-fast",
      "grok-4.3-mini",
      "grok-4",
      "grok-4-fast",
      "grok-3",
      "grok-code-fast-1",
    ],
    listModels: false,
    keysUrl: "https://console.x.ai",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    envVar: "OPENROUTER_API_KEY",
    defaultModel: "anthropic/claude-opus-4.6",
    models: [
      "anthropic/claude-opus-4.6",
      "anthropic/claude-sonnet-4.6",
      "anthropic/claude-haiku-4.5",
      "openai/gpt-5.4",
      "openai/gpt-5.4-mini",
      "google/gemini-3.5-pro",
      "google/gemini-3.5-flash",
      "x-ai/grok-4.3",
      "deepseek/deepseek-v4",
      "meta-llama/llama-4-maverick",
    ],
    listModels: true,
    keysUrl: "https://openrouter.ai/settings/keys",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    envVar: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-v4-flash",
    models: ["deepseek-v4-flash", "deepseek-v4", "deepseek-chat", "deepseek-reasoner"],
    listModels: true,
    keysUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "mistral",
    label: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    envVar: "MISTRAL_API_KEY",
    defaultModel: "mistral-medium-latest",
    models: [
      "mistral-large-latest",
      "mistral-medium-latest",
      "mistral-small-latest",
      "magistral-medium-latest",
      "magistral-small-latest",
      "codestral-latest",
      "ministral-8b-latest",
    ],
    listModels: true,
    keysUrl: "https://console.mistral.ai",
  },
  {
    id: "together",
    label: "Together AI",
    baseUrl: "https://api.together.ai/v1",
    envVar: "TOGETHER_API_KEY",
    defaultModel: "Qwen/Qwen3.5-9B",
    models: [
      "Qwen/Qwen3.5-9B",
      "Qwen/Qwen3.5-72B-Instruct",
      "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "deepseek-ai/DeepSeek-V4",
      "mistralai/Mixtral-8x22B-Instruct-v0.1",
    ],
    listModels: true,
    keysUrl: "https://api.together.ai/settings/api-keys",
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    envVar: "FIREWORKS_API_KEY",
    defaultModel: "accounts/fireworks/models/deepseek-v4-pro",
    models: [
      "accounts/fireworks/models/deepseek-v4-pro",
      "accounts/fireworks/models/deepseek-v4",
      "accounts/fireworks/models/llama-v3p3-70b-instruct",
      "accounts/fireworks/models/qwen3-235b-a22b",
      "accounts/fireworks/models/kimi-k2-instruct",
    ],
    listModels: false,
    keysUrl: "https://fireworks.ai/api-keys",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    baseUrl: "https://api.perplexity.ai/v1",
    envVar: "PERPLEXITY_API_KEY",
    defaultModel: "sonar-pro",
    models: ["sonar", "sonar-pro", "sonar-reasoning", "sonar-reasoning-pro", "sonar-deep-research"],
    listModels: true,
    keysUrl: "https://console.perplexity.ai",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envVar: "GEMINI_API_KEY",
    defaultModel: "gemini-3.5-flash",
    models: [
      "gemini-3.5-pro",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
    ],
    listModels: true,
    keysUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    envVar: "CEREBRAS_API_KEY",
    defaultModel: "llama-3.3-70b",
    models: [
      "llama-3.3-70b",
      "llama-3.1-8b",
      "llama-4-scout-17b-16e-instruct",
      "qwen-3-32b",
      "deepseek-r1-distill-llama-70b",
      "gpt-oss-120b",
    ],
    listModels: true,
    keysUrl: "https://cloud.cerebras.ai",
  },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

/** Look up a provider by id; falls back to the default (OpenAI) for unknown ids. */
export function getProvider(id: string | undefined): AiProvider {
  return (id && BY_ID.get(id)) || BY_ID.get(DEFAULT_PROVIDER_ID)!;
}
