import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { handleClaude } from "./claude-runner";
import { handleClaudePty } from "./claude-pty";

/**
 * Single WebSocketServer in noServer mode. server.ts forwards loopback HTTP
 * `upgrade` events whose path starts with /ws/ to here; everything else
 * (Next.js HMR) is handled by Next's own upgrade handler.
 */
const wss = new WebSocketServer({ noServer: true });

const KNOWN_ROUTES = new Set([
  "/ws/echo",
  "/ws/claude",
  "/ws/claude-pty",
]);

export function handleWsUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (!KNOWN_ROUTES.has(url.pathname)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => dispatch(url.pathname, ws, url));
}

function dispatch(route: string, ws: WebSocket, url: URL): void {
  switch (route) {
    case "/ws/claude":
      handleClaude(ws);
      break;
    case "/ws/claude-pty":
      handleClaudePty(ws, url);
      break;
    case "/ws/echo":
      ws.send("echo-ready");
      ws.on("message", (data) => ws.send(data.toString()));
      break;
    default:
      // /ws/claude is wired in the Launcher milestone.
      ws.send(
        JSON.stringify({ type: "notice", message: `${route} not wired yet` }),
      );
      ws.close();
  }
}
