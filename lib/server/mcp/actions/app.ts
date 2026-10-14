import path from "node:path";
import { getConfig, getPublicConfig } from "../../../config";
import { appVersion } from "../../../version";
import { buildIndex, getIndex } from "../../../indexer";
import { readGithubState } from "../../../github-store";
import { listPtySessions } from "../../claude-pty";
import { remoteStatus } from "../../remote-session";
import { enqueueUiCommand, uiSnapshot, type UiSectionId } from "../../ui-commands";
import { mcpUrl } from "../endpoint";
import { resolveSection, sectionGuide, SECTION_LABEL } from "../sections";
import { ActionError } from "../errors";

/** Where the app is, what it can do, and what is live right now. Call this first. */
export function appStatus() {
  const config = getConfig();
  const pub = getPublicConfig();
  const github = readGithubState();
  const remote = remoteStatus();
  const sessions = listPtySessions();
  return {
    name: "Jarvis Control Center",
    version: appVersion(),
    mcpUrl: mcpUrl(),
    bind: { host: config.host, port: config.port },
    ready: pub.ready,
    ui: uiSnapshot(),
    sections: sectionGuide(),
    codeCli: pub.codeCli,
    codeClis: pub.codeClis.map((cli) => ({
      id: cli.id,
      label: cli.label,
      installed: cli.installed,
      models: cli.models.filter((m) => m.value).map((m) => m.value),
      efforts: cli.efforts.filter((m) => m.value).map((m) => m.value),
    })),
    theme: pub.theme,
    ai: {
      provider: pub.aiProvider,
      model: pub.aiModel,
      hasKey: pub.hasAiKey,
    },
    paths: {
      projectsDir: pub.projectsDir,
      githubDir: pub.githubDir,
      launcherLocalPath: pub.launcherLocalPath || null,
    },
    github: {
      connected: github.connected,
      login: github.login,
      repos: github.repos.length,
    },
    remote: {
      connected: remote.connected,
      connecting: remote.connecting,
      host: remote.host,
      user: remote.user,
      dir: remote.dir,
      needsPassword: remote.needsPassword,
      needsOtp: remote.needsOtp,
      error: remote.error || null,
    },
    sessions: {
      live: sessions.filter((s) => s.status === "running").length,
      total: sessions.length,
    },
    next: "Use app_navigate to show a section. Use session_list before starting another CLI. Use github_status or remote_status for the full record.",
  };
}

/** Ask the open window to show a sidebar section. The command waits until the window polls. */
export function appNavigate(section: string) {
  const id = resolveSection(section);
  if (!id) {
    throw new ActionError(
      `Unknown section "${section}". Use one of: remote, github, local, repos, sessions, settings.`,
    );
  }
  const command = enqueueUiCommand(id, { kind: "navigate" });
  return {
    section: id,
    label: SECTION_LABEL[id],
    commandId: command.id,
    ui: uiSnapshot(),
    note: "The window applies this on its next poll (about once a second). ui.attached is false until that window is open.",
  };
}

export function appSections() {
  return { sections: sectionGuide() };
}

export function indexStatus() {
  const idx = getIndex();
  if (!idx) return { builtAt: null, projectCount: 0, projectsDir: getConfig().projectsDir };
  return {
    builtAt: idx.builtAt,
    projectsDir: idx.projectsDir,
    projectCount: idx.projects.length,
  };
}

export async function indexRebuild() {
  const idx = await buildIndex();
  return {
    builtAt: idx.builtAt,
    projectsDir: idx.projectsDir,
    projectCount: idx.projects.length,
  };
}

export function showSession(opts: {
  id: string;
  where?: "remote";
  cwd: string;
  cli: string;
  origin?: "github";
  projectName: string;
}): { section: UiSectionId; commandId: number } {
  const section: UiSectionId = opts.where === "remote" ? "remote" : opts.origin === "github" ? "github-launch" : "launcher";
  const command = enqueueUiCommand(section, {
    kind: "attach-session",
    sessionId: opts.id,
    where: opts.where,
    cwd: opts.cwd,
    cli: opts.cli,
    origin: opts.origin,
    projectName: opts.projectName,
  });
  return { section, commandId: command.id };
}

/** One window command for a whole Start-button batch, so none of the panes is dropped. */
export function showSessions(opts: {
  where?: "remote";
  origin?: "github";
  sessions: { id: string; cwd: string; cli: string; projectName: string; prompt: string }[];
}): { section: UiSectionId; commandId: number } {
  const section: UiSectionId = opts.where === "remote" ? "remote" : opts.origin === "github" ? "github-launch" : "launcher";
  const command = enqueueUiCommand(section, {
    kind: "attach-sessions",
    sessions: opts.sessions.map((row) => ({
      sessionId: row.id,
      where: opts.where,
      cwd: row.cwd,
      cli: row.cli,
      origin: opts.origin,
      projectName: row.projectName,
      prompt: row.prompt,
    })),
  });
  return { section, commandId: command.id };
}

export function projectBasename(cwd: string): string {
  const name = path.basename(cwd.replace(/[\\/]+$/, ""));
  return name || cwd;
}
