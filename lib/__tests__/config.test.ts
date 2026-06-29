import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getConfig, getPublicConfig } from "../config";
import { writeSettings } from "../settings";

const DEV_FILE = path.join(process.cwd(), ".data", "secrets.json");
const SETTINGS_FILE = path.join(process.cwd(), ".data", "settings.json");

function clear() {
  delete (globalThis as Record<string, unknown>).__ccc_secrets;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.CCC_APP_VERSION;
  // The dev stores are shared on disk; remove any stray file from a parallel
  // test so "no key" / setup-gate assertions are deterministic.
  for (const f of [DEV_FILE, SETTINGS_FILE]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* ignore */
    }
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

  it("public config exposes provider info (with models) and never leaks the key", () => {
    process.env.OPENAI_API_KEY = "sk-secret-value";
    const pub = getPublicConfig();
    expect(pub.hasAiKey).toBe(true);
    expect(pub.aiProvider).toBe("openai");
    expect(typeof pub.aiModel).toBe("string");
    expect(pub.providers.length).toBe(11);
    expect(pub.providerStatus.openai).toBe(true);
    // Every provider carries a curated model list + default for the dropdown.
    const openai = pub.providers.find((p) => p.id === "openai")!;
    expect(openai.models.length).toBeGreaterThan(0);
    expect(openai.models).toContain(openai.defaultModel);
    expect(typeof pub.appVersion).toBe("string");
    expect(JSON.stringify(pub)).not.toContain("sk-secret-value");
  });

  it("ready requires the projects folder AND setup completed on this version", () => {
    process.env.CCC_APP_VERSION = "9.9.9";
    const dir = process.cwd(); // guaranteed to exist

    // Folder exists but setup was never completed for this version → not ready.
    writeSettings({ projectsDir: dir });
    expect(getPublicConfig().ready).toBe(false);

    // Stamp the running version → ready (setup complete on 9.9.9).
    writeSettings({ setupVersion: "9.9.9" });
    const pub = getPublicConfig();
    expect(pub.appVersion).toBe("9.9.9");
    expect(pub.ready).toBe(true);

    // A version bump invalidates setup again — the after-update gate that
    // re-shows the welcome screen (the GitHub token lives elsewhere, untouched).
    process.env.CCC_APP_VERSION = "9.9.10";
    expect(getPublicConfig().ready).toBe(false);
  });
});
