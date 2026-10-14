import path from "node:path";
import { getCodeCli, isCodeCliId, normalizeCliOption } from "../../../code-clis";
import { getConfig } from "../../../config";
import {
  deleteLauncherSession,
  listLauncherSessions,
} from "../../../launcher-store";
import {
  generateMarkdownReport,
  generateSpeechSummary,
  type ReviewItem,
} from "../../../session-review";
import { improvePrompt } from "../../../prompt-improver";
import { splitPrompt } from "../../../prompt-splitter";
import { friendlyAiError } from "../../../openai";
import {
  killPtySession,
  listPtySessions,
  openPtySession,
  ptyBufferLength,
  readPtySession,
  resizePtySession,
  waitForPtyGrowth,
  writePtySession,
} from "../../claude-pty";
import { enqueueUiCommand, type UiSectionId } from "../../ui-commands";
import { projectBasename, showSession, showSessions } from "./app";
import { ActionError, clipText } from "../errors";

const WRITE_CAP = 32_000;

function requireSession(id: string) {
  const row = readPtySession(id, 200);
  if (!row) throw new ActionError(`No session with id "${id}". Call session_list.`);
  return row;
}

function publicSession(row: ReturnType<typeof listPtySessions>[number]) {
  return {
    id: row.id,
    status: row.status,
    exitCode: row.exitCode ?? null,
    cli: row.cli,
    where: row.where ?? "local",
    cwd: row.cwd,
    projectName: row.projectName,
    prompt: row.prompt,
    model: row.model || null,
    effort: row.effort || null,
    origin: row.origin ?? null,
    repoFullName: row.repoFullName ?? null,
    activity: row.activity,
    tool: row.tool ?? null,
    detail: row.detail ?? null,
    subagents: row.subagents,
    startedAt: row.startedAt,
    lastActivityAt: row.lastActivityAt,
  };
}

/** Live PTY sessions, newest first. These keep running until session_stop. */
export function sessionList() {
  const sessions = listPtySessions().map(publicSession);
  return {
    sessions,
    hint: sessions.length
      ? "Read one with session_read. Send a follow-up with session_send. Stop one with session_stop."
      : "No live session. Start one with session_start.",
  };
}

export function sessionRead(id: string, maxChars?: number) {
  const cap = maxChars == null ? 8000 : maxChars;
  const row = readPtySession(id, cap);
  if (!row) throw new ActionError(`No session with id "${id}". Call session_list.`);
  return {
    ...publicSession(row),
    output: row.output,
    hint: row.status === "running"
      ? "output is the readable tail (ANSI stripped). If the CLI is still working, call session_read again."
      : "This session has exited. Its scrollback is still here until session_stop.",
  };
}

export type SessionArea = "github" | "local" | "remote";

const AREA_SECTION: Record<SessionArea, UiSectionId> = {
  github: "github-launch",
  local: "launcher",
  remote: "remote",
};

type ListedSession = ReturnType<typeof listPtySessions>[number];

function inArea(row: ListedSession, area: SessionArea): boolean {
  if (area === "remote") return row.where === "remote";
  if (row.where === "remote") return false;
  return area === "github" ? row.origin === "github" : row.origin !== "github";
}

/**
 * Running sessions in one launcher, oldest first.
 * Session 1 stays session 1 until it exits. A newer session gets the next number.
 */
export function activeSessions(area: SessionArea) {
  return listPtySessions()
    .filter((row) => row.status === "running" && inArea(row, area))
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
    .map((row, index) => ({
      number: index + 1,
      label: `session ${index + 1}`,
      ...publicSession(row),
    }));
}

export function listActiveSessions(area: SessionArea) {
  const sessions = activeSessions(area);
  return {
    area,
    sessions,
    hint: sessions.length
      ? "Session 1 is the oldest running session in this area. Read its command window with get_session_x_info."
      : `No running ${area} session.`,
  };
}

