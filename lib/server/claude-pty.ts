import { WebSocket } from "ws";
import * as pty from "node-pty";
import os from "node:os";
import { resolveClaudeBin } from "./claude-runner";
import { normalizeModel, normalizeEffort } from "../launcher-config";
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
  origin?: "github";
  repoFullName?: string;
  projectName: string;
  batchId: string;
  startedAt: number;
}

interface PtySession {
  id: string;
  term: pty.IPty;
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

export function handleClaudePty(ws: WebSocket, url: URL): void {
  const id =
    url.searchParams.get("id")?.trim() ||
    `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  // Reconnect to a still-running (or finished) session: attach + replay.
  const existing = SESSIONS.get(id);
  if (existing) {
    attach(existing, ws);
    return;
  }

  const cwd = url.searchParams.get("cwd")?.trim() || os.homedir();
  const prompt = url.searchParams.get("prompt") ?? "";
  const model = normalizeModel(url.searchParams.get("model"));
  const effort = normalizeEffort(url.searchParams.get("effort"));
  const cols = Number(url.searchParams.get("cols")) || 80;
  const rows = Number(url.searchParams.get("rows")) || 24;
  const origin =
    url.searchParams.get("origin") === "github" ? "github" : undefined;
  const repoFullName = url.searchParams.get("repoFullName") ?? undefined;
  const projectName = url.searchParams.get("projectName") ?? "";
  const batchId = url.searchParams.get("batchId") ?? "";

  const send = (obj: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };

  const block = isBlocked(getUsage(), Date.now());
  if (block.blocked) {
    const until = block.until ? new Date(block.until).toLocaleString("de-DE") : "?";
    send({
      t: "out",
      d: `\r\n\x1b[31m[Claude-Limit erreicht — nicht verfügbar bis ${until}]\x1b[0m\r\n`,
    });
    send({ t: "exit", code: 1 });
    ws.close();
    return;
  }

  // Options first, positional prompt last (claude [options] [prompt]).
  const args: string[] = ["--dangerously-skip-permissions"];
  if (model) args.push("--model", model);
  if (effort) args.push("--effort", effort);
  if (prompt) args.push(prompt);

  let term: pty.IPty;
  try {
    term = pty.spawn(resolveClaudeBin(), args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: process.env as Record<string, string>,
    });
  } catch (err) {
    send({
      t: "out",
      d: `\r\n\x1b[31m[failed to start claude: ${(err as Error).message}]\x1b[0m\r\n`,
    });
    ws.close();
    return;
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
      origin,
      repoFullName,
      projectName,
      batchId,
      startedAt: Date.now(),
    },
    clients: new Set(),
  };
  SESSIONS.set(id, session);

  term.onData((d) => {
    session.buffer += d;
    if (session.buffer.length > BUFFER_CAP)
      session.buffer = session.buffer.slice(-BUFFER_CAP);
    session.lastDataAt = Date.now();
    broadcast(session, { t: "out", d });
  });

  term.onExit(({ exitCode }) => {
    session.status = exitCode === 0 ? "done" : "error";
    session.exitCode = exitCode;
    broadcast(session, { t: "exit", code: exitCode });
  });

  attach(session, ws);
}
