/**
 * The coding CLIs the launcher can drive in a PTY.
 *
 * This is separate from the AI provider (`lib/providers.ts`). The provider
 * rewrites prompts and writes reviews. The code CLI is the agent that actually
 * edits the project: Claude Code, Grok Build, or the ChatGPT Codex CLI.
 *
 * Model and effort values are the flag values for that CLI. `""` means omit
 * the flag and keep the CLI's own default.
 */

export type CodeCliId = "claude" | "grok" | "codex";

export interface CliOption {
  label: string;
  /** Flag value. Empty string = do not pass the flag. */
  value: string;
}

export interface CodeCliDef {
  id: CodeCliId;
  /** Full name shown in setup and settings. */
  label: string;
  /** Short name used on Start buttons. */
  shortLabel: string;
  /** Executable name on PATH. */
  bin: string;
  /** One line under the choice. */
  hint: string;
  models: CliOption[];
  efforts: CliOption[];
}

export const DEFAULT_CODE_CLI: CodeCliId = "claude";

const STANDARD: CliOption = { label: "Standard", value: "" };

export const CODE_CLIS: CodeCliDef[] = [
  {
    id: "claude",
    label: "Claude Code",
    shortLabel: "Claude Code",
    bin: "claude",
    hint: "Anthropic Claude Code (`claude`). Permission prompts are skipped for the session.",
    models: [
      STANDARD,
      { label: "Opus 4.8", value: "opus" },
      { label: "Sonnet 4.6", value: "sonnet" },
      { label: "Haiku 4.5", value: "haiku" },
      { label: "Fable 5", value: "fable" },
    ],
    efforts: [
      STANDARD,
      { label: "low", value: "low" },
      { label: "medium", value: "medium" },
      { label: "high", value: "high" },
      { label: "xhigh", value: "xhigh" },
      { label: "max", value: "max" },
    ],
  },
  {
    id: "grok",
    label: "Grok",
    shortLabel: "Grok",
    bin: "grok",
    hint: "Grok Build (`grok`). Permission prompts are skipped for the session.",
    models: [
      STANDARD,
      { label: "Grok 4.7", value: "grok-4.7" },
      { label: "Grok 4.7 fast", value: "grok-4.7-build-fast" },
      { label: "Grok 4.6", value: "grok-4.6" },
      { label: "Grok 4.5", value: "grok-4.5" },
    ],
    efforts: [
      STANDARD,
      { label: "low", value: "low" },
      { label: "medium", value: "medium" },
      { label: "high", value: "high" },
    ],
  },
  {
    id: "codex",
    label: "ChatGPT Codex",
    shortLabel: "Codex",
    bin: "codex",
    hint: "ChatGPT Codex CLI (`codex`). Approval prompts and the sandbox are skipped for the session.",
    models: [
      STANDARD,
      { label: "GPT-5.5", value: "gpt-5.5" },
      { label: "GPT-5.4", value: "gpt-5.4" },
      { label: "GPT-5.4 mini", value: "gpt-5.4-mini" },
    ],
    efforts: [
      STANDARD,
      { label: "low", value: "low" },
      { label: "medium", value: "medium" },
      { label: "high", value: "high" },
      { label: "xhigh", value: "xhigh" },
    ],
  },
];

const BY_ID = new Map(CODE_CLIS.map((c) => [c.id, c]));

export function isCodeCliId(v: unknown): v is CodeCliId {
  return typeof v === "string" && BY_ID.has(v as CodeCliId);
}

/** Unknown or empty values fall back to Claude Code. */
export function normalizeCodeCli(v: unknown): CodeCliId {
  const s = typeof v === "string" ? v.trim() : "";
  return isCodeCliId(s) ? s : DEFAULT_CODE_CLI;
}

export function getCodeCli(id: CodeCliId | undefined): CodeCliDef {
  return BY_ID.get(normalizeCodeCli(id))!;
}

/** A dropdown value that belongs to this CLI, or undefined when the flag should be omitted. */
export function normalizeCliOption(
  id: CodeCliId,
  kind: "model" | "effort",
  v: unknown,
): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return undefined;
  const cli = getCodeCli(id);
  const options = kind === "model" ? cli.models : cli.efforts;
  return options.some((o) => o.value === s) ? s : undefined;
}

/**
 * Argv for an interactive session, options first and the prompt last.
 * No shell interpolation — the prompt is one argv entry.
 */
export function buildInteractiveArgs(
  id: CodeCliId,
  opts: { prompt?: string; model?: string; effort?: string },
): string[] {
  const model = normalizeCliOption(id, "model", opts.model);
  const effort = normalizeCliOption(id, "effort", opts.effort);
  const prompt = typeof opts.prompt === "string" ? opts.prompt : "";
  const args: string[] = [];

  if (id === "claude") {
    args.push("--dangerously-skip-permissions");
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);
  } else if (id === "grok") {
    args.push("--permission-mode", "bypassPermissions");
    if (model) args.push("--model", model);
    if (effort) args.push("--reasoning-effort", effort);
  } else {
    // Same trust level as Claude's skip-permissions: the embedded terminal
    // should not stall on an approval dialog the user cannot easily answer.
    args.push("--dangerously-bypass-approvals-and-sandbox");
    if (model) args.push("--model", model);
    if (effort) args.push("--config", `model_reasoning_effort="${effort}"`);
  }

  if (prompt) args.push(prompt);
  return args;
}

/**
 * Environment for a spawned CLI. Claude Code phones home for an update check
 * before the TUI paints; skipping that is the cheap part of a faster open.
 * A value the user already set is left alone.
 */
export function spawnEnv(id: CodeCliId): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (id === "claude") {
    if (!env.DISABLE_AUTOUPDATER) env.DISABLE_AUTOUPDATER = "1";
    if (!env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC) {
      env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
    }
  }
  if (id === "grok") {
    // Claude settings hooks run around every real tool call. When they fail,
    // Grok prints the error and continues, so the same lines repeat.
    env.GROK_CLAUDE_HOOKS_ENABLED = "false";
  }
  return env;
}
