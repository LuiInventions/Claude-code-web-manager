import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import * as pty from "node-pty";
import { readSettings, writeSettings, type RemoteServerRecord } from "../settings";
import { readSecrets, writeSecrets } from "../secrets";
import {
  buildCodiumRemoteScript,
  classifySshTail,
  parseCodiumOutput,
  parseLoginTarget,
  remoteServerId,
  shellQuote,
  sshBaseArgs,
  stripAnsi,
  type RemotePublicStatus,
  type RemoteServerPublic,
} from "../remote-ssh";
import { startCodiumProxy } from "./codium-proxy";

/** Temp dir for the throwaway SSH key.
 *  Not os.tmpdir() / os.homedir(): Next evaluates those while tracing and then
 *  scans the Windows user profile.
 */
function remoteKeyPrefix(): string {
  const env = process.env;
  const root = env.TMPDIR || env.TEMP || env.TMP || "/tmp";
  return root + path.sep + "ccc-remote-";
}

function spawnHome(): string {
  const env = process.env;
  return env.USERPROFILE || env.HOME || ".";
}

export type { RemotePublicStatus };

/**
 * One SSH login for the whole app.
 *
 * Windows OpenSSH cannot share a connection with ControlMaster, and a 2FA code
 * only works once. So the first `ssh` is a real terminal: we type the password
 * and the 2FA code when ssh asks. After the shell answers, we install a
 * throwaway key and every later CLI / VS Codium process is `ssh -i` that key.
 * Disconnect deletes the key. The 2FA code is never stored.
 */

interface Live {
  dir: string;
  user: string;
  host: string;
  keyPath: string;
  knownHosts: string;
  login: pty.IPty | null;
  codium: pty.IPty | null;
  tunnel: ChildProcess | null;
  proxy: { port: number; close: () => void } | null;
  codiumUrl: string;
  codiumError: string;
}

const g = globalThis as unknown as {
  __cccRemote?: {
    gen: number;
    connecting: boolean;
    error: string;
    detail: string;
    live: Live | null;
  };
};

function hub() {
  return (g.__cccRemote ??= {
    gen: 0,
    connecting: false,
    error: "",
    detail: "",
    live: null,
  });
}

function readServerList(): RemoteServerRecord[] {
  const raw = readSettings().remoteServers;
  if (!Array.isArray(raw)) return [];
  const out: RemoteServerRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item.host !== "string" || typeof item.user !== "string") continue;
    const host = item.host.trim();
    const user = item.user.trim();
    if (!host || !user) continue;
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : remoteServerId(user, host);
    out.push({
      id,
      host,
      user,
      dir: typeof item.dir === "string" && item.dir.trim() ? item.dir.trim() : "~",
    });
  }
  return out;
}

/** Move the old single host/user/password into the server list, once. */
function migrateLegacy(): void {
  const settings = readSettings();
  if ((settings.remoteServers?.length ?? 0) > 0) return;
  if (!settings.remoteHost || !settings.remoteUser) return;
  const id = remoteServerId(settings.remoteUser, settings.remoteHost);
  const password = readSecrets().remoteSshPassword?.trim() || "";
  writeSettings({
    remoteServers: [
      {
        id,
        host: settings.remoteHost,
        user: settings.remoteUser,
        dir: settings.remoteDir || "~",
      },
    ],
    remoteHost: "",
    remoteUser: "",
  });
  if (password) {
    writeSecrets({ remoteSshPasswords: { [id]: password }, remoteSshPassword: "" });
  }
}

function savedPassword(id: string): string {
  const secrets = readSecrets();
  const mapped = secrets.remoteSshPasswords?.[id]?.trim();
  if (mapped) return mapped;
  const settings = readSettings();
  const legacyId =
    settings.remoteUser && settings.remoteHost
      ? remoteServerId(settings.remoteUser, settings.remoteHost)
      : "";
  if (id && id === legacyId) return secrets.remoteSshPassword?.trim() || "";
  return "";
}

function publicServers(): RemoteServerPublic[] {
  const secrets = readSecrets();
  return readServerList().map((s) => ({
    id: s.id,
    host: s.host,
    user: s.user,
    dir: s.dir,
    hasPassword: Boolean(secrets.remoteSshPasswords?.[s.id]?.trim() || savedPassword(s.id)),
  }));
}

