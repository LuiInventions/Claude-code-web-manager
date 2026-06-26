"use client";

import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";

/**
 * Live, interactive Claude Code session rendered in the web (launcher "CMD"
 * mode). Connects to /ws/claude-pty, which spawns `claude` in a real PTY cwd'd
 * to the project. The user sees the running session live and can type into it —
 * no separate OS window. Mount one per session (key by session id).
 */

const XTERM_THEME = {
  background: "#0a0f1a",
  foreground: "#e6edf3",
  cursor: "#3b82f6",
  cursorAccent: "#0a0f1a",
  selectionBackground: "rgba(59,130,246,0.30)",
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
  projectName,
  batchId,
  onExit,
}: {
  id: string;
  cwd: string;
  prompt: string;
  model: string;
  effort: string;
  origin?: "github";
  repoFullName?: string;
  projectName?: string;
  batchId?: string;
  onExit?: (code: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  useEffect(() => {
    onExitRef.current = onExit;
  });

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let resizeObs: ResizeObserver | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let term: any = null;

    (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const el = containerRef.current;
      if (disposed || !el) return;

      term = new Terminal({
        fontFamily:
          '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace',
        fontSize: 13,
        lineHeight: 1.2,
        theme: XTERM_THEME,
        cursorBlink: true,
        scrollback: 8000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(el);
      fit.fit();

      const proto = location.protocol === "https:" ? "wss" : "ws";
      const qs = new URLSearchParams({
        id,
        cwd,
        prompt,
        model,
        effort,
        cols: String(term.cols),
        rows: String(term.rows),
      });
      if (projectName) qs.set("projectName", projectName);
      if (batchId) qs.set("batchId", batchId);
      if (origin) qs.set("origin", origin);
      if (repoFullName) qs.set("repoFullName", repoFullName);
      ws = new WebSocket(`${proto}://${location.host}/ws/claude-pty?${qs}`);

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string);
          if (msg.t === "out") term.write(msg.d);
          else if (msg.t === "exit") {
            term.write(
              `\r\n\x1b[90m[Session beendet · Code ${msg.code}]\x1b[0m\r\n`,
            );
            onExitRef.current?.(msg.code);
          }
        } catch {
          /* ignore non-JSON frames */
        }
      };

      term.onData((d: string) => {
        if (ws && ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ t: "in", d }));
      });

      const doFit = () => {
        try {
          fit.fit();
        } catch {
          /* container not measurable yet */
        }
        if (ws && ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ t: "resize", c: term.cols, r: term.rows }));
      };
      resizeObs = new ResizeObserver(doFit);
      resizeObs.observe(el);
      term.focus();
    })();

    return () => {
      disposed = true;
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
    };
    // Connect once per mounted session (keyed by session id upstream).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-0 flex-1 bg-canvas p-2">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
