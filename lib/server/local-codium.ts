import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { getConfig } from "../config";
import {
  decodeCliOutput,
  editorSpawnSpec,
  installedEditorCandidates,
  preferEditorHit,
} from "../editor-bin";
import { readSettings } from "../settings";
import { codiumServeArgs, parseCodiumOutput } from "../remote-ssh";
import { startCodiumProxy } from "./codium-proxy";

/**
 * VS Codium in the app, on this PC, in the same folder the launcher uses for
 * Local. Nothing here talks to the remote SSH session.
 */

export interface LocalCodiumStatus {
  starting: boolean;
  ready: boolean;
  url: string;
  error: string;
  dir: string;
}

interface State {
  dir: string;
  starting: boolean;
  url: string;
  error: string;
  proc: ChildProcess | null;
  proxy: { port: number; close: () => void } | null;
  gen: number;
}

const g = globalThis as unknown as { __cccLocalCodium?: State };

function hub(): State {
  return (g.__cccLocalCodium ??= {
    dir: "",
    starting: false,
    url: "",
    error: "",
    proc: null,
    proxy: null,
    gen: 0,
  });
}

/** Launcher local folder, otherwise the projects root, otherwise the user profile. */
export function localCodiumDir(): string {
  const chosen = readSettings().launcherLocalPath?.trim();
  if (chosen && fs.existsSync(chosen)) return chosen;
  try {
    const projects = getConfig().projectsDir;
    if (projects && fs.existsSync(projects)) return projects;
  } catch {
    /* settings not readable */
  }
  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (home && fs.existsSync(home)) return home;
  return process.cwd();
}

function status(): LocalCodiumStatus {
  const state = hub();
  return {
    starting: state.starting,
    ready: Boolean(state.url),
    url: state.url,
    error: state.error,
    dir: state.dir || localCodiumDir(),
  };
}

function stopProcess(state: State): void {
  state.proxy?.close();
  state.proxy = null;
  if (state.proc) {
    try {
      state.proc.kill();
    } catch {
      /* already gone */
    }
    state.proc = null;
  }
}

export async function stopLocalCodium(): Promise<LocalCodiumStatus> {
  const state = hub();
  state.gen += 1;
  stopProcess(state);
  state.starting = false;
  state.url = "";
  state.error = "";
  state.dir = "";
  return status();
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function whereAll(name: string): string[] {
  const cmd = process.platform === "win32" ? "where" : "which";
  try {
    const out = execFileSync(cmd, [name], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
    });
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** PATH hits first (Codium, then Code), then the usual Windows install folders. */
function editorCandidates(): string[] {
  const fromPath = [preferEditorHit(whereAll("codium")), preferEditorHit(whereAll("code"))].filter(
    (p): p is string => Boolean(p),
  );
  const installed = installedEditorCandidates(process.env, process.platform).filter((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
  const seen = new Set<string>();
  const all: string[] = [];
  for (const p of [...fromPath, ...installed]) {
    const key = process.platform === "win32" ? p.toLowerCase() : p;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(p);
  }
  return all;
}

function commandOutput(bin: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const spec = editorSpawnSpec(bin, args);
    let proc: ChildProcess;
    try {
      proc = spawn(spec.file, spec.args, {
        cwd,
        windowsHide: true,
        windowsVerbatimArguments: spec.windowsVerbatimArguments,
      });
    } catch {
      resolve("");
      return;
    }
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
      resolve(decodeCliOutput(Buffer.concat(chunks)));
    }, 12000);
    const done = () => {
      clearTimeout(timer);
      resolve(decodeCliOutput(Buffer.concat(chunks)));
    };
    const take = (chunk: Buffer) => {
      chunks.push(chunk);
    };
    proc.stdout?.on("data", take);
    proc.stderr?.on("data", take);
    proc.on("error", done);
    proc.on("close", done);
  });
}

