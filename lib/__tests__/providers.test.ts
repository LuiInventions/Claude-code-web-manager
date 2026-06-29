import { describe, expect, it } from "vitest";
import { PROVIDERS, DEFAULT_PROVIDER_ID, getProvider } from "../providers";

describe("AI provider registry", () => {
  it("has 11 providers with unique ids and env vars", () => {
    expect(PROVIDERS).toHaveLength(11);
    expect(new Set(PROVIDERS.map((p) => p.id)).size).toBe(11);
    expect(new Set(PROVIDERS.map((p) => p.envVar)).size).toBe(11);
  });

  it("includes the named providers", () => {
    const ids = PROVIDERS.map((p) => p.id);
    for (const id of [
      "openai",
      "groq",
      "xai",
      "openrouter",
      "deepseek",
      "mistral",
      "together",
      "fireworks",
      "perplexity",
      "gemini",
      "cerebras",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("every base URL is https and has no trailing slash", () => {
    for (const p of PROVIDERS) {
      expect(p.baseUrl).toMatch(/^https:\/\//);
      expect(p.baseUrl.endsWith("/")).toBe(false);
      expect(p.defaultModel.length).toBeGreaterThan(0);
    }
  });

  it("every provider ships a curated model list containing its default model", () => {
    for (const p of PROVIDERS) {
      expect(Array.isArray(p.models)).toBe(true);
      expect(p.models.length).toBeGreaterThan(0);
      // The default must be selectable from the dropdown.
      expect(p.models).toContain(p.defaultModel);
      // No duplicate entries within a provider's list.
      expect(new Set(p.models).size).toBe(p.models.length);
    }
  });

  it("default provider is openai and present", () => {
    expect(DEFAULT_PROVIDER_ID).toBe("openai");
    expect(getProvider(DEFAULT_PROVIDER_ID).id).toBe("openai");
  });

  it("getProvider falls back to the default for unknown ids", () => {
    expect(getProvider("does-not-exist").id).toBe(DEFAULT_PROVIDER_ID);
    expect(getProvider(undefined as unknown as string).id).toBe(DEFAULT_PROVIDER_ID);
  });
});
