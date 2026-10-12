import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readSecrets, writeSecrets, secretsStatus } from "../secrets";

const DEV_FILE = path.join(process.cwd(), ".data", "secrets.json");

function clearEnvAndStore() {
  delete (globalThis as Record<string, unknown>).__ccc_secrets;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.CARTESIA_API_KEY;
  delete process.env.PICOVOICE_ACCESS_KEY;
  try {
    fs.rmSync(DEV_FILE, { force: true });
  } catch {
    /* ignore */
  }
}

describe("secrets layer (multi-provider)", () => {
  beforeEach(clearEnvAndStore);
  afterEach(clearEnvAndStore);

  it("reads a provider key from its env var when no bridge/store", () => {
    process.env.GROQ_API_KEY = "gsk-env";
    expect(readSecrets().providerKeys?.groq).toBe("gsk-env");
    expect(secretsStatus().providers.groq).toBe(true);
  });

  it("legacy OPENAI_API_KEY maps to providerKeys.openai", () => {
    process.env.OPENAI_API_KEY = "sk-env";
    const s = readSecrets();
    expect(s.providerKeys?.openai).toBe("sk-env");
    expect(s.openaiApiKey).toBe("sk-env");
    expect(secretsStatus().providers.openai).toBe(true);
  });

  it("writeSecrets persists a provider key to the dev store", () => {
    const status = writeSecrets({ providerKeys: { groq: "gsk-dev" } });
    expect(status.providers.groq).toBe(true);
    expect(readSecrets().providerKeys?.groq).toBe("gsk-dev");
  });

  it("legacy openaiApiKey patch writes providerKeys.openai", () => {
    writeSecrets({ openaiApiKey: "sk-dev" });
    expect(readSecrets().providerKeys?.openai).toBe("sk-dev");
    expect(secretsStatus().providers.openai).toBe(true);
  });

  it("empty string clears a provider key, leaving others intact", () => {
    writeSecrets({ providerKeys: { groq: "gsk-dev", openai: "sk-dev" } });
    const status = writeSecrets({ providerKeys: { groq: "" } });
    expect(status.providers.groq).toBe(false);
    expect(status.providers.openai).toBe(true);
  });

  it("bridge provider key overrides env", () => {
    process.env.GROQ_API_KEY = "gsk-env";
    (globalThis as Record<string, unknown>).__ccc_secrets = {
      get: () => ({ providerKeys: { groq: "gsk-bridge" } }),
      set: () => {},
    };
    expect(readSecrets().providerKeys?.groq).toBe("gsk-bridge");
  });

  it("stores the remote ssh password without putting it in the status", () => {
    writeSecrets({ remoteSshPassword: "s3cret-ssh" });
    expect(readSecrets().remoteSshPassword).toBe("s3cret-ssh");
    expect(secretsStatus().hasRemotePassword).toBe(true);
    expect(JSON.stringify(secretsStatus())).not.toContain("s3cret-ssh");
    writeSecrets({ providerKeys: { groq: "gsk-dev" } });
    expect(readSecrets().remoteSshPassword).toBe("s3cret-ssh");
    writeSecrets({ remoteSshPassword: "" });
    expect(readSecrets().remoteSshPassword).toBeUndefined();
    expect(secretsStatus().hasRemotePassword).toBe(false);
  });

  it("keeps several remote passwords and never puts them in the status", () => {
    writeSecrets({ remoteSshPasswords: { "luis@10.0.0.8": "pw-one", "ada@10.0.0.9": "pw-two" } });
    expect(readSecrets().remoteSshPasswords?.["luis@10.0.0.8"]).toBe("pw-one");
    expect(secretsStatus().hasRemotePassword).toBe(true);
    expect(JSON.stringify(secretsStatus())).not.toContain("pw-one");
    writeSecrets({ remoteSshPasswords: { "luis@10.0.0.8": "" } });
    expect(readSecrets().remoteSshPasswords?.["ada@10.0.0.9"]).toBe("pw-two");
    expect(readSecrets().remoteSshPasswords?.["luis@10.0.0.8"]).toBeUndefined();
  });

  it("writeSecrets routes through the bridge when present", () => {
    let captured: { providerKeys?: Record<string, string> } = {};
    (globalThis as Record<string, unknown>).__ccc_secrets = {
      get: () => captured,
      set: (p: { providerKeys?: Record<string, string> }) => {
        captured = p;
      },
    };
    writeSecrets({ providerKeys: { xai: "xai-bridge" } });
    expect(captured.providerKeys?.xai).toBe("xai-bridge");
  });
});
