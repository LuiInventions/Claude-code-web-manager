import { createServer, type Server } from "node:http";
import next from "next";
import { getConfig } from "../config";
import { handleWsUpgrade } from "./ws-hub";
import { startUsagePoller } from "./usage-poller";

export interface RunningServer {
  host: string;
  port: number;
  close: () => Promise<void>;
}

/**
 * Boots Next + the ws hub on the loopback interface. Used by the CLI entry
 * (server.ts) and by the Electron main process.
 */
export async function startServer(opts: { quiet?: boolean } = {}): Promise<RunningServer> {
  const { host, port } = getConfig();
  const dev = process.env.NODE_ENV !== "production";

  const app = next({ dev, hostname: host, port });
  await app.prepare();

  const handle = app.getRequestHandler();
  const upgrade = app.getUpgradeHandler();

  const server: Server = createServer((req, res) => {
    handle(req, res);
  });

  server.on("upgrade", (req, socket, head) => {
    const url = req.url || "";
    if (url.startsWith("/ws/")) {
      handleWsUpgrade(req, socket, head);
    } else {
      upgrade(req, socket, head);
    }
  });

  server.on("error", (err) => {
    console.error("[control-center] server error:", err);
  });

  await new Promise<void>((resolve) => {
    server.listen(port, host, () => {
      if (!opts.quiet) {
        console.log(
          `\n  ▸ Claude Code Control Center  →  http://${host}:${port}   (loopback only)\n`,
        );
      }
      startUsagePoller();
      resolve();
    });
  });

  return {
    host,
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