/** Command-window scrollback for session number x in one area. */
export function sessionInfoByNumber(area: SessionArea, x: number) {
  if (!Number.isInteger(x) || x < 1) {
    throw new ActionError("x is the session number from the matching list, starting at 1.");
  }
  const sessions = activeSessions(area);
  const hit = sessions.find((row) => row.number === x);
  if (!hit) {
    const span = sessions.length
      ? `Running numbers are 1 to ${sessions.length}.`
      : "That list is empty.";
    throw new ActionError(
      `No running ${area} session ${x}. ${span} Call list_active_${area}_sessions.`,
    );
  }
  const row = readPtySession(hit.id, 40_000);
  if (!row) {
    throw new ActionError(`Session ${x} disappeared. Call list_active_${area}_sessions.`);
  }
  const output = row.output;
  let copied = false;
  let commandId: number | null = null;
  if (output.trim()) {
    const command = enqueueUiCommand(AREA_SECTION[area], { kind: "copy-text", text: output });
    copied = true;
    commandId = command.id;
  }
  return {
    area,
    number: x,
    label: `session ${x}`,
    ...publicSession(row),
    output,
    copied,
    commandId,
    hint: copied
      ? "output is the command-window scrollback with ANSI stripped. The open window copies that text."
      : "output is the command-window scrollback with ANSI stripped. It was empty, so nothing was copied.",
  };
}

export interface SessionStartInput {
  cwd?: string;
  prompt?: string;
  where?: "local" | "remote";
  cli?: string;
  model?: string;
  effort?: string;
  origin?: "github" | "local";
  repoFullName?: string;
  projectName?: string;
  cols?: number;
  rows?: number;
}

/** Launcher grids open 1 to 6 sessions from one Start click. */
export function sessionCount(value: number | undefined): number {
  if (value == null) return 1;
  if (!Number.isInteger(value) || value < 1 || value > 6) {
    throw new ActionError("count must be an integer from 1 to 6.");
  }
  return value;
}

interface PreparedSession {
  where: "local" | "remote";
  cliId: string;
  cwd: string;
  prompt: string;
  origin: "github" | undefined;
  repoFullName?: string;
  projectName: string;
  model?: string;
  effort?: string;
  cols: number;
  rows: number;
}

function prepareSession(input: SessionStartInput): PreparedSession {
  const where = input.where === "remote" ? "remote" : "local";
  const cliId = where === "remote" ? input.cli?.trim() || getConfig().codeCli : getConfig().codeCli;
  if (!isCodeCliId(cliId)) {
    throw new ActionError(`Unknown code CLI "${input.cli}". Use claude, grok, or codex.`);
  }
  const spec = getCodeCli(cliId);
  if (input.model && !normalizeCliOption(cliId, "model", input.model)) {
    const allowed = spec.models.filter((m) => m.value).map((m) => m.value);
    throw new ActionError(
      `Model "${input.model}" is not a ${spec.label} flag. Use one of: ${allowed.join(", ") || "(none)"}, or omit model.`,
    );
  }
  if (input.effort && !normalizeCliOption(cliId, "effort", input.effort)) {
    const allowed = spec.efforts.filter((m) => m.value).map((m) => m.value);
    throw new ActionError(
      `Effort "${input.effort}" is not a ${spec.label} flag. Use one of: ${allowed.join(", ") || "(none)"}, or omit effort.`,
    );
  }

  const cwd = input.cwd?.trim() || (where === "remote" ? "~" : "");
  if (where === "local" && !cwd) {
    throw new ActionError("cwd is required for a local session. Pass an absolute folder on this PC.");
  }
  const prompt = input.prompt ?? "";
  const origin = input.origin === "github" ? "github" : undefined;
  return {
    where,
    cliId,
    cwd,
    prompt,
    origin,
    repoFullName: input.repoFullName,
    projectName: input.projectName?.trim() || projectBasename(cwd),
    model: input.model,
    effort: input.effort,
    cols: input.cols || 100,
    rows: input.rows || 32,
  };
}

