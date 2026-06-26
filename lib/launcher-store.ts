import { readJson, writeJson } from "./store";

/** Persisted Claude Code launcher history (.data/launcher.json). */

export interface LauncherSession {
  id: string;
  projectPath: string;
  projectName: string;
  prompt: string;
  status: "running" | "done" | "error" | "stopped";
  startedAt: number;
  endedAt?: number;
  exitCode?: number;
  result?: string;
  costUsd?: number;
  numTurns?: number;
  origin?: "github";
  repoFullName?: string;
}

interface LauncherFile {
  sessions: LauncherSession[];
}

const FILE = "launcher.json";
const MAX_HISTORY = 100;

export function listLauncherSessions(): LauncherSession[] {
  return readJson<LauncherFile>(FILE, { sessions: [] }).sessions.sort(
    (a, b) => b.startedAt - a.startedAt,
  );
}

export function saveLauncherSession(session: LauncherSession): void {
  const file = readJson<LauncherFile>(FILE, { sessions: [] });
  const idx = file.sessions.findIndex((s) => s.id === session.id);
  if (idx >= 0) file.sessions[idx] = session;
  else file.sessions.unshift(session);
  file.sessions = file.sessions
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, MAX_HISTORY);
  writeJson(FILE, file);
}

export function deleteLauncherSession(id: string): void {
  const file = readJson<LauncherFile>(FILE, { sessions: [] });
  file.sessions = file.sessions.filter((s) => s.id !== id);
  writeJson(FILE, file);
}
