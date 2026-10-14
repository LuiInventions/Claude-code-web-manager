import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../../../config";
import { readSettings } from "../../../settings";
import { enqueueUiCommand } from "../../ui-commands";
import { cloneRecord } from "./github";
import { filesRead, filesWrite } from "./files";
import { sessionStartMany } from "./sessions";
import { settingsUpdate } from "./settings";
import { rememberedRepo, rememberRepo } from "../selection";
import { queueCopy, queueReload } from "./ui";
import {
  existingDir,
  resolveUnder,
  searchTree,
  uploadLocalImages,
  uploadLocalTree,
} from "./transfer";
import { ActionError } from "../errors";

function selectedLocalPath(): string {
  const selected = readSettings().launcherLocalPath?.trim() || "";
  return selected || getConfig().projectsDir;
}

/** The Local Ordner. Falls back to the projects folder until one is selected. */
export function localGetPath() {
  const projectsDir = getConfig().projectsDir;
  const selected = readSettings().launcherLocalPath?.trim() || "";
  return {
    path: selected || projectsDir,
    projectsDir,
    selected: Boolean(selected),
    note: selected
      ? "This is the Local Ordner. local_session_start, local_search, and the local file tools use it."
      : "No Local folder is selected yet. path is the projects folder. Call local_select_path to choose the Ordner.",
  };
}

/** Remember a folder as the Local Ordner and show it in the Local tab. Does not start a CLI. */
export async function localSelectPath(dir: string) {
  const root = await existingDir(dir);
  settingsUpdate({ launcherLocalPath: root });
  const command = enqueueUiCommand("launcher", {
    projectPath: root,
    projectName: path.basename(root),
    prompt: "",
  });
  return {
    path: root,
    ui: { section: "launcher", commandId: command.id },
    note: "The Local tab shows this folder. Call local_session_start to open 1 to 6 sessions here.",
  };
}

/** Change the projects folder in Settings. This is not the Local Ordner. */
export async function localSetProjectsDir(dir: string) {
  const root = await existingDir(dir);
  settingsUpdate({ projectsDir: root });
  return {
    projectsDir: root,
    note: "The Settings projects folder is updated. The Local Ordner stays until local_select_path.",
  };
}

function localRoot(sub?: string): string {
  return resolveUnder(selectedLocalPath(), sub ?? "");
}

async function requireLocalDir(sub?: string): Promise<string> {
  return existingDir(localRoot(sub));
}

/** Start 1 to 6 CLI sessions in the selected Local folder, or in a subfolder of it. */
export async function localSessionStart(input: {
  path?: string;
  count?: number;
  prompt?: string;
  model?: string;
  effort?: string;
}) {
  const cwd = await requireLocalDir(input.path);
  return sessionStartMany({
    where: "local",
    cwd,
    count: input.count,
    prompt: input.prompt,
    model: input.model,
    effort: input.effort,
    projectName: path.basename(cwd),
  });
}

export async function localSearch(query: string, sub?: string) {
  return searchTree(await requireLocalDir(sub), query);
}

export async function localReadFile(filePath: string) {
  const target = resolveUnder(selectedLocalPath(), filePath);
  return filesRead(target);
}

export async function localSaveFile(filePath: string, content: string) {
  const target = resolveUnder(selectedLocalPath(), filePath);
  let st: fs.Stats | null = null;
  try {
    st = await fs.promises.stat(target);
  } catch {
    st = null;
  }
  if (st?.isDirectory()) throw new ActionError("path is a folder. Pass a file path and the full new contents.");
  return filesWrite(target, content);
}

export function localCopyPath(filePath?: string) {
  const target = filePath?.trim() ? resolveUnder(selectedLocalPath(), filePath) : path.resolve(selectedLocalPath());
  return queueCopy("launcher", target);
}

export async function localUpload(dir: string | undefined, sources: string[]) {
  const root = await requireLocalDir(dir);
  const saved = await uploadLocalTree(root, sources);
  const reload = queueReload("launcher");
  return { ...saved, ui: { commandId: reload } };
}

export async function localUploadImages(dir: string | undefined, sources: string[], folder?: string) {
  const root = await requireLocalDir(dir);
  const saved = await uploadLocalImages(root, sources, folder);
  queueReload("launcher");
  return saved;
}

function activeClone(fullName?: string) {
  if (fullName?.trim()) return cloneRecord(fullName);
  const repo = rememberedRepo();
  if (!repo) {
    throw new ActionError("No cloned repo is selected. Call github_select_repo, or pass fullName.");
  }
  if (!fs.existsSync(repo.localPath)) {
    throw new ActionError(`Clone is missing: ${repo.localPath}. Call github_refresh.`);
  }
  return repo;
}

/** Start 1 to 6 CLI sessions in the selected clone. */
export async function githubSessionStart(input: {
  fullName?: string;
  count?: number;
  prompt?: string;
  model?: string;
  effort?: string;
}) {
  const repo = input.fullName?.trim() ? cloneRecord(input.fullName) : activeClone();
  if (input.fullName?.trim()) rememberRepo(repo);
  const cwd = await existingDir(repo.localPath);
  return sessionStartMany({
    where: "local",
    cwd,
    count: input.count,
    prompt: input.prompt,
    model: input.model,
    effort: input.effort,
    origin: "github",
    repoFullName: repo.fullName,
    projectName: repo.name,
  });
}

export async function githubSearch(query: string, fullName?: string, sub?: string) {
  const repo = activeClone(fullName);
  const root = await existingDir(resolveUnder(repo.localPath, sub ?? ""));
  return { fullName: repo.fullName, ...(await searchTree(root, query)) };
}

export async function githubReadFile(filePath: string, fullName?: string) {
  const repo = activeClone(fullName);
  return filesRead(resolveUnder(repo.localPath, filePath));
}

export async function githubSaveFile(filePath: string, content: string, fullName?: string) {
  const repo = activeClone(fullName);
  const target = resolveUnder(repo.localPath, filePath);
  let st: fs.Stats | null = null;
  try {
    st = await fs.promises.stat(target);
  } catch {
    st = null;
  }
  if (st?.isDirectory()) throw new ActionError("path is a folder. Pass a file path and the full new contents.");
  return filesWrite(target, content);
}

export function githubCopyPath(filePath?: string, fullName?: string) {
  const repo = activeClone(fullName);
  const target = filePath?.trim() ? resolveUnder(repo.localPath, filePath) : repo.localPath;
  return queueCopy("github-launch", target);
}

export async function githubUpload(sources: string[], dir?: string, fullName?: string) {
  const repo = activeClone(fullName);
  const root = await existingDir(resolveUnder(repo.localPath, dir ?? ""));
  const saved = await uploadLocalTree(root, sources);
  const reload = queueReload("github-launch");
  return { fullName: repo.fullName, ...saved, ui: { commandId: reload } };
}

export async function githubUploadImages(sources: string[], dir?: string, folder?: string, fullName?: string) {
  const repo = activeClone(fullName);
  const root = await existingDir(resolveUnder(repo.localPath, dir ?? ""));
  const saved = await uploadLocalImages(root, sources, folder);
  queueReload("github-launch");
  return { fullName: repo.fullName, ...saved };
}