function openPrepared(prep: PreparedSession, id: string | undefined, batchId: string, startedAt?: number) {
  const opened = openPtySession({
    id,
    where: prep.where,
    cwd: prep.cwd,
    prompt: prep.prompt,
    cli: prep.cliId,
    model: prep.model,
    effort: prep.effort,
    cols: prep.cols,
    rows: prep.rows,
    origin: prep.origin,
    repoFullName: prep.repoFullName,
    projectName: prep.projectName,
    batchId,
    startedAt,
  });
  if (!opened.ok) throw new ActionError(opened.error);
  const info = listPtySessions().find((row) => row.id === opened.id);
  return {
    id: opened.id,
    reused: opened.reused,
    cli: prep.cliId,
    where: prep.where,
    cwd: info?.cwd || prep.cwd,
    projectName: prep.projectName,
    model: info?.model || null,
    effort: info?.effort || null,
    prompt: prep.prompt,
  };
}

const SESSION_NEXT = (prompt: string) =>
  prompt
    ? "The prompt was passed as the CLI's opening argument. Read one with session_read. Send a later message with session_send."
    : "The CLI is open with no opening prompt. Send the task with session_send.";

/**
 * Start Claude Code, Grok, or Codex. Local sessions use the CLI from Settings.
 * Remote sessions use `cli` and need an SSH connection that is already up.
 */
export function sessionStart(input: SessionStartInput) {
  const prep = prepareSession(input);
  const opened = openPrepared(prep, undefined, "");
  const ui = showSession({
    id: opened.id,
    where: prep.where === "remote" ? "remote" : undefined,
    cwd: opened.cwd,
    cli: prep.cliId,
    origin: prep.origin,
    projectName: prep.projectName,
  });
  return { ...opened, ui, next: SESSION_NEXT(prep.prompt) };
}

/**
 * Start 1 to 6 sessions in one batch, the same way the Start button does.
 * A failure rolls back any session this call already opened.
 */
export function sessionStartMany(input: SessionStartInput & { count?: number }) {
  const count = sessionCount(input.count);
  const prep = prepareSession(input);
  const stamp = Date.now().toString(36);
  const prefix = prep.where === "remote" ? "r" : "c";
  const batchId = `b_${stamp}${Math.random().toString(36).slice(2, 5)}`;
  const startedAt = Date.now();
  const opened: ReturnType<typeof openPrepared>[] = [];
  try {
    for (let i = 0; i < count; i++) {
      opened.push(openPrepared(prep, `${prefix}_${stamp}_${i}`, batchId, startedAt + i));
    }
  } catch (err) {
    for (const row of opened) killPtySession(row.id);
    throw err;
  }
  const ui = showSessions({
    where: prep.where === "remote" ? "remote" : undefined,
    origin: prep.origin,
    sessions: opened.map((row) => ({
      id: row.id,
      cwd: row.cwd,
      cli: row.cli,
      projectName: row.projectName,
      prompt: row.prompt,
    })),
  });
  return {
    count: opened.length,
    batchId,
    cli: prep.cliId,
    where: prep.where,
    cwd: prep.cwd,
    sessions: opened,
    ui,
    next: SESSION_NEXT(prep.prompt),
  };
}

export async function sessionSend(input: {
  id: string;
  text?: string;
  submit?: boolean;
  waitMs?: number;
  quietMs?: number;
  maxChars?: number;
}) {
  requireSession(input.id);
  const text = input.text ?? "";
  if (text.length > WRITE_CAP) {
    throw new ActionError(`text is ${text.length} characters. The limit is ${WRITE_CAP}.`);
  }
  const submit = input.submit !== false;
  let data = text;
  if (submit && !data.endsWith("\r") && !data.endsWith("\n")) data += "\r";
  const before = ptyBufferLength(input.id);
  if (before == null) throw new ActionError(`No session with id "${input.id}". Call session_list.`);
  if (!writePtySession(input.id, data)) {
    throw new ActionError(`Session "${input.id}" is not running. Read it with session_read, or start another.`);
  }
  const waitMs = Math.max(200, Math.min(30_000, input.waitMs ?? 8000));
  const quietMs = Math.max(100, Math.min(5_000, input.quietMs ?? 600));
  const settle = await waitForPtyGrowth(input.id, before, { timeoutMs: waitMs, quietMs });
  const row = readPtySession(input.id, input.maxChars ?? 8000);
  return {
    id: input.id,
    wrote: data.length,
    submit,
    settle,
    session: row ? publicSession(row) : null,
    output: row?.output ?? "",
    hint: settle === "timeout"
      ? "The CLI was still printing when the wait ended. Call session_read again before sending more."
      : "output is the readable tail after this write.",
  };
}

