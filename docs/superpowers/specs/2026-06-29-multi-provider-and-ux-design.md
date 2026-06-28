# Multi-Provider AI + UX Changes — Design Spec (v1.1)

**Date:** 2026-06-29
**Status:** Approved → implementing

## Goals (from user)

1. Support 10 more AI key providers for prompt improvement / session review,
   alongside OpenAI: **Groq, xAI (Grok), OpenRouter, DeepSeek, Mistral,
   Together AI, Fireworks AI, Perplexity, Google Gemini (OpenAI-compat),
   Cerebras** → 11 providers total.
2. AI provider/key is **optional**: with no key, prompt improvement and review
   are disabled (greyed out with a hint), the app stays fully usable for
   launching Claude.
3. On open, the app loads **Launcher** by default (not Dashboard).
4. Rename **Dashboard → "Local Projects"** (sidebar + Launcher project picker).
5. Update README.
6. Build the `.exe` and publish it as **v1.1** (only the Setup file).

## Architecture

All listed providers expose an **OpenAI-compatible** `/chat/completions` (and
mostly `/models`). So we keep the single `openai` SDK and vary `baseURL` + key
per provider. The OpenAI-only **Responses API** used today is replaced by
**Chat Completions**, which every provider (incl. OpenAI) supports.

### New: `lib/providers.ts`

```ts
export interface AiProvider {
  id: string;            // "openai", "groq", ...
  label: string;        // "OpenAI", "Groq", ...
  baseUrl: string;      // OpenAI-compatible base
  envVar: string;       // e.g. "GROQ_API_KEY"
  defaultModel: string; // initial model id
  listModels: boolean;  // does /models work?
  keysUrl?: string;     // where to get a key (shown as a hint)
}
export const PROVIDERS: AiProvider[];      // 11 entries
export const DEFAULT_PROVIDER_ID = "openai";
export function getProvider(id: string): AiProvider; // falls back to default
```

Exact base URLs / default models / `/models` support are verified against
current docs before coding (not from memory).

### Secrets (`lib/secrets.ts` + `build/electron/secrets.ts`)

Generalize from fixed fields to per-provider LLM keys, keeping the existing
non-LLM keys:
- `Secrets` gains `providerKeys: Record<string, string>` (one entry per AI
  provider id). `cartesiaApiKey` and `picovoiceAccessKey` stay as-is.
- `openaiApiKey` continues to work (maps to `providerKeys.openai`) for
  backward compatibility with `.env`/existing stores.
- Each provider key mirrors to its `envVar`. Precedence unchanged:
  bridge → dev store → env.

### Config (`lib/config.ts`)

- `AppConfig` gains `aiProvider: string` and the resolved `aiBaseUrl`,
  `aiApiKey`, `aiModel`.
- `settings.json` gains `aiProvider` and `aiModel` (not secret).
- `PublicConfig` gains `aiProvider`, `aiModel`, `hasAiKey: boolean`, and a
  `providers: {id,label}[]` list for the dropdown. `ready` becomes
  **`existsSync(projectsDir)`** only (no key required).

### AI client (`lib/openai.ts`)

- `getAiClient()` → `new OpenAI({ apiKey, baseURL })` from the active provider;
  throws a friendly error if no key.
- `hasAiKey()` → boolean (drives the optional UI).
- `listChatModels()` → hits the active provider's `/models` (no OpenAI-only
  filter); returns `[]` if the provider has no `/models` or no key.
- `prompt-improver.ts` + `session-review.ts` switch `responses.create` →
  `chat.completions.create` (universal). The system text becomes a `system`
  message; the user text a `user` message; output read from
  `choices[0].message.content`.

### API routes

- `/api/models`: unchanged contract, now provider-aware (returns active
  provider's models).
- `/api/secrets`: extended to accept/report per-provider keys
  (`providerKeys`), keeping `openaiApiKey`/`cartesiaApiKey`/
  `picovoiceAccessKey`. Status includes `hasAiKey` per active provider.
- `/api/settings`: persists `aiProvider`, `aiModel`.

### UI

- **Setup screen**: only the projects folder is required. AI provider + key
  optional (a provider dropdown + one key field). "Loslegen" enabled once a
  folder is chosen.
- **Settings → "AI Provider" card**: provider dropdown (11), masked key field
  for the selected provider (set/missing/save/clear), model dropdown from the
  provider's `/models` (free-text fallback). Cartesia + Picovoice cards stay.
- **Shell**: default `active`/`opened` = `launcher`. Sidebar item
  `dashboard` relabelled **"Local Projects"**.
- **LauncherSection**: the project picker labelled **"Local Projects"**.
- **Prompt improve / review actions**: disabled with a tooltip when
  `hasAiKey` is false (greyed out, not hidden).

## Error handling

- No key for active provider → improver/review API routes return a clear
  message; UI disables the buttons (no crash).
- Provider `/models` failure → empty list + free-text model entry (graceful).
- Unknown provider id in settings → falls back to OpenAI default.

## Testing

- New `lib/__tests__/providers.test.ts`: registry integrity (11 ids unique,
  valid base URLs, default provider present) + `getProvider` fallback.
- Extend `lib/__tests__/secrets.test.ts`: provider key round-trip + env mirror
  + `openaiApiKey`↔`providerKeys.openai` back-compat.
- Extend `lib/__tests__/config.test.ts`: `ready` no longer needs a key;
  `aiProvider`/`aiModel`/`hasAiKey` exposed; key never leaked.
- All existing tests stay green.

## Out of scope

- Per-provider streaming, cost tracking, non-OpenAI-compatible providers,
  Anthropic-native API.
