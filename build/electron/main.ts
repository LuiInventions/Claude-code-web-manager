import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from "electron";
import { spawnSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installBridge } from "./secrets";

// Next (non-Windows) calls fs.realpathSync.native, which skips Electron's asar
// patch and throws ENOTDIR for paths inside app.asar. Fall back to the patched
// realpath. Must run before the server (and therefore `next`) is loaded.
const nativeRealpath = fs.realpathSync.native;
if (typeof nativeRealpath === "function") {
  fs.realpathSync.native = ((target: fs.PathLike, options?: fs.RealpathSyncOptions) => {
    try {
      return nativeRealpath(target, options as never);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOTDIR" || code === "ENOENT" || code === "EINVAL" || code === "ENOTSUP") {
        return fs.realpathSync(target, options);
      }
      throw err;
    }
  }) as typeof fs.realpathSync.native;
}

// App root holds `.next`, `next.config.mjs` and `node_modules`. Packaged, that
// root is resources/app.asar (Electron treats it as a directory). Dev, it is
// the repo root. Two levels up from this file is that root in both layouts.
const ROOT = path.resolve(__dirname, "..", "..");

// Keep settings and the GitHub token when the product name changes. Copy the
// old folder once, then pin userData before the app is ready.
{
  const next = path.join(app.getPath("appData"), "jarvis-control-center");
  const legacy = path.join(app.getPath("appData"), "claude-code-control-center");
  try {
    if (!fs.existsSync(next) && fs.existsSync(legacy)) {
      fs.cpSync(legacy, next, { recursive: true });
    }
  } catch {
    /* the new folder is still usable empty */
  }
  app.setPath("userData", next);
}

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
      "Jarvis Control Center — Startfehler",
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

function resolveWritableGithubDir(userData: string): string {
  // The NSIS upgrade deletes the previous install directory. Clones stored in
  // `<install>\github_repos` were deleted with it, and the GitHub tab still
  // listed those paths. Keep clones outside Programs. userData survives an
  // upgrade and is the fallback when Local AppData rejects the write.
  const candidates: string[] = [];
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA?.trim();
    if (local) candidates.push(path.join(local, "Jarvis Control Center", "github_repos"));
  }
  candidates.push(path.join(userData, "github_repos"));
  for (const dir of candidates) {
    if (canWriteDir(dir)) return dir;
  }
  const fallback = path.join(userData, "github_repos");
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

function canWriteDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, ".write-test");
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
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

  // Expose the running version to the Next server (lib/version.ts) so it can
  // gate first-run setup after an update — the welcome/provider screen reappears
  // on a version bump while the GitHub token + other userData stay intact.
  process.env.CCC_APP_VERSION = app.getVersion();

  // The app root (where `public/` and `.next` live). Needed because we chdir()
  // to userData below in packaged mode, which moves process.cwd() away from the
  // install dir — server routes that read bundled, read-only assets (e.g. the
  // Sessions-tab office sprites under public/pixel-agents-assets) resolve paths
  // from CCC_APP_ROOT instead of cwd.
  process.env.CCC_APP_ROOT = ROOT;

  // Clones live outside the install directory. NSIS deletes that directory
  // on upgrade, which used to delete github_repos with it.
  const programDir = app.isPackaged ? path.dirname(app.getPath("exe")) : ROOT;
  process.env.CCC_PROGRAM_DIR = programDir;
  process.env.CCC_GITHUB_DIR = resolveWritableGithubDir(app.getPath("userData"));
  log("githubDir=" + process.env.CCC_GITHUB_DIR);

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
    backgroundColor: "#000000",
    title: "Jarvis Control Center",
    icon: resolveIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.on("context-menu", (_event, params) => {
    Menu.buildFromTemplate([
      { role: "copy", enabled: params.editFlags.canCopy || params.selectionText.length > 0 },
      { role: "paste", enabled: params.editFlags.canPaste },
      { role: "selectAll" },
    ]).popup({ window: mainWindow ?? undefined });
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

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    log("did-fail-load", code, desc, url, "mainFrame=" + isMainFrame);
    // -3 is ERR_ABORTED (benign: redirects/cancelled loads). Only surface real
    // main-frame failures so the user isn't left staring at a blank window.
    if (isMainFrame && code !== -3) {
      try {
        dialog.showErrorBox(
          "Seite konnte nicht geladen werden",
          `URL: ${url}\nFehler: ${desc} (${code})\n\nLog: ${LOG_FILE}`,
        );
      } catch {
        /* ignore */
      }
    }
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

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
    ]),
  );

  ipcMain.handle("ccc:copy-text", (_event, text: unknown) => {
    if (typeof text === "string" && text) clipboard.writeText(text);
  });

  ipcMain.handle("ccc:pick-folder", async (_event, title: unknown) => {
    const res = await dialog.showOpenDialog(mainWindow ?? undefined!, {
      title: typeof title === "string" && title.trim() ? title : undefined,
      properties: ["openDirectory"],
    });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });

  ipcMain.handle("ccc:open-path", async (_event, target: unknown) => {
    if (typeof target !== "string" || !target.trim()) return "missing path";
    return shell.openPath(target);
  });

  app.whenReady().then(boot).catch((err) => fatal(err));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && mainWindow === null) {
      void boot().catch((err) => fatal(err));
    }
  });

  app.on("window-all-closed", () => app.quit());
}
