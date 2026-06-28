import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { installBridge } from "./secrets";

// Project root: packaged => resources, dev => two levels up from build/electron.
const ROOT = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "..", "..");

function ensureDepsFromSource() {
  if (app.isPackaged) return; // packaged app ships node_modules
  if (fs.existsSync(path.join(ROOT, "node_modules"))) return;
  const r = spawnSync("npm", ["install"], { cwd: ROOT, stdio: "inherit", shell: true });
  if (r.status !== 0) throw new Error("npm install failed");
}

async function boot() {
  ensureDepsFromSource();
  installBridge();
  process.env.NODE_ENV = "production";

  // server.cjs is produced by the build step (bundle-server.mjs) from lib/server/start.ts.
  const { startServer } = require(path.join(__dirname, "dist", "server.cjs")) as {
    startServer: (o?: { quiet?: boolean }) => Promise<{ host: string; port: number }>;
  };

  let info: { host: string; port: number };
  try {
    info = await startServer({ quiet: true });
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
