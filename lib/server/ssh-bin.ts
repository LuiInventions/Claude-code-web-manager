import { execFileSync } from "node:child_process";
import fs from "node:fs";

/**
 * Absolute OpenSSH paths. node-pty on Windows reports "File not found" when
 * the file argument is a bare `ssh`: CreateProcess does not search PATHEXT,
 * and a packaged Electron app often has no OpenSSH directory on PATH.
 */

export interface SshTools {
  ssh: string;
  keygen: string;
}

/** Well-known Windows OpenSSH install folders. Sysnative covers a 32-bit process. */
export function windowsOpensshCandidates(
  env: Record<string, string | undefined>,
): SshTools[] {
  const roots = [env.SystemRoot, env.WINDIR, "C:\\Windows"].filter(
    (root): root is string => Boolean(root && root.trim()),
  );
  const seen = new Set<string>();
  const out: SshTools[] = [];
  for (const root of roots) {
    const base = root.replace(/[\\/]+$/, "");
    for (const dir of ["System32\\OpenSSH", "Sysnative\\OpenSSH"]) {
      const folder = `${base}\\${dir}`;
      const key = folder.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ssh: `${folder}\\ssh.exe`, keygen: `${folder}\\ssh-keygen.exe` });
    }
  }
  return out;
}

function lookupOnPath(name: string): string | null {
  const cmd = process.platform === "win32" ? "where.exe" : "which";
  try {
    const out = execFileSync(cmd, [name], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
    });
    for (const line of out.split(/\r?\n/)) {
      const found = line.trim();
      if (found && fs.existsSync(found)) return found;
    }
  } catch {
    /* not on PATH */
  }
  return null;
}

/** Absolute `ssh` and `ssh-keygen`, or null when OpenSSH is not installed. */
export function resolveSshTools(): SshTools | null {
  if (process.platform === "win32") {
    for (const pair of windowsOpensshCandidates(process.env)) {
      if (fs.existsSync(pair.ssh)) {
        const keygen = fs.existsSync(pair.keygen)
          ? pair.keygen
          : lookupOnPath("ssh-keygen.exe") || lookupOnPath("ssh-keygen") || pair.keygen;
        return { ssh: pair.ssh, keygen };
      }
    }
    const ssh = lookupOnPath("ssh.exe") || lookupOnPath("ssh");
    if (!ssh) return null;
    const keygen = lookupOnPath("ssh-keygen.exe") || lookupOnPath("ssh-keygen") || "";
    return { ssh, keygen };
  }
  const ssh = lookupOnPath("ssh");
  if (!ssh) return null;
  return { ssh, keygen: lookupOnPath("ssh-keygen") || "" };
}