export function remoteStatus(): RemotePublicStatus {
  migrateLegacy();
  const settings = readSettings();
  const state = hub();
  const live = state.live;
  const servers = publicServers();
  const serverId = live ? remoteServerId(live.user, live.host) : "";
  const current = servers.find((s) => s.id === serverId);
  return {
    connected: Boolean(live),
    connecting: state.connecting,
    host: live?.host || "",
    user: live?.user || "",
    dir: current?.dir || settings.remoteDir || "~",
    serverId,
    servers,
    saveLogin: Boolean(current?.hasPassword),
    hasSavedPassword: servers.some((s) => s.hasPassword),
    error: state.error,
    detail: state.detail,
    codiumReady: Boolean(live?.codiumUrl),
    codiumUrl: live?.codiumUrl || "",
    codiumError: live?.codiumError || "",
  };
}

/** Remember a folder for the connected server. Unknown servers keep it only in settings. */
export function setRemoteDir(dir: string): void {
  const folder = dir.trim() || "~";
  const live = hub().live;
  const servers = readServerList();
  if (live) {
    const id = remoteServerId(live.user, live.host);
    writeSettings({
      remoteDir: folder,
      remoteServers: servers.map((s) => (s.id === id ? { ...s, dir: folder } : s)),
    });
    return;
  }
  writeSettings({ remoteDir: folder });
}

export function remoteExecArgs(remoteCommand: string): { bin: string; args: string[] } | null {
  const live = hub().live;
  if (!live) return null;
  return {
    bin: "ssh",
    args: [
      "-tt",
      ...sshBaseArgs({ knownHosts: live.knownHosts, identity: live.keyPath }),
      `${live.user}@${live.host}`,
      remoteCommand,
    ],
  };
}

function redact(text: string, secrets: string[]): string {
  let out = stripAnsi(text);
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("••••");
  }
  return out.slice(-600);
}

function killPty(term: pty.IPty | null): void {
  if (!term) return;
  try {
    term.kill();
  } catch {
    /* already gone */
  }
}

async function cleanup(live: Live | null): Promise<void> {
  if (!live) return;
  killPty(live.codium);
  if (live.tunnel) {
    try {
      live.tunnel.kill();
    } catch {
      /* already gone */
    }
  }
  live.proxy?.close();
  if (live.keyPath && fs.existsSync(live.keyPath)) {
    const remove = spawnSync(
      "ssh",
      [
        "-T",
        ...sshBaseArgs({ knownHosts: live.knownHosts, identity: live.keyPath }),
        `${live.user}@${live.host}`,
        "touch ~/.ssh/authorized_keys; grep -v ccc-control-center ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.ccc || true; mv ~/.ssh/authorized_keys.ccc ~/.ssh/authorized_keys",
      ],
      { timeout: 8000 },
    );
    void remove;
  }
  killPty(live.login);
  fs.rmSync(live.dir, { recursive: true, force: true });
}

async function stopRemoteClis(): Promise<void> {
  const { listPtySessions, killPtySession } = await import("./claude-pty");
  for (const session of listPtySessions()) {
    if (session.where === "remote") killPtySession(session.id);
  }
}

export async function disconnectRemote(): Promise<void> {
  const state = hub();
  state.gen += 1;
  state.connecting = false;
  state.error = "";
  state.detail = "";
  const live = state.live;
  state.live = null;
  await stopRemoteClis();
  await cleanup(live);
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error("SSH-Tunnel steht nicht."));
        else setTimeout(tick, 200);
      });
    };
    tick();
  });
}

function rememberLogin(input: {
  user: string;
  host: string;
  password: string;
  saveLogin: boolean;
  dir: string;
}): void {
  const id = remoteServerId(input.user, input.host);
  const dir = input.dir.trim() || "~";
  const servers = readServerList().filter((s) => s.id !== id);
  if (input.saveLogin) servers.unshift({ id, host: input.host, user: input.user, dir });
  writeSettings({
    remoteDir: dir,
    remoteSaveLogin: input.saveLogin,
    remoteHost: "",
    remoteUser: "",
    remoteServers: servers,
  });
  writeSecrets({
    remoteSshPassword: "",
    remoteSshPasswords: { [id]: input.saveLogin ? input.password : "" },
  });
}

