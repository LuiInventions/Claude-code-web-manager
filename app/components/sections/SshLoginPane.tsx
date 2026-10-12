"use client";

import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { enableTermCopy } from "../term-copy";

const THEME = {
  background: "#000000",
  foreground: "#f5f5f5",
  cursor: "#f5f5f5",
  cursorAccent: "#000000",
  selectionBackground: "rgba(255,255,255,0.16)",
};

/**
 * Read-only view of the ssh process. The password and the 2FA code are typed
 * in the center fields, not here, so this terminal does not send keystrokes.
 */
export default function SshLoginPane() {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<{ fit: () => void } | null>(null);
  const termRef = useRef<{ cols: number; rows: number } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let disposed = false;
    let term: { dispose: () => void; write: (data: string) => void; cols: number; rows: number } | null =
      null;
    const pending: string[] = [];
    let ready = false;
    const el = containerRef.current;

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/remote-login`);
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      const data = typeof ev.data === "string" ? ev.data : "";
      if (!data) return;
      if (!ready || !term) pending.push(data);
      else term.write(data);
    };

    const sendSize = () => {
      const current = termRef.current;
      const socket = wsRef.current;
      if (!current || !socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ t: "resize", c: current.cols, r: current.rows }));
    };

    void (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      if (disposed || !el) return;
      const created = new Terminal({
        fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace',
        fontSize: 13,
        lineHeight: 1.2,
        theme: THEME,
        cursorBlink: false,
        disableStdin: true,
        scrollback: 4000,
      });
      const fit = new FitAddon();
      created.loadAddon(fit);
      created.open(el);
      enableTermCopy(created, el);
      term = created;
      termRef.current = created;
      fitRef.current = fit;
      ready = true;
      for (const chunk of pending) created.write(chunk);
      pending.length = 0;
      requestAnimationFrame(() => {
        try {
          fit.fit();
        } catch {
          /* not measurable yet */
        }
        sendSize();
      });
    })();

    const obs = new ResizeObserver(() => {
      try {
        fitRef.current?.fit();
      } catch {
        /* not measurable yet */
      }
      sendSize();
    });
    if (el) obs.observe(el);

    return () => {
      disposed = true;
      obs.disconnect();
      ws.close();
      term?.dispose();
    };
  }, []);

  return <div ref={containerRef} className="h-full min-h-0 w-full" />;
}
