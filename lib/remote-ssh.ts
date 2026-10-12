/**
 * Pure helpers for the remote SSH login. The actual `ssh` process lives in
 * lib/server/remote-session.ts. Nothing here reads a password from disk or
 * spawns a process — the command line is built as argv, and the password is
 * written to the PTY only when ssh asks for it.
 */

import type { CodeCliId } from "./code-clis";

const USER_RE = /^[a-zA-Z_][a-zA-Z0-9._-]{0,31}$/;

export type SshPrompt = "password" | "otp" | "denied" | "hostkey" | null;

/** One saved server. The password is never part of this object. */
export interface RemoteServerPublic {
  id: string;
  host: string;
  user: string;
  dir: string;
  hasPassword: boolean;
}

/** Browser-safe status. Never includes the password or the 2FA code. */
export interface RemotePublicStatus {
  connected: boolean;
  connecting: boolean;
  host: string;
  user: string;
  dir: string;
  /** Id of the server that is connected right now, otherwise empty. */
  serverId: string;
  servers: RemoteServerPublic[];
  saveLogin: boolean;
  hasSavedPassword: boolean;
  error: string;
  detail: string;
  /** True while the ssh process is waiting because it asked for the password. */
  needsPassword: boolean;
  /** True while ssh is waiting because the server asked for a 2FA code. */
  needsOtp: boolean;
}

/** Stable id for a saved server. Host and user are already validated. */
export function remoteServerId(user: string, host: string): string {
  return `${user}@${host}`;
}

export function stripAnsi(value: string): string {
  return value
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
}

/** What the latest ssh prompt is asking for, if anything. */
export function classifySshTail(raw: string): SshPrompt {
  const text = stripAnsi(raw).replace(/\r/g, "");
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines.slice(-4).join("\n");
  if (/permission denied|authentication failures|too many authentication failures|connection closed|connection reset/i.test(last)) {
    return "denied";
  }
  if (/are you sure you want to continue connecting|please type 'yes'|fingerprint/i.test(last) && /yes\/no/i.test(last)) {
    return "hostkey";
  }
  if (/verification code|one-time|authenticator|two[- ]factor|\botp\b|passcode|\b2fa\b/i.test(last)) {
    return "otp";
  }
  if (/password\s*:\s*$/i.test(last)) return "password";
  return null;
}

export function parseLoginTarget(
  rawHost: string,
  rawUser: string,
): { user: string; host: string } | { error: string } {
  let host = rawHost.trim();
  let user = rawUser.trim();
  const at = host.lastIndexOf("@");
  if (at > 0) {
    const left = host.slice(0, at).trim();
    const right = host.slice(at + 1).trim();
    if (!user && left) user = left;
    host = right;
  }
  if (!user) return { error: "Benutzer fehlt." };
  if (!USER_RE.test(user)) return { error: "Benutzer enthält ungültige Zeichen." };
  if (!host || host.startsWith("-") || /[\s'"]/.test(host)) return { error: "IP ist ungültig." };
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    const ok = host.split(".").every((part) => Number(part) <= 255);
    if (!ok) return { error: "IP ist ungültig." };
    return { user, host };
  }
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(host)) {
    return { error: "IP ist ungültig." };
  }
  return { user, host };
}

/** POSIX single quotes. The remote shell is bash-compatible; argv stays local. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function cdPrefix(cwd: string): string {
  const dir = cwd.trim();
  if (!dir || dir === "~") return "";
  if (dir.startsWith("~/")) return `cd "$HOME"/${shellQuote(dir.slice(2))} && `;
  return `cd ${shellQuote(dir)} && `;
}

/**
 * One remote shell command: cd into the server folder and exec the code CLI.
 * Claude's update check is skipped on the server the same way as locally.
 */
export function buildRemoteCliCommand(opts: {
  cwd: string;
  bin: string;
  args: string[];
  cli: CodeCliId;
}): string {
  const env =
    opts.cli === "claude"
      ? "DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 "
      : "";
  const argv = [opts.bin, ...opts.args].map(shellQuote).join(" ");
  const locale = "export LANG=C.UTF-8 LC_ALL=C.UTF-8 TERM=xterm-256color COLORTERM=truecolor; ";
  return `${locale}${cdPrefix(opts.cwd)}${env}exec ${argv}`;
}

/** Remote script that starts VS Codium's web UI on loopback only. */
export function buildCodiumRemoteScript(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("bad codium port");
  }
  return [
    "BIN=$(command -v codium || command -v code || true)",
    'if [ -z "$BIN" ]; then echo CCC_CODIUM_MISSING; exit 1; fi',
    'HELP=$("$BIN" serve-web --help 2>&1 || true)',
    "case \"$HELP\" in",
    "  *serve-web*) ;;",
    "  *) echo CCC_CODIUM_MISSING; exit 1 ;;",
    "esac",
    `ARGS="--host 127.0.0.1 --port ${port}"`,
    'case "$HELP" in *without-connection-token*) ARGS="$ARGS --without-connection-token" ;; esac',
    'case "$HELP" in *accept-server-license-terms*) ARGS="$ARGS --accept-server-license-terms" ;; esac',
    `echo CCC_CODIUM_PORT ${port}`,
    'exec "$BIN" serve-web $ARGS',
  ].join("\n");
}

export function parseCodiumOutput(raw: string): {
  missing: boolean;
  /** True once serve-web has printed a URL, not merely the port we asked for. */
  ready: boolean;
  port: number | null;
  path: string;
} {
  const text = stripAnsi(raw);
  if (text.includes("CCC_CODIUM_MISSING")) {
    return { missing: true, ready: false, port: null, path: "/" };
  }
  const url = text.match(/https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0):(\d+)([^\s]*)/);
  if (!url) return { missing: false, ready: false, port: null, path: "/" };
  const path = url[2] && url[2].startsWith("/") ? url[2] : "/";
  return { missing: false, ready: true, port: Number(url[1]), path };
}

/** Flags for `codium`/`code serve-web` on loopback. Only adds options the help text lists. */
export function codiumServeArgs(help: string, port: number): string[] {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("bad codium port");
  }
  const args = ["serve-web", "--host", "127.0.0.1", "--port", String(port)];
  if (help.includes("without-connection-token")) args.push("--without-connection-token");
  if (help.includes("accept-server-license-terms")) args.push("--accept-server-license-terms");
  return args;
}

export function nullDevice(): string {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

/** Shared ssh options. No password, no ControlMaster (Windows OpenSSH has none). */
export function sshBaseArgs(opts: { knownHosts: string; identity?: string }): string[] {
  const args = [
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    `UserKnownHostsFile=${opts.knownHosts}`,
    "-o",
    `GlobalKnownHostsFile=${nullDevice()}`,
    "-o",
    "NumberOfPasswordPrompts=1",
    "-o",
    "ConnectTimeout=20",
  ];
  if (opts.identity) {
    args.push(
      "-i",
      opts.identity,
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "BatchMode=yes",
      "-o",
      "PreferredAuthentications=publickey",
    );
  } else {
    args.push(
      "-o",
      "PubkeyAuthentication=no",
      "-o",
      "PreferredAuthentications=keyboard-interactive,password",
    );
  }
  return args;
}
