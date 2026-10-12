"use client";

import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { enableTermCopy } from "../../term-copy";

/**
 * Live, interactive Claude Code session rendered in the web (launcher "CMD"
 * mode). Connects to /ws/claude-pty, which spawns `claude` in a real PTY cwd'd
 * to the project. The user sees the running session live and can type into it —
 * no separate OS window. Mount one per session (key by session id).
 *
 * Sizing: xterm must be fit to a *settled* container. The launcher collapses its
 * sidebar when a session starts, so an immediate synchronous fit would measure a
 * mid-transition width and leave the chat interface visually shifted until the
 * user toggled the sidebar. We therefore (a) defer the initial fit across two
 * animation frames, (b) refit when the socket opens, (c) refit a few times while
 * the sidebar slide settles, and (d) refit whenever `layoutNonce` changes (the
 * launcher bumps it on sidebar toggle / active-batch switch).
 */

const XTERM_THEME = {
  background: "#000000",
  foreground: "#f5f5f5",
  cursor: "#f5f5f5",
  cursorAccent: "#000000",
  selectionBackground: "rgba(255,255,255,0.16)",
  black: "#0a0f1a",
  red: "#ef4444",
  green: "#22c55e",
  yellow: "#f59e0b",
  blue: "#3b82f6",
  magenta: "#a78bfa",
  cyan: "#38bdf8",
  white: "#9fb0c0",
  brightBlack: "#6b7b8c",
  brightRed: "#f87171",
  brightGreen: "#4ade80",
  brightYellow: "#fbbf24",
  brightBlue: "#60a5fa",
  brightMagenta: "#c4b5fd",
  brightCyan: "#7dd3fc",
  brightWhite: "#e6edf3",
};

export default function ClaudeCmdPane({
  id,
  cwd,
  prompt,
  model,
  effort,
  origin,
  repoFullName,
  where,
  cli,
  projectName,
  batchId,
  createdAt,
  layoutNonce,
  onExit,
}: {
  id: string;
  cwd: string;
  prompt: string;
  model: string;
  effort: string;
  origin?: "github";
  repoFullName?: string;
  /** `remote` starts the CLI over the shared ssh login instead of locally. */
  where?: "remote";
  /** Remote sessions name the CLI. Local sessions keep the Settings choice. */
  cli?: string;
  projectName?: string;
  batchId?: string;
  /** Client creation key — sent to the PTY as `startedAt` so the Sessions office
   *  numbers this session identically to the launcher (oldest = #1). */
  createdAt?: number;
  /** Bumped by the launcher on layout changes (sidebar toggle, tab switch) to force a refit. */
  layoutNonce?: number;
  onExit?: (code: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  useEffect(() => {
    onExitRef.current = onExit;
  });

  // Held so an external relayout (layoutNonce) or the ResizeObserver can refit
  // the same terminal instance created inside the async setup effect.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fitRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const termRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Fit to the (current) container size and tell the PTY the new dimensions.
  const refit = () => {
    const fit = fitRef.current;
    const term = termRef.current;
    const ws = wsRef.current;
    if (!fit || !term) return;
    try {
      fit.fit();
    } catch {
      /* container not measurable yet */
    }
    if (ws && ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ t: "resize", c: term.cols, r: term.rows }));
  };
  const refitRef = useRef(refit);
  refitRef.current = refit;

  // Two rAFs: let the browser apply the latest layout before we measure.
  const deferredRefit = () => {
    requestAnimationFrame(() => requestAnimationFrame(() => refitRef.current()));
  };

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let resizeObs: ResizeObserver | null = null;
    const timers: number[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let term: any = null;

    // Open the PTY before xterm finishes loading. Output that arrives early is
    // buffered and written once the terminal exists, so the CLI's own startup
    // overlaps the widget import instead of waiting for it.
    const pending: { t: string; d?: string; code?: number }[] = [];
    let termReady = false;
    const writeMsg = (msg: { t: string; d?: string; code?: number }) => {
      if (!term) return;
      if (msg.t === "out" && msg.d) term.write(msg.d);
      else if (msg.t === "exit") {
        term.write(`\r\n\x1b[90m[Session beendet · Code ${msg.code}]\x1b[0m\r\n`);
        onExitRef.current?.(msg.code ?? 0);
      }
    };

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const box = containerRef.current;
    const guessCols =
      box && box.clientWidth > 40 ? Math.max(20, Math.floor(box.clientWidth / 8.4)) : 80;
    const guessRows =
      box && box.clientHeight > 40 ? Math.max(8, Math.floor(box.clientHeight / 17)) : 24;
    const qs = new URLSearchParams({
      id,
      cwd,
      prompt,
      model,
      effort,
      cols: String(guessCols),
      rows: String(guessRows),
    });
    if (projectName) qs.set("projectName", projectName);
    if (batchId) qs.set("batchId", batchId);
    if (createdAt) qs.set("startedAt", String(createdAt));
    if (origin) qs.set("origin", origin);
    if (repoFullName) qs.set("repoFullName", repoFullName);
    if (where === "remote") qs.set("where", "remote");
    if (cli) qs.set("cli", cli);
    ws = new WebSocket(`${proto}://${location.host}/ws/claude-pty?${qs}`);
    wsRef.current = ws;
    ws.onopen = () => {
      if (termReady) deferredRefit();
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          t: string;
          d?: string;
          code?: number;
        };
        if (!termReady) pending.push(msg);
        else writeMsg(msg);
      } catch {
        /* ignore non-JSON frames */
      }
    };

    (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const el = containerRef.current;
      if (disposed || !el) return;

      term = new Terminal({
        fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
        fontSize: 14,
        lineHeight: 1,
        letterSpacing: 0,
        customGlyphs: true,
        theme: XTERM_THEME,
        cursorBlink: true,
        cursorStyle: "block",
        scrollback: 10000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(el);
      enableTermCopy(term, el);
      fitRef.current = fit;
      termRef.current = term;
      termReady = true;
      for (const msg of pending) writeMsg(msg);
      pending.length = 0;

      // Defer the first fit until the container has settled (the sidebar may be
      // collapsing right now); the resize message below corrects the PTY size.
      deferredRefit();

      term.onData((d: string) => {
        if (ws && ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ t: "in", d }));
      });

      resizeObs = new ResizeObserver(() => refitRef.current());
      resizeObs.observe(el);

      // Catch the sidebar slide / late layout without relying on a single frame.
      for (const ms of [60, 200, 450]) {
        timers.push(window.setTimeout(() => refitRef.current(), ms));
      }
      term.focus();
    })();

    return () => {
      disposed = true;
      timers.forEach((t) => clearTimeout(t));
      resizeObs?.disconnect();
      try {
        ws?.close();
      } catch {
        /* noop */
      }
      try {
        term?.dispose();
      } catch {
        /* noop */
      }
      fitRef.current = null;
      termRef.current = null;
      wsRef.current = null;
    };
    // Connect once per mounted session (keyed by session id upstream).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External relayout (sidebar opened/closed, active batch switched): refit once
  // the transition has settled. Harmless extra refit on first mount.
  useEffect(() => {
    deferredRefit();
    const t = window.setTimeout(() => refitRef.current(), 280);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutNonce]);

  return (
    <div className="min-h-0 flex-1 bg-canvas p-2">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
