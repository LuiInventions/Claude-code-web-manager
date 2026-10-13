"use client";

import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { cliGridForBox } from "@/lib/cli-grid";
import { enableTermCopy } from "../../term-copy";

/**
 * Live, interactive code-CLI session. Connects to /ws/claude-pty, which spawns
 * the CLI in a real PTY cwd'd to the project. Mount one per session.
 *
 * Sizing: the host is taken out of flow (`absolute inset-2`) so the terminal's
 * own 80×24 default cannot inflate the pane. The socket opens only after that
 * box has a real size, and the CLI is spawned at that grid. Starting at 80×24
 * in a short window scrolls the first paint upward — the pane looks shifted
 * until something resizes it. A hidden pane (another batch) still starts at
 * 80×24 and is corrected when it is shown.
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
  // Skip a PTY resize when fit() did not change the grid. A ResizeObserver
  // loop otherwise makes the CLI redraw the whole screen on every pixel.
  const fittedRef = useRef({ c: 0, r: 0 });

  // Fit to the (current) container size and tell the PTY the new dimensions.
  // A hidden or not-yet-laid-out box reports ~0. Fitting that would lock the
  // CLI to a tiny grid and shift the screen once the pane is actually shown.
  const refit = () => {
    const el = containerRef.current;
    const fit = fitRef.current;
    const term = termRef.current;
    const ws = wsRef.current;
    if (!fit || !term || !el) return;
    if (!cliGridForBox(el.clientWidth, el.clientHeight)) return;
    try {
      fit.fit();
    } catch {
      /* container not measurable yet */
    }
    // Full-screen CLIs use the alternate buffer. If the pane was shorter than
    // the grid xterm first built, the viewport stays scrolled and the UI sits
    // high in the box. Pin it back to the top after a real fit.
    if (term.buffer?.active?.type === "alternate") {
      const viewport = el.querySelector(".xterm-viewport");
      if (viewport instanceof HTMLElement) viewport.scrollTop = 0;
    }
    const cols = term.cols;
    const rows = term.rows;
    if (cols < 2 || rows < 2) return;
    if (cols === fittedRef.current.c && rows === fittedRef.current.r) return;
    fittedRef.current = { c: cols, r: rows };
    if (ws && ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ t: "resize", c: cols, r: rows }));
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
    let fitFrame = 0;
    const timers: number[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let term: any = null;

    let termReady = false;
    const writeMsg = (msg: { t: string; d?: string; code?: number }) => {
      if (!term) return;
      if (msg.t === "out" && msg.d) term.write(msg.d);
      else if (msg.t === "exit") {
        term.write(`\r\n\x1b[90m[Session beendet · Code ${msg.code}]\x1b[0m\r\n`);
        onExitRef.current?.(msg.code ?? 0);
      }
    };

    const frame = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

    const readBox = (el: HTMLElement) => cliGridForBox(el.clientWidth, el.clientHeight);

    (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      if (disposed) return;
      const el = containerRef.current;
      if (!el) return;

      // The sidebar closes in the same commit that mounts this pane. Wait
      // until that layout (and a short window's row height) has settled
      // before choosing the grid the CLI is born at.
      let grid = readBox(el);
      for (let i = 0; i < 3 && !grid && !disposed; i++) {
        await frame();
        const box = containerRef.current;
        grid = box ? readBox(box) : null;
      }
      if (!grid && !disposed) {
        await new Promise<void>((resolve) => {
          window.setTimeout(() => resolve(), 50);
        });
        const box = containerRef.current;
        grid = box ? readBox(box) : null;
      }
      if (disposed || !containerRef.current) return;

      const host = containerRef.current;
      // Hidden batch panes have no box yet. 80×24 is only for those; a
      // visible short pane must not start there or the UI paints shifted.
      const born = grid ?? { cols: 80, rows: 24 };
      term = new Terminal({
        cols: born.cols,
        rows: born.rows,
        fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
        fontSize: 14,
        lineHeight: 1,
        letterSpacing: 0,
        customGlyphs: true,
        theme: XTERM_THEME,
        cursorBlink: true,
        cursorStyle: "block",
        scrollback: 2000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      enableTermCopy(term, host);
      fitRef.current = fit;
      termRef.current = term;

      let cols = born.cols;
      let rows = born.rows;
      if (grid) {
        try {
          fit.fit();
        } catch {
          /* keep the measured grid */
        }
        if (term.cols >= 2 && term.rows >= 2) {
          cols = term.cols;
          rows = term.rows;
        }
        const viewport = host.querySelector(".xterm-viewport");
        if (viewport instanceof HTMLElement) viewport.scrollTop = 0;
      }
      fittedRef.current = { c: cols, r: rows };
      if (disposed) {
        try {
          term.dispose();
        } catch {
          /* noop */
        }
        return;
      }

      termReady = true;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const qs = new URLSearchParams({
        id,
        cwd,
        prompt,
        model,
        effort,
        cols: String(cols),
        rows: String(rows),
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
          writeMsg(msg);
        } catch {
          /* ignore non-JSON frames */
        }
      };

      term.onData((d: string) => {
        if (ws && ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ t: "in", d }));
      });

      resizeObs = new ResizeObserver(() => {
        cancelAnimationFrame(fitFrame);
        fitFrame = requestAnimationFrame(() => refitRef.current());
      });
      resizeObs.observe(host);

      // Font load and the last flex pass can still change the cell size.
      for (const ms of [60, 200, 450]) {
        timers.push(window.setTimeout(() => refitRef.current(), ms));
      }
      void document.fonts?.ready.then(() => {
        if (!disposed) refitRef.current();
      });
      term.focus();
    })();

    return () => {
      disposed = true;
      timers.forEach((t) => clearTimeout(t));
      cancelAnimationFrame(fitFrame);
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
    <div className="relative min-h-0 flex-1 bg-canvas">
      {/* Out of flow, so the terminal's intrinsic size cannot grow the pane
          and make fit() measure the terminal instead of the window. */}
      <div ref={containerRef} className="cli-term absolute inset-2 overflow-hidden" />
    </div>
  );
}
