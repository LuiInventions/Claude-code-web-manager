import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig, getPublicConfig } from "../config";

function clear() {
  delete (globalThis as Record<string, unknown>).__ccc_secrets;
  delete process.env.OPENAI_API_KEY;
}

describe("config precedence", () => {
  beforeEach(clear);
  afterEach(clear);

  it("reads openai key from env when no bridge", () => {
    process.env.OPENAI_API_KEY = "sk-env";
    expect(getConfig().openaiApiKey).toBe("sk-env");
  });

  it("bridge secret overrides env in config", () => {
    process.env.OPENAI_API_KEY = "sk-env";
    (globalThis as Record<string, unknown>).__ccc_secrets = {
      get: () => ({ openaiApiKey: "sk-bridge" }),
      set: () => {},
    };
    expect(getConfig().openaiApiKey).toBe("sk-bridge");
  });

  it("public config exposes status flags, never the key", () => {
    process.env.OPENAI_API_KEY = "sk-env";
    const pub = getPublicConfig();
    expect(pub.hasApiKey).toBe(true);
    expect(JSON.stringify(pub)).not.toContain("sk-env");
    expect(typeof pub.hasPicovoiceKey).toBe("boolean");
    expect(typeof pub.ready).toBe("boolean");
  });
});