export async function connectRemote(input: {
  host: string;
  user: string;
  password: string;
  otp: string;
  saveLogin: boolean;
  dir: string;
}): Promise<RemotePublicStatus> {
  if (hub().connecting || hub().live) return remoteStatus();
  migrateLegacy();
  const target = parseLoginTarget(input.host, input.user);
  if ("error" in target) {
    hub().error = target.error;
    return remoteStatus();
  }
  const password =
    input.password.trim() ||
    (input.saveLogin ? savedPassword(remoteServerId(target.user, target.host)) : "");
  if (!password) {
    hub().error = "Passwort fehlt.";
    return remoteStatus();
  }
  const otp = input.otp.trim();
  const state = hub();
  const my = (state.gen += 1);
  state.connecting = true;
  state.error = "";
  state.detail = "";
  const previous = state.live;
  state.live = null;
  await cleanup(previous);

  const dir = fs.mkdtempSync(remoteKeyPrefix());
  const keyPath = path.join(dir, "id_ed25519");
  const knownHosts = path.join(dir, "known_hosts");
  const generated = spawnSync(
    "ssh-keygen",
    ["-t", "ed25519", "-f", keyPath, "-N", "", "-q", "-C", "ccc-control-center"],
    { timeout: 10000 },
  );
  if (generated.status !== 0) {
    fs.rmSync(dir, { recursive: true, force: true });
    state.connecting = false;
    state.error = "ssh-keygen fehlt. OpenSSH muss installiert sein.";
    return remoteStatus();
  }
  const pubkey = fs.readFileSync(`${keyPath}.pub`, "utf8").trim();
  const live: Live = {
    dir,
    user: target.user,
    host: target.host,
    keyPath,
    knownHosts,
    login: null,
    codium: null,
    tunnel: null,
    proxy: null,
    codiumUrl: "",
    codiumError: "",
  };

  let transcript = "";
  let passwordSent = false;
  let otpSent = false;
  let hostkeySent = false;
  let stage: "auth" | "probe" | "key" = "auth";
  let probes = 0;

  const fail = (message: string) => {
    state.connecting = false;
    state.error = message;
    state.detail = redact(transcript, [password, otp]);
    void cleanup(live);
  };

  try {
    live.login = pty.spawn(
      "ssh",
      ["-tt", ...sshBaseArgs({ knownHosts }), `${target.user}@${target.host}`],
      {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: spawnHome(),
        env: process.env as Record<string, string>,
      },
    );
  } catch (err) {
    fail(`ssh konnte nicht gestartet werden: ${(err as Error).message}`);
    return remoteStatus();
  }

  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Zeitüberschreitung bei der Anmeldung.")), 45000);
    const finish = (err?: Error) => {
      clearTimeout(timer);
      clearInterval(probeTimer);
      if (err) reject(err);
      else resolve();
    };
    const probeTimer = setInterval(() => {
      if (my !== hub().gen || stage !== "probe" || !live.login) return;
      probes += 1;
      if (probes > 6) {
        finish(new Error("Keine Shell nach der Anmeldung. 2FA oder Passwort prüfen."));
        return;
      }
      live.login.write("printf 'CCC_READY_%s\\n' ok\n");
    }, 1500);

    live.login!.onData((chunk) => {
      transcript += chunk;
      if (transcript.length > 20000) transcript = transcript.slice(-20000);
      // The typed command must not contain the success marker, or the echo
      // of the keystrokes would look like the shell already answered.
      if (stage === "probe" && transcript.includes("CCC_READY_ok")) {
        stage = "key";
        const install = `umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; chmod 700 ~/.ssh; grep -q ccc-control-center ~/.ssh/authorized_keys || printf '%s\\n' ${shellQuote(pubkey)} >> ~/.ssh/authorized_keys; chmod 600 ~/.ssh/authorized_keys; printf 'CCC_KEY_%s\\n' OK\n`;
        live.login?.write(install);
        return;
      }
      if (stage === "key" && transcript.includes("CCC_KEY_OK")) {
        finish();
        return;
      }
      const kind = classifySshTail(transcript);
      if (kind === "hostkey" && !hostkeySent) {
        hostkeySent = true;
        live.login?.write("yes\n");
        return;
      }
      if (kind === "denied") {
        finish(new Error("Anmeldung abgelehnt."));
        return;
      }
      if (kind === "password" && stage === "auth") {
        if (passwordSent) {
          finish(new Error("Passwort abgelehnt."));
          return;
        }
        passwordSent = true;
        live.login?.write(`${password}\n`);
        setTimeout(() => {
          if (stage !== "auth" || otpSent) return;
          const now = classifySshTail(transcript);
          if (now === "otp" || now === "password" || now === "hostkey") return;
          stage = "probe";
        }, 2200);
        return;
      }
      if (kind === "otp" && !otpSent) {
        if (!otp) {
          finish(new Error("Der Server verlangt einen 2FA-Code."));
          return;
        }
        otpSent = true;
        stage = "auth";
        live.login?.write(`${otp}\n`);
        setTimeout(() => {
          if (stage === "auth") stage = "probe";
        }, 900);
      }
    });
    live.login!.onExit(() => {
      if (stage !== "key") finish(new Error("ssh wurde vor der Anmeldung beendet."));
    });
  });

  try {
    await done;
  } catch (err) {
    if (my === hub().gen) fail((err as Error).message);
    return remoteStatus();
  }
  if (my !== hub().gen) {
    await cleanup(live);
    return remoteStatus();
  }

  state.live = live;
  state.connecting = false;
  state.error = "";
  rememberLogin({ ...input, password, user: target.user, host: target.host });
  void startCodium(my).catch(() => {});
  return remoteStatus();
}

