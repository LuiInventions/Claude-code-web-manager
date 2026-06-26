import "./lib/load-env";

import { createServer } from "node:http";
import next from "next";
import { getConfig } from "./lib/config";
import { handleWsUpgrade } from "./lib/server/ws-hub";
import { startUsagePoller } from "./lib/server/usage-poller";

const { host, port } = getConfig();
const dev = process.env.NODE_ENV !== "production";

const app = next({ dev, hostname: host, port });

async function main() {
  await app.prepare();

  const handle = app.getRequestHandler();
  const upgrade = app.getUpgradeHandler();

  const server = createServer((req, res) => {
    handle(req, res);
  });

  // Route WebSocket upgrades: our /ws/* sockets vs Next.js HMR / internals.
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

  // Bind strictly to the loopback interface — no external reachability.
  server.listen(port, host, () => {
    console.log(
      `\n  ▸ Claude Code Control Center  →  http://${host}:${port}   (loopback only)\n`,
    );
    // Keep the session-limit bar live by scraping `/usage` every few minutes.
    startUsagePoller();
  });
}

main().catch((err) => {
  console.error("[control-center] failed to start:", err);
  process.exit(1);
});
