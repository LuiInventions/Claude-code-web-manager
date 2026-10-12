import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as pty from "node-pty";
import type { WebSocket } from "ws";
import { readSettings, writeSettings, type RemoteServerRecord } from "../settings";
import { readSecrets, writeSecrets } from "../secrets";
import {
  classifySshTail,
  parseLoginTarget,
  remoteServerId,
  shellQuote,
  sshBaseArgs,
  stripAnsi,
  type RemotePublicStatus,
  type RemoteServerPublic,
} from "../remote-ssh";
import { resolveSshTools } from "./ssh-bin";

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

/** node-pty also reports "File not found" when cwd does not exist. */
function existingCwd(): string {
  const home = spawnHome();
  if (home && home !== "." && fs.existsSync(home)) return home;
  if (fs.existsSync(process.cwd())) return process.cwd();
  const tmp = process.env.TMPDIR || process.env.TEMP || process.env.TMP || "";
  if (tmp && fs.existsSync(tmp)) return tmp;
  return process.cwd();
}

export type { RemotePublicStatus };

/**
 * One SSH login for the whole app.
 *
 * Windows OpenSSH cannot share a connection with ControlMaster, and a 2FA code
 * only works once. The first `ssh` is a real terminal. The password and the
 * 2FA code are written only after that process prints the matching prompt.
 * After the shell answers, a throwaway key is installed and every later CLI
 * is `ssh -i` that key. Disconnect deletes the key. The 2FA code is never stored.
 */

interface Live {
  dir: string;
  user: string;
  host: string;
  keyPath: string;
  knownHosts: string;
  sshBin: string;
  login: pty.IPty | null;
}

interface PendingSave {
  saveLogin: boolean;
  password: string;
  dir: string;
}

const g = globalThis as unknown as {
  __cccRemote?: {
    gen: number;
    connecting: boolean;
    needsOtp: boolean;
    needsPassword: boolean;
    error: string;
    detail: string;
    live: Live | null;
    /** Login still in progress. Not the remote working directory. */
    pending: Live | null;
    loginPty: pty.IPty | null;
    otpWait: ((code: string | null) => void) | null;
    passwordWait: ((code: string | null) => void) | null;
    pendingId: string;
    pendingDir: string;
    pendingSave: PendingSave | null;
    secrets: string[];
    view: string;
    viewers: Set<(chunk: string) => void>;
  };
};

function hub() {
  const cur = (g.__cccRemote ??= {
    gen: 0,
    connecting: false,
    needsOtp: false,
    needsPassword: false,
    error: "",
    detail: "",
    live: null,
    pending: null,
    loginPty: null,
    otpWait: null,
    passwordWait: null,
    pendingId: "",
    pendingDir: "~",
    pendingSave: null,
    secrets: [],
    view: "",
    viewers: new Set<(chunk: string) => void>(),
  });
  cur.needsPassword ??= false;
  cur.pending ??= null;
  cur.loginPty ??= null;
  cur.passwordWait ??= null;
  cur.pendingId ??= "";
  cur.pendingDir ??= "~";
  cur.pendingSave ??= null;
  cur.secrets ??= [];
  cur.view ??= "";
  cur.viewers ??= new Set();
  return cur;
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
  return readServerList().map((s) => ({
    id: s.id,
    host: s.host,
    user: s.user,
    dir: s.dir,
    hasPassword: Boolean(savedPassword(s.id)),
  }));
}

