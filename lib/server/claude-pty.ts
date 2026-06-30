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
  /**
   * Warm-pool flag. A pooled session is a pre-spawned `claude` for a folder the
   * user selected in the Launcher — booted and waiting, but NOT yet opened. It is
   * hidden from {@link listPtySessions} (so it never appears in the Launcher's
   * restore list or as a character in the Sessions office) until it is claimed by
   * an actual "open" (see {@link claimFromPool}), which flips this to false.
   */
  pooled: boolean;
}

// The registry MUST be a single process-wide instance: in dev (and with the
// custom server) the WS handler and the Next API routes load this module in
// separate module graphs, so a plain module-level Map would not be shared.
// Pinning it to globalThis gives both one and the same registry.
const g = globalThis as unknown as {
  __claudePtySessions?: Map<string, PtySession>;
  __claudePoolReaper?: ReturnType<typeof setInterval>;
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
    // Warm-pool sessions are pre-spawned but not yet opened — never list them
    // (no Launcher restore entry, no Sessions-office character) until claimed.
    .filter((s) => !s.pooled)
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
    : Array.from(SESSIONS.values()).filter((s) => !s.pooled);
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

interface CreatePtyOpts {
  id: string;
  cwd: string;
  prompt: string;
  model: string;
  effort: string;
  cols: number;
  rows: number;
  projectName: string;
  batchId: string;
  startedAt: number;
  origin?: "github";
  repoFullName?: string;
  /** Warm-pool session: pre-spawned and hidden until claimed. */
  pooled: boolean;
}

/**
 * Spawn a Claude PTY and register it (no WebSocket attached yet). Shared by the
 * live WS handler (pooled:false, prompt passed as a spawn arg) and the warm pool
 * (pooled:true, no prompt — Claude boots to its interactive box and the prompt is
 * injected later, on claim). Throws if Claude can't be spawned.
 */
function createPtySession(o: CreatePtyOpts): PtySession {
  const args: string[] = ["--dangerously-skip-permissions"];
  if (o.model) args.push("--model", o.model);
  if (o.effort) args.push("--effort", o.effort);
  if (o.prompt) args.push(o.prompt);

  const term = pty.spawn(resolveClaudeBin(), args, {
    name: "xterm-256color",
    cols: o.cols,
    rows: o.rows,
    cwd: o.cwd,
    env: process.env as Record<string, string>,
  });

  const session: PtySession = {
    id: o.id,
    term,
    buffer: "",
    status: "running",
    lastDataAt: Date.now(),
    pooled: o.pooled,
    meta: {
      cwd: o.cwd,
      prompt: o.prompt,
      model: o.model,
      effort: o.effort,
      origin: o.origin,
      repoFullName: o.repoFullName,
      projectName: o.projectName,
      batchId: o.batchId,
      startedAt: o.startedAt,
    },
    clients: new Set(),
  };
  SESSIONS.set(o.id, session);

  term.onData((d) => {
    session.buffer += d;
    if (session.buffer.length > BUFFER_CAP) session.buffer = session.buffer.slice(-BUFFER_CAP);
    session.lastDataAt = Date.now();
    broadcast(session, { t: "out", d });
  });

  term.onExit(({ exitCode }) => {
    session.status = exitCode === 0 ? "done" : "error";
    session.exitCode = exitCode;
    broadcast(session, { t: "exit", code: exitCode });
  });

  return session;
}

// ── Warm pool ────────────────────────────────────────────────────────────────
// Pre-spawned Claude sessions keyed by the folder (+ model + effort) the user
// selected in the Launcher, so opening a session is instant. The pool is filled
// when the user picks a folder (preloadPool) and drained as sessions are opened
// (claimFromPool). Pooled sessions stay hidden (listPtySessions filters them) so
// they never show in the Launcher restore list or the Sessions office until
// claimed.

/** Per-selection pool size (matches the Launcher's max "boxes"). */
const POOL_SIZE = 6;

function poolKey(cwd: string, model: string, effort: string): string {
  return `${cwd} ${model} ${effort}`;
}

function genSessionId(): string {
  return `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Submit `text` into a freshly-claimed pooled session once Claude's interactive
 * input box is up (it boots in ~1–2s). Polls the scrollback for the box border;
 * after ~10s it sends anyway so a missed heuristic never strands a live session.
 * If Claude has already exited (a rare crash between claim and ready) there is
 * nothing to inject — the box simply shows as ended via its normal exit status.
 */
function injectWhenReady(s: PtySession, text: string, attempt = 0): void {
  if (s.status !== "running") return;
  const ready = /[╭╰]/.test(s.buffer) || /\n\s*>\s/.test(s.buffer);
  if (ready || attempt >= 50) {
    try {
      s.term.write(text + "\r");
    } catch {
      /* PTY gone */
    }
    return;
  }
  setTimeout(() => injectWhenReady(s, text, attempt + 1), 200);
}

/**
 * Pre-warm the pool for one folder selection: spawn up to POOL_SIZE pooled
 * sessions matching (cwd, model, effort), and kill any pooled session that no
 * longer matches the current selection (or has exited) so only the current
 * folder's warm pool survives. No-op while the Claude usage limit is hit.
 */
export function preloadPool(opts: {
  cwd: string;
  model: string;
  effort: string;
  count?: number;
}): void {
  const cwd = opts.cwd?.trim();
  if (!cwd) return;
  if (isBlocked(getUsage(), Date.now()).blocked) return;
  const model = normalizeModel(opts.model) ?? "";
  const effort = normalizeEffort(opts.effort) ?? "";
  const wantKey = poolKey(cwd, model, effort);
  const count = opts.count ?? POOL_SIZE;

  // Drop stale pooled sessions (different selection, or exited).
  for (const s of [...SESSIONS.values()]) {
    if (!s.pooled) continue;
    const stale =
      s.status !== "running" || poolKey(s.meta.cwd, s.meta.model, s.meta.effort) !== wantKey;
    if (stale) killPtySession(s.id);
  }

  let have = 0;
  for (const s of SESSIONS.values()) {
    if (s.pooled && poolKey(s.meta.cwd, s.meta.model, s.meta.effort) === wantKey) have++;
  }
  for (let i = have; i < count; i++) {
    try {
      createPtySession({
        id: genSessionId(),
        cwd,
        prompt: "",
        model,
        effort,
        cols: 80,
        rows: 24,
        projectName: "",
        batchId: "",
        startedAt: Date.now(),
        pooled: true,
      });
    } catch {
      break; // Claude unresolved / spawn failed — stop trying.
    }
  }
}

/**
 * Claim a warm session for (cwd, model, effort): assign the user's task to it,
 * inject the prompt once Claude is ready, reveal it (pooled:false), and return
 * its id so the client attaches to it. Returns null when no warm session is
 * available — the caller then opens a fresh session the normal way.
 */
export function claimFromPool(opts: {
  cwd: string;
  model: string;
  effort: string;
  prompt: string;
  projectName: string;
  batchId: string;
  startedAt: number;
  origin?: "github";
  repoFullName?: string;
}): string | null {
  const cwd = opts.cwd?.trim();
  if (!cwd) return null;
  const model = normalizeModel(opts.model) ?? "";
  const effort = normalizeEffort(opts.effort) ?? "";
  const wantKey = poolKey(cwd, model, effort);
  const match = [...SESSIONS.values()].find(
    (s) =>
      s.pooled &&
      s.status === "running" &&
      poolKey(s.meta.cwd, s.meta.model, s.meta.effort) === wantKey,
  );
  if (!match) return null;

  match.pooled = false;
  match.meta.prompt = opts.prompt;
  match.meta.projectName = opts.projectName;
  match.meta.batchId = opts.batchId;
  match.meta.startedAt = opts.startedAt;
  match.meta.origin = opts.origin;
  match.meta.repoFullName = opts.repoFullName;
  if (opts.prompt) injectWhenReady(match, opts.prompt);
  return match.id;
}

/** Reap warm sessions that were pre-spawned but never opened within this long. */
const POOL_MAX_IDLE_MS = 10 * 60 * 1000;

/**
 * Kill pooled (unclaimed) sessions older than the idle limit. preloadPool only
 * cleans up on a folder change, so without this a pool the user pre-warmed and
 * then walked away from would keep ~6 `claude` processes alive until the app
 * quits. A single process-wide interval bounds that leak. Claimed sessions
 * (pooled:false) are never touched.
 */
function reapStalePool(): void {
  const now = Date.now();
  for (const s of [...SESSIONS.values()]) {
    if (s.pooled && now - s.meta.startedAt > POOL_MAX_IDLE_MS) killPtySession(s.id);
  }
}
if (!g.__claudePoolReaper) {
  const timer = setInterval(reapStalePool, 60_000);
  // Don't let the reaper keep the process alive on its own.
  (timer as { unref?: () => void }).unref?.();
  g.__claudePoolReaper = timer;
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
  // Client-provided creation key (the launcher's deterministic `createdAt`). Used
  // as `startedAt` so the Sessions office numbers sessions identically to the
  // launcher (oldest = #1), instead of racing on WebSocket-arrival order.
  const startedAtParam = Number(url.searchParams.get("startedAt"));
  const startedAt =
    Number.isFinite(startedAtParam) && startedAtParam > 0 ? startedAtParam : Date.now();

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

  // A fresh, immediately-opened session: spawn Claude with the prompt as a
  // launch arg (the warm-pool path injects the prompt instead — see claimFromPool).
  let session: PtySession;
  try {
    session = createPtySession({
      id,
      cwd,
      prompt,
      model: model ?? "",
      effort: effort ?? "",
      cols,
      rows,
      projectName,
      batchId,
      startedAt,
      origin,
      repoFullName,
      pooled: false,
    });
  } catch (err) {
    send({
      t: "out",
      d: `\r\n\x1b[31m[failed to start claude: ${(err as Error).message}]\x1b[0m\r\n`,
    });
    ws.close();
    return;
  }

  attach(session, ws);
}
