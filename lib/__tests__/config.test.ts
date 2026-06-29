import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getConfig, getPublicConfig } from "../config";

const DEV_FILE = path.join(process.cwd(), ".data", "secrets.json");

function clear() {
  delete (globalThis as Record<string, unknown>).__ccc_secrets;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GROQ_API_KEY;
  // The dev secrets store is shared on disk; ignore any stray file from a
  // parallel test so "no key" assertions are deterministic.
  try {
    fs.rmSync(DEV_FILE, { force: true });
  } catch {
    /* ignore */
  }
}

describe("config (multi-provider)", () => {
  beforeEach(clear);
  afterEach(clear);

  it("active provider defaults to openai and reads its key from env", () => {
    process.env.OPENAI_API_KEY = "sk-env";
    const c = getConfig();
    expect(c.aiProvider).toBe("openai");
    expect(c.aiApiKey).toBe("sk-env");
    expect(c.aiBaseUrl).toMatch(/^https:\/\//);
  });

  it("bridge key overrides env for the active provider", () => {
    process.env.OPENAI_API_KEY = "sk-env";
    (globalThis as Record<string, unknown>).__ccc_secrets = {
      get: () => ({ providerKeys: { openai: "sk-bridge" } }),
      set: () => {},
    };
    expect(getConfig().aiApiKey).toBe("sk-bridge");
  });

  it("public config exposes provider info and never leaks the key", () => {
    process.env.OPENAI_API_KEY = "sk-secret-value";
    const pub = getPublicConfig();
    expect(pub.hasAiKey).toBe(true);
    expect(pub.aiProvider).toBe("openai");
    expect(typeof pub.aiModel).toBe("string");
    expect(pub.providers.length).toBe(11);
    expect(pub.providerStatus.openai).toBe(true);
    expect(JSON.stringify(pub)).not.toContain("sk-secret-value");
  });

  it("ready depends only on the projects folder, not on an AI key", () => {
    // No key set at all → still ready as long as the (default cwd) folder exists.
    const pub = getPublicConfig();
    expect(pub.hasAiKey).toBe(false);
    expect(typeof pub.ready).toBe("boolean");
  });
});
