import { WebSocket } from "ws";
import * as pty from "node-pty";
import os from "node:os";
import { resolveClaudeBin } from "./claude-runner";
import { getConfig } from "../config";
import {
  buildInteractiveArgs,
  getCodeCli,
  isCodeCliId,
  normalizeCliOption,
  spawnEnv,
  type CodeCliId,
} from "../code-clis";
import { resolveCliBin } from "./cli-bin";
import { silenceGrokPluginHooks } from "./grok-hooks";
import { buildRemoteCliCommand } from "../remote-ssh";
import { openRemoteCli } from "./remote-broker";
import { remoteBrokerPort } from "./remote-session";
import { getUsage, isBlocked } from "../usage-store";
import {
  tailText,
  type ConsoleSummary,
  type ConsoleSnapshot,
} from "../console-read";
import {
  detectActivity,
  type LiveActivity,
  type DetectedSubagent,
  type ToolKind,
} from "../session-activity";
import type { SessionOutput } from "../session-review";

/**
 * Backend for /ws/claude-pty — the launcher's interactive Claude sessions.
 *
 * Sessions live SERVER-SIDE in a registry, decoupled from the WebSocket: a PTY
 * keeps running across page refreshes / reconnects / tab switches and is only
 * killed by an explicit stop (killPtySession, via the live-sessions API). On
 * (re)connect the client gets the full scrollback replayed so the terminal
 * looks unchanged after a refresh. The registry is in-memory, so sessions live
 * until the server (PC) is shut down.
 *
 *   client -> server : { t: "in", d } | { t: "resize", c, r }
 *   server -> client : { t: "out", d } | { t: "exit", code }
 */

type ClientMsg =
  | { t: "in"; d: string }
  | { t: "resize"; c: number; r: number };

export interface PtyMeta {
  cwd: string;
  prompt: string;
  model: string;
  effort: string;
  /** Coding CLI that owns this PTY. */
  cli: CodeCliId;
  /** Set when the CLI runs over ssh on the user's server. */
  where?: "remote";
  origin?: "github";
  repoFullName?: string;
  projectName: string;
  batchId: string;
  startedAt: number;
}

interface TermHandle {
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  resize(columns: number, rows: number): void;
  kill(signal?: string): void;
}

interface PtySession {
  id: string;
  term: TermHandle;
  buffer: string;
  status: "running" | "done" | "error";
  exitCode?: number;
  /** ms timestamp of the last byte received — feeds the idle/activity heuristic. */
  lastDataAt: number;
  meta: PtyMeta;
  clients: Set<WebSocket>;
}

// The registry MUST be a single process-wide instance: in dev (and with the
// custom server) the WS handler and the Next API routes load this module in
// separate module graphs, so a plain module-level Map would not be shared.
// Pinning it to globalThis gives both one and the same registry.
const g = globalThis as unknown as {
  __claudePtySessions?: Map<string, PtySession>;
};
const SESSIONS: Map<string, PtySession> = (g.__claudePtySessions ??= new Map());
const BUFFER_CAP = 200_000; // scrollback bytes kept per session for replay

export interface PtySessionInfo extends PtyMeta {
  id: string;
  status: "running" | "done" | "error";
  exitCode?: number;
  /** Live activity derived from the output tail (thinking/working/waiting/…). */
  activity: LiveActivity;
  /** Coarse category of the tool currently running (running sessions only). */
  tool?: ToolKind;
  /** Short target of that tool: file basename / search pattern / command / host. */
  detail?: string;
  /** In-session subagents (Task tool) detected in the output. */
  subagents: DetectedSubagent[];
  /** ms timestamp of the last output byte (for the idle heuristic on the client). */
  lastActivityAt: number;
}