/** Raw keystrokes. Use this for Ctrl+C (`\\u0003`), arrows, or text that must not gain an Enter. */
export function sessionWrite(id: string, text: string) {
  if (text.length > WRITE_CAP) {
    throw new ActionError(`text is ${text.length} characters. The limit is ${WRITE_CAP}.`);
  }
  requireSession(id);
  if (!writePtySession(id, text)) {
    throw new ActionError(`Session "${id}" is not running.`);
  }
  return { id, wrote: text.length };
}

export function sessionResize(id: string, cols: number, rows: number) {
  requireSession(id);
  if (!resizePtySession(id, cols, rows)) throw new ActionError(`Session "${id}" is not running.`);
  return { id, cols: Math.max(1, cols | 0), rows: Math.max(1, rows | 0) };
}

/** Kill the PTY. This is permanent. The office and the launcher drop it. */
export function sessionStop(id: string) {
  const existed = listPtySessions().some((row) => row.id === id);
  if (!existed) throw new ActionError(`No session with id "${id}".`);
  const killed = killPtySession(id);
  return { id, stopped: killed };
}

export function sessionHistory() {
  return {
    sessions: listLauncherSessions().map((s) => ({
      id: s.id,
      projectPath: s.projectPath,
      projectName: s.projectName,
      prompt: s.prompt,
      status: s.status,
      startedAt: s.startedAt,
      endedAt: s.endedAt ?? null,
      exitCode: s.exitCode ?? null,
      origin: s.origin ?? null,
      repoFullName: s.repoFullName ?? null,
    })),
    note: "This is the saved launcher history, not the live PTYs. Live ones are session_list.",
  };
}

export function sessionHistoryDelete(id: string) {
  deleteLauncherSession(id);
  return { id, deleted: true };
}

export async function sessionReview(ids?: string[]) {
  const live = listPtySessions();
  const picked = ids?.length
    ? ids.map((id) => live.find((row) => row.id === id)).filter((row) => row != null)
    : live;
  if (ids?.length && picked.length !== ids.length) {
    const missing = ids.filter((id) => !live.some((row) => row.id === id));
    throw new ActionError(`Unknown session id: ${missing.join(", ")}.`);
  }
  const items: ReviewItem[] = picked.map((row, index) => {
    const snap = readPtySession(row.id, 4000);
    return {
      id: row.id,
      number: index + 1,
      projectName: row.projectName || path.basename(row.cwd),
      status: row.status,
      prompt: row.prompt,
      output: snap?.output ?? "",
    };
  });
  try {
    const [markdown, speech] = await Promise.all([
      generateMarkdownReport(items),
      generateSpeechSummary(items),
    ]);
    return { sessions: items.length, markdown, speech };
  } catch (err) {
    throw new ActionError(friendlyAiError(err));
  }
}

export async function promptImprove(projectPath: string, prompt: string) {
  try {
    const improvedPrompt = await improvePrompt(projectPath, prompt);
    const clipped = clipText(improvedPrompt, 20_000);
    return { improvedPrompt: clipped.text, truncated: clipped.truncated };
  } catch (err) {
    throw new ActionError(friendlyAiError(err));
  }
}

export async function promptSplit(projectPath: string, prompt: string) {
  try {
    const sessions = await splitPrompt(projectPath, prompt);
    return {
      sessions,
      hint: "Start each prompt with its own session_start. They do not start by themselves.",
    };
  } catch (err) {
    throw new ActionError(err instanceof Error ? err.message : String(err));
  }
}
