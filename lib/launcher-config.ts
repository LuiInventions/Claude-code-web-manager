/**
 * Claude Code model + effort options.
 *
 * The launcher's dropdowns follow the selected code CLI (`lib/code-clis.ts`).
 * These exports stay for the Claude print-mode runner and as the fallback
 * while the launcher is still loading settings. Empty value = omit the flag.
 */

import { getCodeCli, normalizeCliOption, type CliOption } from "./code-clis";

export type Option = CliOption;

export const MODEL_OPTIONS: Option[] = getCodeCli("claude").models;
export const EFFORT_OPTIONS: Option[] = getCodeCli("claude").efforts;

/** Returns a safe Claude `--model` value, or undefined if it should be omitted. */
export function normalizeModel(v: unknown): string | undefined {
  return normalizeCliOption("claude", "model", v);
}

/** Returns a safe Claude `--effort` value, or undefined if it should be omitted. */
export function normalizeEffort(v: unknown): string | undefined {
  return normalizeCliOption("claude", "effort", v);
}
