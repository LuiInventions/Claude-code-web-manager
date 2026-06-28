import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { spawnSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installBridge } from "./secrets";

// App root holds `.next`, `next.config.ts` and `node_modules`. With asar: false
// the packaged layout is resources/app/build/electron, so two levels up resolves
// the app root in BOTH packaged and dev runs.
const ROOT = path.resolve(__dirname, "..", "..");

// --------------------------------------------------------------- logging
let LOG_FILE = path.join(os.tmpdir(), "ccc-startup.log");

function log(...parts: unknown[]): void {
  const line = `[${new Date().toISOString()}] ${parts
    .map((p) => (p instanceof Error ? p.stack || p.message : String(p)))
    .join(" ")}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    /* ignore */
  }
  try {
    process.stdout.write(line);
  } catch {
    /* ignore */
  }
}

function fatal(err: unknown): void {
  log("FATAL", err);
  try {
    dialog.showErrorBox(
      "Claude Code Control Center — Startfehler",
      `${err instanceof Error ? err.stack || err.message : String(err)}\n\nLog: ${LOG_FILE}`,
    );
  } catch {
    /* ignore */
  }
  app.exit(1);
}

process.on("uncaughtException", (e) => fatal(e));
process.on("unhandledRejection", (e) => log("unhandledRejection", e));

// --------------------------------------------------------------- helpers
function ensureDepsFromSource(): void {
  if (app.isPackaged) return; // packaged app ships node_modules
  if (fs.existsSync(path.join(ROOT, "node_modules"))) return;
  log("node_modules missing — running npm install");
  const r = spawnSync("npm", ["install"], { cwd: ROOT, stdio: "inherit", shell: true });
  if (r.status !== 0) throw new Error("npm install failed");
}

/** Resolve a bindable loopback port, preferring `preferred`, else an ephemeral one. */
function resolvePort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => {
      const ephemeral = net.createServer();
      ephemeral.listen(0, "127.0.0.1", () => {
        const p = (ephemeral.address() as net.AddressInfo).port;
        ephemeral.close(() => resolve(p));
      });
    });
    probe.listen(preferred, "127.0.0.1", () => {
      probe.close(() => resolve(preferred));
    });
  });
}

function resolveIcon(): string | undefined {
  const ico = path.join(ROOT, "build", "resources", "icon.ico");
  return fs.existsSync(ico) ? ico : undefined;
}

let mainWindow: BrowserWindow | null = null;

async function boot(): Promise<void> {
  LOG_FILE = path.join(app.getPath("userData"), "startup.log");
  try {
    fs.writeFileSync(LOG_FILE, "");
  } catch {
    /* ignore */
  }
  log("boot start", "version=" + app.getVersion(), "packaged=" + app.isPackaged);
  log("ROOT=" + ROOT, "__dirname=" + __dirname, "electron=" + process.versions.electron);

  ensureDepsFromSource();
  installBridge();
  log("secret bridge installed");

  if (app.isPackaged) {
    process.env.NODE_ENV = "production";
    // Persist user data (settings.json etc.) to a writable, update-safe location
    // instead of the read-only install dir. Secrets already go to userData via
    // the safeStorage bridge; this covers the cwd-relative .data store.
    process.chdir(app.getPath("userData"));
    log("chdir userData=" + process.cwd());
  }

  const port = await resolvePort(Number(process.env.PORT) || 3100);
  process.env.PORT = String(port);
  log("port=" + port);

  const serverPath = path.join(__dirname, "dist", "server.cjs");
  log("server.cjs path=" + serverPath, "exists=" + fs.existsSync(serverPath));
  // server.cjs is produced by the build step (bundle-server.mjs) from lib/server/start.ts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { startServer } = require(serverPath) as {
    startServer: (o?: { quiet?: boolean; dir?: string }) => Promise<{ host: string; port: number }>;
  };
  log("server module required, starting…");

  const info = await startServer({ quiet: true, dir: ROOT });
  log("server listening on " + info.host + ":" + info.port);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    backgroundColor: "#0b0b0f",
    title: "Claude Code Control Center",
    icon: resolveIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Open external links (target=_blank / window.open) in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) {
      void shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    log("did-fail-load", code, desc, url);
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    log("render-process-gone", JSON.stringify(details));
  });

  const url = `http://${info.host}:${info.port}`;
  log("loading url=" + url);
  await mainWindow.loadURL(url);
  log("window loaded ok");
}

// Single-instance: a second launch focuses the existing window instead of
// starting a second server (which would fight over the port).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  Menu.setApplicationMenu(null);

  ipcMain.handle("ccc:pick-folder", async () => {
    const res = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      properties: ["openDirectory"],
    });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });

  app.whenReady().then(boot).catch((err) => fatal(err));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && mainWindow === null) {
      void boot().catch((err) => fatal(err));
    }
  });

  app.on("window-all-closed", () => app.quit());
}