export function remoteStatus(): RemotePublicStatus {
  migrateLegacy();
  const settings = readSettings();
  const state = hub();
  const live = state.live;
  const active = live || state.pending;
  const servers = publicServers();
  const serverId = active ? remoteServerId(active.user, active.host) : "";
  const current = servers.find((s) => s.id === serverId);
  return {
    connected: Boolean(live),
    connecting: state.connecting,
    host: active?.host || "",
    user: active?.user || "",
    dir: current?.dir || (state.connecting ? state.pendingDir : "") || settings.remoteDir || "~",
    serverId,
    servers,
    saveLogin: Boolean(current?.hasPassword),
    hasSavedPassword: servers.some((s) => s.hasPassword),
    error: state.error,
    detail: state.detail,
    needsPassword: state.needsPassword,
    needsOtp: state.needsOtp,
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
    bin: live.sshBin,
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

function redactChunk(chunk: string): string {
  let out = chunk;
  for (const secret of hub().secrets) {
    if (secret) out = out.split(secret).join("••••");
  }
  return out;
}

function addSecret(secret: string): void {
  const trimmed = secret.trim();
  if (!trimmed) return;
  const state = hub();
  state.secrets.push(trimmed);
  if (state.view.includes(trimmed)) state.view = state.view.split(trimmed).join("••••");
}

function resetLoginView(): void {
  const state = hub();
  state.view = "";
  state.secrets = [];
  const clear = "\x1b[2J\x1b[H";
  for (const fn of state.viewers) fn(clear);
}

function pushView(chunk: string): void {
  const safe = redactChunk(chunk);
  const state = hub();
  state.view += safe;
  if (state.view.length > 120000) state.view = state.view.slice(-80000);
  for (const fn of state.viewers) fn(safe);
}

export function remoteLoginSnapshot(): string {
  return hub().view;
}

export function subscribeRemoteLogin(fn: (chunk: string) => void): () => void {
  const state = hub();
  state.viewers.add(fn);
  return () => state.viewers.delete(fn);
}

export function resizeRemoteLogin(cols: number, rows: number): void {
  const term = hub().loginPty;
  if (!term) return;
  try {
    term.resize(Math.max(2, Math.min(500, cols)), Math.max(1, Math.min(200, rows)));
  } catch {
    /* pty already closed */
  }
}

/** Read-only view of the login PTY. Keystrokes are not forwarded. */
export function handleRemoteLoginWs(ws: WebSocket): void {
  const snap = remoteLoginSnapshot();
  if (snap && ws.readyState === ws.OPEN) ws.send(snap);
  const unsub = subscribeRemoteLogin((chunk) => {
    if (ws.readyState === ws.OPEN) ws.send(chunk);
  });
  const stop = () => unsub();
  ws.on("close", stop);
  ws.on("error", stop);
  ws.on("message", (data) => {
    let msg: { t?: string; c?: number; r?: number };
    try {
      msg = JSON.parse(data.toString()) as { t?: string; c?: number; r?: number };
    } catch {
      return;
    }
    if (msg.t === "resize" && typeof msg.c === "number" && typeof msg.r === "number") {
      resizeRemoteLogin(msg.c, msg.r);
    }
  });
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
  if (live.keyPath && fs.existsSync(live.keyPath)) {
    const remove = spawnSync(
      live.sshBin,
      [
        "-T",
        ...sshBaseArgs({ knownHosts: live.knownHosts, identity: live.keyPath }),
        `${live.user}@${live.host}`,
        "touch ~/.ssh/authorized_keys; grep -v ccc-control-center ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.ccc || true; mv ~/.ssh/authorized_keys.ccc ~/.ssh/authorized_keys",
      ],
      { timeout: 8000, cwd: existingCwd() },
    );
    void remove;
  }
  if (hub().loginPty === live.login) hub().loginPty = null;
  killPty(live.login);
  live.login = null;
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
  state.needsOtp = false;
  state.needsPassword = false;
  state.error = "";
  state.detail = "";
  state.pendingSave = null;
  const otp = state.otpWait;
  const password = state.passwordWait;
  state.otpWait = null;
  state.passwordWait = null;
  otp?.(null);
  password?.(null);
  const pending = state.pending;
  const live = state.live;
  state.pending = null;
  state.live = null;
  state.loginPty = null;
  pushView("\r\nVerbindung getrennt.\r\n");
  await stopRemoteClis();
  if (pending && pending !== live) await cleanup(pending);
  await cleanup(live);
}

/** The server asked for a code. Called only after ssh has already checked the password. */
export function submitRemoteOtp(code: string): RemotePublicStatus {
  const state = hub();
  const trimmed = code.trim();
  if (!state.needsOtp || !state.otpWait) {
    state.error = "Es wird gerade kein 2FA-Code verlangt.";
    return remoteStatus();
  }
  if (!trimmed) {
    state.error = "2FA-Code fehlt.";
    return remoteStatus();
  }
  state.error = "";
  state.needsOtp = false;
  const wait = state.otpWait;
  state.otpWait = null;
  wait(trimmed);
  return remoteStatus();
}

/**
 * The ssh process asked for a password. Empty plus `useSaved` uses the stored
 * password. The value is written to the PTY and is not returned to the client.
 */
export function submitRemotePassword(input: {
  password: string;
  saveLogin: boolean;
  useSaved: boolean;
}): RemotePublicStatus {
  const state = hub();
  if (!state.needsPassword || !state.passwordWait) {
    state.error = "Es wird gerade kein Passwort verlangt.";
    return remoteStatus();
  }
  let password = input.password;
  if (!password && input.useSaved) password = savedPassword(state.pendingId);
  if (!password) {
    state.error = "Passwort fehlt.";
    return remoteStatus();
  }
  state.pendingSave = {
    saveLogin: input.saveLogin,
    password,
    dir: state.pendingDir || "~",
  };
  state.error = "";
  state.needsPassword = false;
  const wait = state.passwordWait;
  state.passwordWait = null;
  wait(password);
  return remoteStatus();
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

/**
 * Start `ssh user@host` and return while it is still connecting.
 * The password is not accepted here: it is submitted only after the PTY asks.
 */
export async function beginRemote(input: {
  host: string;
  user: string;
  dir: string;
}): Promise<RemotePublicStatus> {
  const state = hub();
  if (state.connecting || state.live) return remoteStatus();
  migrateLegacy();
  const target = parseLoginTarget(input.host, input.user);
  if ("error" in target) {
    state.error = target.error;
    return remoteStatus();
  }
  const tools = resolveSshTools();
  if (!tools) {
    state.error = "OpenSSH fehlt. ssh.exe wurde nicht gefunden.";
    return remoteStatus();
  }
  if (!tools.keygen || !fs.existsSync(tools.keygen)) {
    state.error = "ssh-keygen fehlt. OpenSSH muss installiert sein.";
    return remoteStatus();
  }

  const my = (state.gen += 1);
  state.connecting = true;
  state.needsOtp = false;
  state.needsPassword = false;
  state.otpWait = null;
  state.passwordWait = null;
  state.error = "";
  state.detail = "";
  state.pendingId = remoteServerId(target.user, target.host);
  state.pendingDir = input.dir.trim() || "~";
  state.pendingSave = null;
  const previous = state.live;
  state.live = null;
  await cleanup(previous);
  if (my !== hub().gen) return remoteStatus();

  resetLoginView();
  const dir = fs.mkdtempSync(remoteKeyPrefix());
  const keyPath = path.join(dir, "id_ed25519");
  const knownHosts = path.join(dir, "known_hosts");
  const generated = spawnSync(
    tools.keygen,
    ["-t", "ed25519", "-f", keyPath, "-N", "", "-q", "-C", "ccc-control-center"],
    { timeout: 10000, cwd: existingCwd() },
  );
  if (generated.error || generated.status !== 0) {
    fs.rmSync(dir, { recursive: true, force: true });
    if (my !== hub().gen) return remoteStatus();
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
    sshBin: tools.ssh,
    login: null,
  };

  try {
    live.login = pty.spawn(
      tools.ssh,
      ["-tt", ...sshBaseArgs({ knownHosts }), `${target.user}@${target.host}`],
      {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: existingCwd(),
        env: process.env as Record<string, string>,
      },
    );
  } catch (err) {
    const message = (err as Error).message || "";
    fs.rmSync(dir, { recursive: true, force: true });
    if (my !== hub().gen) return remoteStatus();
    state.connecting = false;
    state.error = /file not found/i.test(message)
      ? `OpenSSH fehlt oder ssh ist nicht startbar (${tools.ssh}).`
      : `ssh konnte nicht gestartet werden: ${message}`;
    return remoteStatus();
  }

  state.pending = live;
  state.loginPty = live.login;
  void runAuth(my, live, pubkey);
  return remoteStatus();
}

function runAuth(my: number, live: Live, pubkey: string): void {
  const state = hub();
  let transcript = "";
  let passwordSent = false;
  let passwordQuietUntil = 0;
  let passwordHolding = false;
  let otpHolding = false;
  let otpQuietUntil = 0;
  let hostkeySent = false;
  let stage: "auth" | "probe" | "key" = "auth";
  let probes = 0;
  let settled = false;

  const fail = (message: string) => {
    const current = hub();
    if (my !== current.gen) return;
    current.connecting = false;
    current.needsOtp = false;
    current.needsPassword = false;
    current.otpWait = null;
    current.passwordWait = null;
    current.error = message;
    current.detail = redact(transcript, current.secrets);
    if (current.pending === live) current.pending = null;
    if (current.loginPty === live.login) current.loginPty = null;
    void cleanup(live);
  };

  const waitForSecret = (
    kind: "password" | "otp",
  ): Promise<string> =>
    new Promise((resolve, reject) => {
      const current = hub();
      if (kind === "password") current.needsPassword = true;
      else current.needsOtp = true;
      current.error = "";
      const timer = setTimeout(() => {
        if (kind === "password") current.needsPassword = false;
        else current.needsOtp = false;
        if (kind === "password") current.passwordWait = null;
        else current.otpWait = null;
        reject(
          new Error(
            kind === "password"
              ? "Zeitüberschreitung bei der Passwort-Eingabe."
              : "Zeitüberschreitung bei der 2FA-Eingabe.",
          ),
        );
      }, 180000);
      const accept = (code: string | null) => {
        clearTimeout(timer);
        if (kind === "password") current.needsPassword = false;
        else current.needsOtp = false;
        if (kind === "password") current.passwordWait = null;
        else current.otpWait = null;
        if (!code || my !== hub().gen) reject(new Error("Anmeldung abgebrochen."));
        else resolve(code);
      };
      if (kind === "password") current.passwordWait = accept;
      else current.otpWait = accept;
    });

  const done = new Promise<void>((resolve, reject) => {
    let timer = setTimeout(() => reject(new Error("Zeitüberschreitung bei der Anmeldung.")), 45000);
    const arm = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => reject(new Error("Zeitüberschreitung bei der Anmeldung.")), ms);
    };
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(probeTimer);
      const current = hub();
      current.needsOtp = false;
      current.needsPassword = false;
      current.otpWait = null;
      current.passwordWait = null;
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
      pushView(chunk);
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
          if (Date.now() >= passwordQuietUntil) finish(new Error("Passwort abgelehnt."));
          return;
        }
        askForPassword();
        return;
      }
      if (kind === "otp" && stage === "auth" && !otpHolding && Date.now() >= otpQuietUntil) {
        askForOtp();
      }
    });

    function askForPassword() {
      if (passwordHolding || passwordSent || stage !== "auth" || my !== hub().gen) return;
      passwordHolding = true;
      clearTimeout(timer);
      waitForSecret("password")
        .then((password) => {
          passwordHolding = false;
          if (my !== hub().gen || !live.login) return;
          addSecret(password);
          passwordSent = true;
          passwordQuietUntil = Date.now() + 2200;
          live.login.write(`${password}\n`);
          arm(45000);
          setTimeout(() => {
            if (stage !== "auth" || otpHolding || hub().needsOtp || hub().needsPassword) return;
            const now = classifySshTail(transcript);
            if (now === "otp" || now === "password" || now === "hostkey") return;
            stage = "probe";
          }, 2200);
        })
        .catch((err: Error) => finish(err));
    }

    function askForOtp() {
      if (otpHolding || stage !== "auth" || my !== hub().gen) return;
      otpHolding = true;
      clearTimeout(timer);
      waitForSecret("otp")
        .then((code) => {
          otpHolding = false;
          if (my !== hub().gen || !live.login) return;
          addSecret(code);
          otpQuietUntil = Date.now() + 1500;
          live.login.write(`${code}\n`);
          arm(45000);
          setTimeout(() => {
            if (stage !== "auth" || my !== hub().gen) return;
            const now = classifySshTail(transcript);
            if (now === "otp" || now === "password" || now === "hostkey") {
              if (now === "otp") askForOtp();
              return;
            }
            stage = "probe";
          }, 1600);
        })
        .catch((err: Error) => finish(err));
    }

    live.login!.onExit(() => {
      if (stage !== "key") finish(new Error("ssh wurde vor der Anmeldung beendet."));
      else pushView("\r\nssh beendet.\r\n");
    });
  });

  done
    .then(() => {
      const current = hub();
      if (my !== current.gen) {
        if (current.pending === live) current.pending = null;
        void cleanup(live);
        return;
      }
      current.pending = null;
      current.live = live;
      current.connecting = false;
      current.needsOtp = false;
      current.needsPassword = false;
      current.error = "";
      const save = current.pendingSave;
      if (save) {
        rememberLogin({
          user: live.user,
          host: live.host,
          password: save.password,
          saveLogin: save.saveLogin,
          dir: save.dir,
        });
      } else {
        writeSettings({ remoteDir: current.pendingDir || "~" });
      }
      current.pendingSave = null;
    })
    .catch((err: Error) => {
      if (my !== hub().gen) {
        if (hub().pending === live) hub().pending = null;
        void cleanup(live);
        return;
      }
      fail(err.message);
    });
}
