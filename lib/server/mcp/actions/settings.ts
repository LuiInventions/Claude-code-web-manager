import { existsSync } from "node:fs";
import { getPublicConfig } from "../../../config";
import { isCodeCliId, type CodeCliId } from "../../../code-clis";
import { writeSettings } from "../../../settings";
import { appVersion } from "../../../version";
import { isThemeId, THEMES, type ThemeId } from "../../../themes";
import { warmCodeCli } from "../../cli-warm";
import { secretsStatus, writeSecrets } from "../../../secrets";
import { PROVIDERS } from "../../../providers";
import { listModelsForUi, testProvider } from "../../../openai";
import { getUsage } from "../../../usage-store";
import { ActionError } from "../errors";

export function settingsGet() {
  const config = getPublicConfig();
  return {
    ...config,
    themes: THEMES.map((theme) => ({ id: theme.id, label: theme.label, hint: theme.hint })),
    providers: PROVIDERS.map((provider) => ({
      id: provider.id,
      label: provider.label,
      defaultModel: provider.defaultModel,
      models: provider.models,
      keysUrl: provider.keysUrl,
    })),
    note: "API keys are not included. secrets_status says whether a key is set. secrets_set stores one and does not return it.",
  };
}

export interface SettingsPatch {
  projectsDir?: string;
  aiProvider?: string;
  aiModel?: string;
  openaiModel?: string;
  cartesiaVoice?: string;
  codeCli?: string;
  launcherLocalPath?: string;
  theme?: string;
  setupComplete?: boolean;
}

export function settingsUpdate(patch: SettingsPatch) {
  const next: {
    projectsDir?: string;
    aiProvider?: string;
    aiModel?: string;
    openaiModel?: string;
    cartesiaVoice?: string;
    codeCli?: CodeCliId;
    setupVersion?: string;
    launcherLocalPath?: string;
    theme?: ThemeId;
  } = {};

  if (typeof patch.projectsDir === "string") {
    const dir = patch.projectsDir.trim();
    if (dir && !existsSync(dir)) throw new ActionError(`Folder does not exist: ${dir}`);
    next.projectsDir = dir;
  }
  if (typeof patch.aiProvider === "string") next.aiProvider = patch.aiProvider.trim();
  if (typeof patch.aiModel === "string") next.aiModel = patch.aiModel.trim();
  if (typeof patch.openaiModel === "string") next.openaiModel = patch.openaiModel.trim();
  if (typeof patch.cartesiaVoice === "string") next.cartesiaVoice = patch.cartesiaVoice.trim();
  if (typeof patch.launcherLocalPath === "string") {
    const dir = patch.launcherLocalPath.trim();
    if (dir && !existsSync(dir)) throw new ActionError(`Folder does not exist: ${dir}`);
    next.launcherLocalPath = dir;
  }
  if (typeof patch.theme === "string") {
    if (!isThemeId(patch.theme)) {
      throw new ActionError(`Unknown theme "${patch.theme}". Use one of: ${THEMES.map((t) => t.id).join(", ")}.`);
    }
    next.theme = patch.theme;
  }
  if (typeof patch.codeCli === "string" && patch.codeCli.trim()) {
    const id = patch.codeCli.trim();
    if (!isCodeCliId(id)) throw new ActionError(`Unknown code CLI "${id}". Use claude, grok, or codex.`);
    next.codeCli = id;
  }
  if (patch.setupComplete === true) {
    const dir = typeof patch.projectsDir === "string" ? patch.projectsDir.trim() : "";
    if (!dir || !existsSync(dir)) {
      throw new ActionError("setupComplete needs an existing projectsDir in the same call.");
    }
    next.setupVersion = appVersion();
  }
  writeSettings(next);
  if (next.codeCli) warmCodeCli();
  return settingsGet();
}

export function secretsGet() {
  const status = secretsStatus();
  return {
    providers: status.providers,
    hasCartesia: status.hasCartesia,
    hasPicovoice: status.hasPicovoice,
    hasRemotePassword: status.hasRemotePassword,
    note: "Values are booleans. The keys themselves are never returned.",
  };
}

export function secretsSet(input: {
  provider?: string;
  apiKey?: string;
  cartesiaApiKey?: string;
  picovoiceAccessKey?: string;
}) {
  const patch: {
    providerKeys?: Record<string, string>;
    cartesiaApiKey?: string;
    picovoiceAccessKey?: string;
  } = {};
  if (typeof input.apiKey === "string") {
    const id = input.provider?.trim() || "";
    if (!PROVIDERS.some((provider) => provider.id === id)) {
      throw new ActionError(
        `Unknown provider "${id}". Use one of: ${PROVIDERS.map((provider) => provider.id).join(", ")}.`,
      );
    }
    patch.providerKeys = { [id]: input.apiKey };
  }
  if (typeof input.cartesiaApiKey === "string") patch.cartesiaApiKey = input.cartesiaApiKey;
  if (typeof input.picovoiceAccessKey === "string") patch.picovoiceAccessKey = input.picovoiceAccessKey;
  if (!patch.providerKeys && patch.cartesiaApiKey == null && patch.picovoiceAccessKey == null) {
    throw new ActionError("Pass apiKey with provider, cartesiaApiKey, or picovoiceAccessKey. An empty string clears that key.");
  }
  const status = writeSecrets(patch);
  return {
    providers: status.providers,
    hasCartesia: status.hasCartesia,
    hasPicovoice: status.hasPicovoice,
    stored: true,
    note: "The key was stored and is not in this result.",
  };
}

export async function providersTest(provider?: string, model?: string) {
  if (provider?.trim()) return { results: [await testProvider(provider.trim(), model?.trim() || undefined)] };
  const status = secretsStatus();
  const keyed = Object.entries(status.providers)
    .filter(([, has]) => has)
    .map(([id]) => id);
  return { results: await Promise.all(keyed.map((id) => testProvider(id))) };
}

export async function modelsList() {
  try {
    return { models: await listModelsForUi() };
  } catch (err) {
    return { models: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export function usageGet() {
  return {
    ...getUsage(),
    note: "This is the Claude Code limit tracked by the launcher. Grok and Codex are not blocked by it. A remote Claude login has its own limit.",
  };
}
