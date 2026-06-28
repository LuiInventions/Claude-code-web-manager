import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { installBridge } from "./secrets";

// App root holds `.next`, `next.config.ts` and `node_modules`. With asar: false
// the packaged layout is resources/app/build/electron, so two levels up resolves
// the app root in BOTH packaged and dev runs.
const ROOT = path.resolve(__dirname, "..", "..");

function ensureDepsFromSource() {
  if (app.isPackaged) return; // packaged app ships node_modules
  if (fs.existsSync(path.join(ROOT, "node_modules"))) return;
  const r = spawnSync("npm", ["install"], { cwd: ROOT, stdio: "inherit", shell: true });
  if (r.status !== 0) throw new Error("npm install failed");
}

async function boot() {
  ensureDepsFromSource();
  installBridge();
  // Packaged app runs the prebuilt Next production server; unpackaged dev runs
  // Next in dev mode (no prior `next build` required).
  if (app.isPackaged) {
    process.env.NODE_ENV = "production";
    // Persist user data (settings.json etc.) to a writable, update-safe location
    // instead of the read-only install dir. Secrets already go to userData via
    // the safeStorage bridge; this covers the cwd-relative .data store.
    process.chdir(app.getPath("userData"));
  }

  // server.cjs is produced by the build step (bundle-server.mjs) from lib/server/start.ts.
  const { startServer } = require(path.join(__dirname, "dist", "server.cjs")) as {
    startServer: (o?: { quiet?: boolean; dir?: string }) => Promise<{ host: string; port: number }>;
  };

  let info: { host: string; port: number };
  try {
    info = await startServer({ quiet: true, dir: ROOT });
  } catch (err) {
    dialog.showErrorBox("Serverstart fehlgeschlagen", String(err));
    app.quit();
    return;
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: "#0b0b0f",
    title: "Claude Code Control Center",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });
  await win.loadURL(`http://${info.host}:${info.port}`);
}

ipcMain.handle("ccc:pick-folder", async () => {
  const res = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
});

app.whenReady().then(boot);
app.on("window-all-closed", () => app.quit());
