import type { UiSectionId } from "../ui-commands";

/**
 * Names an AI should pass to app_navigate. They match the sidebar labels.
 * Internal ids (`launcher`, `github-launch`) are accepted as aliases.
 */
export const SECTION_ARG = [
  "remote",
  "github",
  "local",
  "repos",
  "sessions",
  "settings",
] as const;

export type SectionArg = (typeof SECTION_ARG)[number];

const ALIAS: Record<string, UiSectionId> = {
  remote: "remote",
  github: "github-launch",
  "github-launch": "github-launch",
  local: "launcher",
  launcher: "launcher",
  repos: "github",
  sessions: "sessions",
  settings: "settings",
};

export const SECTION_LABEL: Record<UiSectionId, string> = {
  remote: "Remote",
  "github-launch": "GitHub",
  launcher: "Local",
  github: "Repos",
  sessions: "Sessions",
  jarvis: "Jarvis",
  settings: "Settings",
};

export function resolveSection(raw: string): UiSectionId | null {
  return ALIAS[raw.trim()] ?? null;
}

export function sectionGuide(): { arg: string; label: string; does: string }[] {
  return [
    { arg: "remote", label: "Remote", does: "SSH login, remote files, and a code CLI on the server." },
    { arg: "github", label: "GitHub", does: "Start a code CLI in a cloned GitHub repo." },
    { arg: "local", label: "Local", does: "Start a code CLI in a folder on this PC." },
    { arg: "repos", label: "Repos", does: "GitHub token, clone list, create repo, commit and push." },
    { arg: "sessions", label: "Sessions", does: "Pixel office of every live code-CLI session." },
    { arg: "settings", label: "Settings", does: "Provider, model, code CLI, theme, project folder." },
  ];
}
