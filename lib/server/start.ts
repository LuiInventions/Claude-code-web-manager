import { createServer, type Server } from "node:http";
import next from "next";
import nextConfig from "../../next.config.mjs";
import { getConfig } from "../config";
import { handleWsUpgrade } from "./ws-hub";
import { startUsagePoller } from "./usage-poller";
import { warmCodeCli } from "./cli-warm";

export interface RunningServer {
  host: string;
  port: number;
  close: () => Promise<void>;
}

/**
 * Boots Next + the ws hub on the loopback interface. Used by the CLI entry
 * (server.ts) and by the Electron main process.
 */
export async function startServer(
  opts: { quiet?: boolean; dir?: string } = {},
): Promise<RunningServer> {
  const { host, port } = getConfig();
  const dev = process.env.NODE_ENV !== "production";

  // `dir` lets the Electron main process point Next at the app root (where
  // `.next` lives) independently of the working directory. Defaults to cwd.
  //
  // Packaged, next.config.mjs sits inside app.asar. Next loads it with an ESM
  // import(), and Node's ESM loader cannot read asar entries. esbuild inlines
  // the same object into server.cjs. `next build` still reads the file.
  const packagedElectron =
    Boolean(process.versions.electron) &&
    (process as NodeJS.Process & { defaultApp?: boolean }).defaultApp !== true;
  const app = next({
    dev,
    dir: opts.dir,
    hostname: host,
    port,
    ...(packagedElectron ? { conf: nextConfig } : {}),
  });
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

  // Reject (not hang) if listen() fails — e.g. the port is taken. Without this
  // the startup promise would never settle and the Electron app would hang with
  // no window and no error dialog.
  await new Promise<void>((resolve, reject) => {
    const onListenError = (err: Error) => reject(err);
    server.once("error", onListenError);
    server.listen(port, host, () => {
      server.removeListener("error", onListenError);
      if (!opts.quiet) {
        console.log(
          `\n  ▸ Jarvis Control Center  →  http://${host}:${port}   (loopback only)\n`,
        );
      }
      startUsagePoller();
      warmCodeCli();
      resolve();
    });
  });

  return {
    host,
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