async function startCodium(gen: number): Promise<void> {
  const live = hub().live;
  if (!live || gen !== hub().gen) return;
  const remotePort = 43000 + Math.floor(Math.random() * 800);
  const script = buildCodiumRemoteScript(remotePort);
  let output = "";
  // One remote argv. `bash -s` would wait for stdin EOF, which a PTY never sends.
  const term = pty.spawn(
    "ssh",
    [
      "-T",
      ...sshBaseArgs({ knownHosts: live.knownHosts, identity: live.keyPath }),
      `${live.user}@${live.host}`,
      `bash -c ${shellQuote(script)}`,
    ],
    {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: spawnHome(),
      env: process.env as Record<string, string>,
    },
  );
  live.codium = term;
  const found = await new Promise<{ port: number; path: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("VS Codium hat nicht geantwortet.")), 30000);
    term.onData((chunk) => {
      output += chunk;
      const parsed = parseCodiumOutput(output);
      if (parsed.missing) {
        clearTimeout(timer);
        reject(new Error("Auf dem Server fehlt VS Codium (`codium` oder `code serve-web`)."));
        return;
      }
      if (parsed.ready && parsed.port) {
        clearTimeout(timer);
        resolve({ port: parsed.port, path: parsed.path });
      }
    });
    term.onExit(() => {
      clearTimeout(timer);
      reject(new Error("VS Codium auf dem Server wurde beendet."));
    });
  }).catch((err: Error) => {
    if (hub().live === live) live.codiumError = err.message;
    return null;
  });
  if (!found || hub().live !== live || gen !== hub().gen) return;

  const localTunnel = await freePort();
  const tunnel = spawn(
    "ssh",
    [
      "-N",
      "-L",
      `127.0.0.1:${localTunnel}:127.0.0.1:${found.port}`,
      ...sshBaseArgs({ knownHosts: live.knownHosts, identity: live.keyPath }),
      `${live.user}@${live.host}`,
    ],
    { stdio: "ignore" },
  );
  live.tunnel = tunnel;
  try {
    await waitForPort(localTunnel, 10000);
    live.proxy = await startCodiumProxy(localTunnel);
    const pathPart = found.path.startsWith("/") ? found.path : `/${found.path}`;
    live.codiumUrl = `http://127.0.0.1:${live.proxy.port}${pathPart}`;
    live.codiumError = "";
  } catch (err) {
    live.codiumError = (err as Error).message;
  }
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

export async function retryCodium(): Promise<RemotePublicStatus> {
  const state = hub();
  if (!state.live) {
    state.error = "Nicht mit dem Server verbunden.";
    return remoteStatus();
  }
  killPty(state.live.codium);
  state.live.codium = null;
  if (state.live.tunnel) {
    try {
      state.live.tunnel.kill();
    } catch {
      /* already gone */
    }
    state.live.tunnel = null;
  }
  state.live.proxy?.close();
  state.live.proxy = null;
  state.live.codiumUrl = "";
  state.live.codiumError = "";
  void startCodium(state.gen).catch(() => {});
  return remoteStatus();
}
