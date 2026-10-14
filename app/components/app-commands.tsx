"use client";

import { createContext, useContext } from "react";

export type SectionId =
  | "dashboard"
  | "launcher"
  | "github-launch"
  | "sessions"
  | "remote"
  | "codium"
  | "github"
  | "jarvis"
  | "settings";

/** A command targeted at a section, with a nonce so repeats re-trigger effects. */
export interface SectionCommand {
  nonce: number;
  payload: unknown;
}

/** One payload, or every payload a single poll delivered to the same section. */
export function commandPayloads(payload: unknown): unknown[] {
  const record = payload as { kind?: string; items?: unknown[] } | null;
  if (record && record.kind === "batch" && Array.isArray(record.items)) return record.items;
  return [payload];
}

/** Cross-section actions used to drive the rest of the app. */
export interface AppCommands {
  navigate: (id: SectionId) => void;
  launchClaude: (
    projectPath: string,
    projectName: string,
    prompt: string,
  ) => void;
  launchClaudeInRepo: (
    projectPath: string,
    projectName: string,
    prompt: string,
  ) => void;
}

export const AppCommandsContext = createContext<AppCommands | null>(null);

export function useAppCommands(): AppCommands {
  const ctx = useContext(AppCommandsContext);
  if (!ctx) throw new Error("useAppCommands must be used within the Shell");
  return ctx;
}
