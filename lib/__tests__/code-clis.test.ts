import { afterEach, describe, expect, it } from "vitest";
import {
  buildInteractiveArgs,
  normalizeCliOption,
  normalizeCodeCli,
  spawnEnv,
} from "../code-clis";

describe("code CLIs", () => {
  const savedUpdater = process.env.DISABLE_AUTOUPDATER;
  const savedTraffic = process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;

  afterEach(() => {
    if (savedUpdater === undefined) delete process.env.DISABLE_AUTOUPDATER;
    else process.env.DISABLE_AUTOUPDATER = savedUpdater;
    if (savedTraffic === undefined) delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    else process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = savedTraffic;
  });

  it("falls back to claude for an unknown id", () => {
    expect(normalizeCodeCli(undefined)).toBe("claude");
    expect(normalizeCodeCli("nope")).toBe("claude");
    expect(normalizeCodeCli(" grok ")).toBe("grok");
  });

  it("builds claude args with skip-permissions and drops unknown flags", () => {
    expect(
      buildInteractiveArgs("claude", {
        prompt: "fix the tests",
        model: "opus",
        effort: "high",
      }),
    ).toEqual([
      "--dangerously-skip-permissions",
      "--model",
      "opus",
      "--effort",
      "high",
      "fix the tests",
    ]);
    expect(
      buildInteractiveArgs("claude", { prompt: "", model: "gpt-5.4", effort: "" }),
    ).toEqual(["--dangerously-skip-permissions"]);
    expect(normalizeCliOption("claude", "model", "opus")).toBe("opus");
    expect(normalizeCliOption("claude", "model", "grok-4.7")).toBeUndefined();
  });

  it("builds grok args", () => {
    expect(
      buildInteractiveArgs("grok", {
        prompt: "explain this",
        model: "grok-4.7",
        effort: "low",
      }),
    ).toEqual([
      "--permission-mode",
      "bypassPermissions",
      "--model",
      "grok-4.7",
      "--reasoning-effort",
      "low",
      "explain this",
    ]);
  });

  it("builds codex args and keeps the prompt as one argv entry", () => {
    expect(
      buildInteractiveArgs("codex", {
        prompt: 'say "hi"',
        model: "gpt-5.4",
        effort: "high",
      }),
    ).toEqual([
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "gpt-5.4",
      "--config",
      'model_reasoning_effort="high"',
      'say "hi"',
    ]);
  });

  it("asks Claude to skip its update check without overriding a set value", () => {
    delete process.env.DISABLE_AUTOUPDATER;
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    const claude = spawnEnv("claude");
    expect(claude.DISABLE_AUTOUPDATER).toBe("1");
    expect(claude.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe("1");

    process.env.DISABLE_AUTOUPDATER = "0";
    expect(spawnEnv("claude").DISABLE_AUTOUPDATER).toBe("0");

    delete process.env.DISABLE_AUTOUPDATER;
    expect(spawnEnv("grok").DISABLE_AUTOUPDATER).toBeUndefined();
    expect(spawnEnv("codex").CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBeUndefined();
  });
});
