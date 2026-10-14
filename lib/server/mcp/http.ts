import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createJarvisMcpServer } from "./server";

export function isMcpRequest(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.split("?")[0];
  return path === "/mcp" || path === "/mcp/";
}

function isLoopback(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? "";
  const socketOk = addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  const host = (req.headers.host ?? "").split(":")[0].replace(/^\[|\]$/g, "");
  const hostOk = host === "" || host === "127.0.0.1" || host === "localhost";
  return socketOk && hostOk;
}

/**
 * Stateless Streamable HTTP on the app's loopback server.
 * Each request builds its own MCP server so clients do not share a session.
 */
export async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLoopback(req)) {
    res.writeHead(403, { "content-type": "text/plain" }).end("forbidden");
    return;
  }
  const server = createJarvisMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
    }
    if (!res.writableEnded) {
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : "mcp failed" }));
    }
    void transport.close();
    void server.close();
  }
}

/** Standalone listener used by tests. The app mounts handleMcp on its own server. */
export function listenMcp(port = 0): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    if (!isMcpRequest(req.url)) {
      res.writeHead(404).end();
      return;
    }
    void handleMcp(req, res);
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const bound = typeof address === "object" && address ? address.port : port;
      resolve({
        port: bound,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
