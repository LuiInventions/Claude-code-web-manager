/**
 * Shared model + effort options for the Claude Code launcher.
 * Used by the launcher UI (dropdowns) and validated server-side before the
 * values become CLI flags (`--model`, `--effort`). Empty value = omit the flag
 * (Claude Code's own default).
 */

export interface Option {
  /** Human label shown in the dropdown. */
  label: string;
  /** CLI value passed to claude; "" means "use Claude Code's default". */
  value: string;
}

export const MODEL_OPTIONS: Option[] = [
  { label: "Standard", value: "" },
  { label: "Opus 4.8", value: "opus" },
  { label: "Sonnet 4.6", value: "sonnet" },
  { label: "Haiku 4.5", value: "haiku" },
  { label: "Fable 5", value: "fable" },
];

export const EFFORT_OPTIONS: Option[] = [
  { label: "Standard", value: "" },
  { label: "low", value: "low" },
  { label: "medium", value: "medium" },
  { label: "high", value: "high" },
  { label: "xhigh", value: "xhigh" },
  { label: "max", value: "max" },
];

const MODEL_VALUES = new Set(MODEL_OPTIONS.map((o) => o.value).filter(Boolean));
const EFFORT_VALUES = new Set(EFFORT_OPTIONS.map((o) => o.value).filter(Boolean));

/** Returns a safe `--model` value, or undefined if it should be omitted. */
export function normalizeModel(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return MODEL_VALUES.has(s) ? s : undefined;
}

/** Returns a safe `--effort` value, or undefined if it should be omitted. */
export function normalizeEffort(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return EFFORT_VALUES.has(s) ? s : undefined;
}
