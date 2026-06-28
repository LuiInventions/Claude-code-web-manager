import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readSecrets, writeSecrets } from "../secrets";

const DEV_FILE = path.join(process.cwd(), ".data", "secrets.json");

function clearEnvAndStore() {
  delete (globalThis as Record<string, unknown>).__ccc_secrets;
  delete process.env.OPENAI_API_KEY;
  delete process.env.CARTESIA_API_KEY;
  delete process.env.PICOVOICE_ACCESS_KEY;
  try {
    fs.rmSync(DEV_FILE, { force: true });
  } catch {
    /* ignore */
  }
}

describe("secrets layer", () => {
  beforeEach(clearEnvAndStore);
  afterEach(clearEnvAndStore);

  it("falls back to env when no bridge and no dev store", () => {
    process.env.OPENAI_API_KEY = "sk-env";
    expect(readSecrets().openaiApiKey).toBe("sk-env");
  });

  it("bridge overrides env", () => {
    process.env.OPENAI_API_KEY = "sk-env";
    (globalThis as Record<string, unknown>).__ccc_secrets = {
      get: () => ({ openaiApiKey: "sk-bridge" }),
      set: () => {},
    };
    expect(readSecrets().openaiApiKey).toBe("sk-bridge");
  });

  it("writeSecrets persists to dev store when no bridge", () => {
    const status = writeSecrets({ openaiApiKey: "sk-dev" });
    expect(status.hasOpenai).toBe(true);
    expect(readSecrets().openaiApiKey).toBe("sk-dev");
  });

  it("empty string clears a secret", () => {
    writeSecrets({ openaiApiKey: "sk-dev" });
    const status = writeSecrets({ openaiApiKey: "" });
    expect(status.hasOpenai).toBe(false);
    expect(readSecrets().openaiApiKey).toBeUndefined();
  });

  it("writeSecrets routes through the bridge when present", () => {
    let captured: { openaiApiKey?: string } = {};
    (globalThis as Record<string, unknown>).__ccc_secrets = {
      get: () => captured,
      set: (p: { openaiApiKey?: string }) => {
        captured = p;
      },
    };
    writeSecrets({ openaiApiKey: "sk-bridge" });
    expect(captured.openaiApiKey).toBe("sk-bridge");
  });
});