/** Live sessions, newest first — lets the launcher re-list after a refresh. */
export function listPtySessions(): PtySessionInfo[] {
  const now = Date.now();
  return Array.from(SESSIONS.values())
    .map((s) => {
      const { activity, subagents, tool, detail } = detectActivity({
        tail: tailText(s.buffer),
        status: s.status,
        lastDataAtMs: s.lastDataAt,
        now,
      });
      return {
        id: s.id,
        status: s.status,
        exitCode: s.exitCode,
        activity,
        tool,
        detail,
        subagents,
        lastActivityAt: s.lastDataAt,
        ...s.meta,
      };
    })
    .sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Readable output snapshot of live consoles, for the Session-Review. Returns one
 * SessionOutput per session with the scrollback turned into a compact plain-text
 * tail (ANSI/spinners stripped). With `ids`, only those sessions are returned, in
 * the given order (so the report can follow the UI's #1..#N numbering); without
 * `ids`, all sessions are returned. Read-only — never touches the PTY.
 */
export function snapshotPtySessions(ids?: string[]): SessionOutput[] {
  const pick: PtySession[] = ids
    ? ids
        .map((id) => SESSIONS.get(id))
        .filter((s): s is PtySession => s !== undefined)
    : Array.from(SESSIONS.values());
  return pick.map((s) => ({
    id: s.id,
    projectName:
      s.meta.projectName ||
      s.meta.cwd.split(/[\\/]/).filter(Boolean).pop() ||
      "",
    status: s.status,
    prompt: s.meta.prompt,
    output: tailText(s.buffer),
  }));
}

/** Explicitly stop + forget a session — the ONLY thing that kills a PTY. */
export function killPtySession(id: string): boolean {
  const s = SESSIONS.get(id);
  if (!s) return false;
  try {
    s.term.kill();
  } catch {
    /* already gone */
  }
  for (const ws of s.clients) {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    } catch {
      /* noop */
    }
  }
  SESSIONS.delete(id);
  return true;
}

function broadcast(s: PtySession, obj: unknown): void {
  const data = JSON.stringify(obj);
  for (const ws of s.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

/** Attach a (re)connecting socket: replay scrollback, then stream live. */
function attach(s: PtySession, ws: WebSocket): void {
  s.clients.add(ws);
  const send = (obj: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };
  if (s.buffer) send({ t: "out", d: s.buffer });
  if (s.status !== "running") send({ t: "exit", code: s.exitCode ?? 0 });

  ws.on("message", (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.t === "in") {
      s.term.write(msg.d);
    } else if (msg.t === "resize") {
      try {
        s.term.resize(Math.max(1, msg.c | 0), Math.max(1, msg.r | 0));
      } catch {
        /* ignore transient resize errors */
      }
    }
  });

  // Detach only — never kill the PTY on socket close (survives refresh).
  const detach = () => s.clients.delete(ws);
  ws.on("close", detach);
  ws.on("error", detach);
}

export interface OpenPtyInput {
  id?: string;
  where?: "local" | "remote";
  cwd?: string;
  prompt?: string;
  /** Remote sessions pick the CLI here. Local sessions keep Settings. */
  cli?: string | null;
  model?: string | null;
  effort?: string | null;
  cols?: number;
  rows?: number;
  origin?: "github";
  repoFullName?: string;
  projectName?: string;
  batchId?: string;
  startedAt?: number;
}

export type OpenPtyResult =
  | { ok: true; id: string; reused: boolean }
  | { ok: false; error: string; /** When false, the socket closes without an exit frame. */ exit: boolean };

/**
 * Start a code-CLI PTY, or return the existing one when `id` is already live.
 * The websocket handler and the MCP server both use this so a pane can attach
 * to a session the model already started.
 */
export function openPtySession(input: OpenPtyInput): OpenPtyResult {
  const id =
    input.id?.trim() ||
    `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  if (SESSIONS.has(id)) return { ok: true, id, reused: true };

  const where = input.where === "remote" ? "remote" : "local";
  const cwd = input.cwd?.trim() || (where === "remote" ? "~" : os.homedir());
  const prompt = input.prompt ?? "";
  // Locally the Settings choice is the source of truth. A remote session names
  // the CLI itself, because Remote can start Claude, Grok, or Codex on the
  // server independently of that setting.
  const requested = input.cli;
  const cli =
    where === "remote" && isCodeCliId(requested) ? requested : getConfig().codeCli;
  const model = normalizeCliOption(cli, "model", input.model);
  const effort = normalizeCliOption(cli, "effort", input.effort);
  const cols = Number(input.cols) || 80;
  const rows = Number(input.rows) || 24;
  const origin = input.origin === "github" ? "github" : undefined;
  const repoFullName = input.repoFullName;
  const projectName = input.projectName ?? "";
  const batchId = input.batchId ?? "";
  const startedAtParam = Number(input.startedAt);
  const startedAt =
    Number.isFinite(startedAtParam) && startedAtParam > 0 ? startedAtParam : Date.now();

  // The local usage limit is Claude-only. A Claude process on the user's server
  // has its own login, and Grok and Codex are never blocked by it.
  if (cli === "claude" && where !== "remote") {
    const block = isBlocked(getUsage(), Date.now());
    if (block.blocked) {
      const until = block.until ? new Date(block.until).toLocaleString("de-DE") : "?";
      return {
        ok: false,
        error: `Claude-Limit erreicht — nicht verfügbar bis ${until}`,
        exit: true,
      };
    }
  }

  const args = buildInteractiveArgs(cli, { prompt, model, effort });
  const spec = getCodeCli(cli);
  let term: TermHandle;
  if (where === "remote") {
    const port = remoteBrokerPort();
    if (!port) return { ok: false, error: "Nicht mit dem Server verbunden.", exit: true };
    term = openRemoteCli({
      port,
      command: buildRemoteCliCommand({ cwd, bin: spec.bin, args, cli }),
      cols,
      rows,
    });
  } else {
    const bin = cli === "claude" ? resolveClaudeBin() : resolveCliBin(spec.bin) ?? spec.bin;
    const env = spawnEnv(cli) as Record<string, string>;
    if (cli === "grok") silenceGrokPluginHooks(cwd);
    try {
      term = pty.spawn(bin, args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env,
      });
    } catch (err) {
      return {
        ok: false,
        error: `failed to start ${spec.bin}: ${(err as Error).message}`,
        exit: false,
      };
    }
  }

  const session: PtySession = {
    id,
    term,
    buffer: "",
    status: "running",
    lastDataAt: Date.now(),
    meta: {
      cwd,
      prompt,
      model: model ?? "",
      effort: effort ?? "",
      cli,
      ...(where === "remote" ? { where: "remote" as const } : {}),
      origin,
      repoFullName,
      projectName,
      batchId,
      startedAt,
    },
    clients: new Set(),
  };
  SESSIONS.set(id, session);
  wireTerm(session, term);
  return { ok: true, id, reused: false };
}

function wireTerm(session: PtySession, term: TermHandle): void {
  // Grok and Claude redraw in small chunks. Forwarding each one as its own
  // websocket message makes xterm repaint dozens of times a second and the
  // window hitches. One flush per frame keeps the session live.
  let pendingOut = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flushOut = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!pendingOut) return;
    const chunk = pendingOut;
    pendingOut = "";
    broadcast(session, { t: "out", d: chunk });
  };
  term.onData((d) => {
    session.buffer += d;
    if (session.buffer.length > BUFFER_CAP)
      session.buffer = session.buffer.slice(-BUFFER_CAP);
    session.lastDataAt = Date.now();
    pendingOut += d;
    if (!flushTimer) {
      flushTimer = setTimeout(flushOut, 20);
      flushTimer.unref?.();
    }
  });

  term.onExit(({ exitCode }) => {
    flushOut();
    session.status = exitCode === 0 ? "done" : "error";
    session.exitCode = exitCode;
    broadcast(session, { t: "exit", code: exitCode });
  });
}

/** Write raw bytes to a running PTY. Returns false when the session is gone or finished. */
export function writePtySession(id: string, data: string): boolean {
  const session = SESSIONS.get(id);
  if (!session || session.status !== "running") return false;
  session.term.write(data);
  return true;
}

/** Resize a running PTY. Returns false when the session is gone or finished. */
export function resizePtySession(id: string, cols: number, rows: number): boolean {
  const session = SESSIONS.get(id);
  if (!session || session.status !== "running") return false;
  try {
    session.term.resize(Math.max(1, cols | 0), Math.max(1, rows | 0));
    return true;
  } catch {
    return false;
  }
}

export function ptyBufferLength(id: string): number | null {
  const session = SESSIONS.get(id);
  return session ? session.buffer.length : null;
}

/**
 * Wait until the scrollback grows and then stays quiet, or until the process
 * exits or the timeout hits. Used after a prompt so the caller can read a
 * settled screen instead of a half-drawn frame.
 */
export async function waitForPtyGrowth(
  id: string,
  beforeLength: number,
  opts: { timeoutMs: number; quietMs: number },
): Promise<"settled" | "timeout" | "exited" | "missing"> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    const session = SESSIONS.get(id);
    if (!session) return "missing";
    if (session.status !== "running") return "exited";
    if (session.buffer.length > beforeLength && Date.now() - session.lastDataAt >= opts.quietMs) {
      return "settled";
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  const session = SESSIONS.get(id);
  if (!session) return "missing";
  if (session.status !== "running") return "exited";
  return "timeout";
}

/** Readable tail plus the same metadata `listPtySessions` exposes. */
export function readPtySession(
  id: string,
  maxChars = 8000,
): (PtySessionInfo & { output: string }) | null {
  const session = SESSIONS.get(id);
  if (!session) return null;
  const info = listPtySessions().find((row) => row.id === id);
  if (!info) return null;
  const cap = Math.max(200, Math.min(40_000, maxChars));
  return { ...info, output: tailText(session.buffer, 200, cap) };
}

export function handleClaudePty(ws: WebSocket, url: URL): void {
  const id =
    url.searchParams.get("id")?.trim() ||
    `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const send = (obj: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };

  // Reconnect to a still-running (or finished) session: attach + replay.
  const existing = SESSIONS.get(id);
  if (existing) {
    attach(existing, ws);
    return;
  }

  const opened = openPtySession({
    id,
    where: url.searchParams.get("where") === "remote" ? "remote" : "local",
    cwd: url.searchParams.get("cwd") ?? undefined,
    prompt: url.searchParams.get("prompt") ?? "",
    cli: url.searchParams.get("cli"),
    model: url.searchParams.get("model"),
    effort: url.searchParams.get("effort"),
    cols: Number(url.searchParams.get("cols")) || 80,
    rows: Number(url.searchParams.get("rows")) || 24,
    origin: url.searchParams.get("origin") === "github" ? "github" : undefined,
    repoFullName: url.searchParams.get("repoFullName") ?? undefined,
    projectName: url.searchParams.get("projectName") ?? "",
    batchId: url.searchParams.get("batchId") ?? "",
    startedAt: Number(url.searchParams.get("startedAt")),
  });
  if (!opened.ok) {
    send({
      t: "out",
      d: `\r\n\x1b[31m[${opened.error}]\x1b[0m\r\n`,
    });
    if (opened.exit) send({ t: "exit", code: 1 });
    ws.close();
    return;
  }
  const session = SESSIONS.get(opened.id);
  if (!session) {
    ws.close();
    return;
  }
  attach(session, ws);
}