async function launch(dir: string): Promise<void> {
  const state = hub();
  const my = (state.gen += 1);
  stopProcess(state);
  state.dir = dir;
  state.starting = true;
  state.url = "";
  state.error = "";

  const candidates = editorCandidates();
  if (candidates.length === 0) {
    state.starting = false;
    state.error = "VS Codium fehlt auf diesem PC (`codium` oder `code`).";
    return;
  }
  let bin = "";
  let helpText = "";
  for (const candidate of candidates) {
    const text = await commandOutput(candidate, ["serve-web", "--help"], dir);
    if (my !== hub().gen) return;
    if (!bin) {
      bin = candidate;
      helpText = text;
    }
    if (text.includes("serve-web")) {
      bin = candidate;
      helpText = text;
      break;
    }
  }
  if (!helpText.includes("serve-web")) {
    if (my !== hub().gen) return;
    state.starting = false;
    state.error = "VS Codium kann `serve-web` nicht. `codium` oder `code` fehlt oder ist zu alt.";
    return;
  }
  const port = await freePort();
  if (my !== hub().gen) return;
  let args: string[];
  try {
    args = codiumServeArgs(helpText, port);
  } catch {
    state.starting = false;
    state.error = "VS Codium konnte keinen lokalen Port wählen.";
    return;
  }
  const spec = editorSpawnSpec(bin, args);
  const proc = spawn(spec.file, spec.args, {
    cwd: dir,
    windowsHide: true,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsVerbatimArguments: spec.windowsVerbatimArguments,
  });
  state.proc = proc;
  const chunks: Buffer[] = [];
  const take = (chunk: Buffer) => {
    chunks.push(chunk);
    let buf = Buffer.concat(chunks);
    if (buf.length > 20000) {
      buf = buf.subarray(buf.length - 10000);
      chunks.length = 0;
      chunks.push(buf);
    }
    const output = decodeCliOutput(buf);
    const parsed = parseCodiumOutput(output);
    if (parsed.missing) {
      state.error = "VS Codium fehlt auf diesem PC (`codium` oder `code`).";
      state.starting = false;
      return;
    }
    if (!parsed.ready || !parsed.port || state.url || my !== hub().gen) return;
    void startCodiumProxy(parsed.port)
      .then((proxy) => {
        if (my !== hub().gen) {
          proxy.close();
          return;
        }
        state.proxy = proxy;
        const pathPart = parsed.path.startsWith("/") ? parsed.path : `/${parsed.path}`;
        state.url = `http://127.0.0.1:${proxy.port}${pathPart}`;
        state.error = "";
        state.starting = false;
      })
      .catch((err: Error) => {
        if (my !== hub().gen) return;
        state.starting = false;
        state.error = err.message || "VS Codium ist nicht erreichbar.";
      });
  };
  proc.stdout?.on("data", take);
  proc.stderr?.on("data", take);
  proc.on("exit", () => {
    if (my !== hub().gen) return;
    if (!state.url) {
      state.starting = false;
      state.error = state.error || "VS Codium wurde beendet.";
    }
  });
  proc.on("error", (err) => {
    if (my !== hub().gen) return;
    state.starting = false;
    state.error = `VS Codium konnte nicht gestartet werden: ${err.message}`;
  });
}

/** Start serve-web when it is not already running in the launcher's local folder. */
export async function ensureLocalCodium(): Promise<LocalCodiumStatus> {
  const dir = localCodiumDir();
  const state = hub();
  if (state.dir === dir && (state.url || state.starting) && !state.error) return status();
  await launch(dir);
  return status();
}

/**
 * Follow a launcher folder change. A failed start stays failed until the
 * client asks to start again, so polling does not restart in a loop.
 */
export async function syncLocalCodium(): Promise<LocalCodiumStatus> {
  const dir = localCodiumDir();
  const state = hub();
  const running = Boolean(state.proc) || state.starting || Boolean(state.url);
  if (running && state.dir && state.dir !== dir) {
    await launch(dir);
  }
  return status();
}
