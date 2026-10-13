import { formatBytes } from "./format";

/** 10 GB. The remote broker uses the same ceiling. */
export const MAX_TRANSFER_BYTES = 10 * 1024 * 1024 * 1024;

export interface TransferEntry {
  rel: string;
  size: number;
  dir?: boolean;
}

export interface PlannedTransfer {
  files: { rel: string; size: number }[];
  dirs: string[];
  total: number;
}

/**
 * Relative path inside the chosen folder. Rejects `..` and NUL so a name
 * cannot leave that folder. Slashes from either platform become one posix path.
 * An empty result is the folder itself.
 */
export function remoteRelative(input: string): string | null {
  if (input.includes("\0")) return null;
  const parts: string[] = [];
  for (const part of input.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") return null;
    parts.push(part);
  }
  return parts.join("/");
}

/** Windows file names cannot contain these. The remote side keeps the original. */
export function localSegment(part: string): string {
  let name = part.replace(/[<>:"|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name += "_";
  return name || "_";
}

export function remoteBaseName(remotePath: string): string {
  const trimmed = remotePath.replace(/[\\/]+$/, "");
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const name = (slash >= 0 ? trimmed.slice(slash + 1) : trimmed).trim();
  return name || "download";
}

/** Join a relative path onto a remote directory. `~` stays for the broker. */
export function joinRemote(root: string, rel: string): string | null {
  const safe = remoteRelative(rel);
  if (!safe) return null;
  if (root === "~" || root.startsWith("~/")) return `${root.replace(/\/+$/, "")}/${safe}`;
  const base = root.replace(/\/+$/, "") || "/";
  return base === "/" ? `/${safe}` : `${base}/${safe}`;
}

interface PathApi {
  resolve: (...parts: string[]) => string;
  relative: (from: string, to: string) => string;
  isAbsolute: (p: string) => boolean;
}

/** Destination on this PC. Null when the relative path would leave `root`. */
export function localDestWith(pathApi: PathApi, root: string, rel: string): string | null {
  const safe = remoteRelative(rel);
  if (!safe) return null;
  const base = pathApi.resolve(root);
  const dest = pathApi.resolve(base, ...safe.split("/").map(localSegment));
  const out = pathApi.relative(base, dest);
  if (!out || out.startsWith("..") || pathApi.isAbsolute(out)) return null;
  return dest;
}

/** Every parent of `rel`. Remote mkdir is not recursive, so `a/b/c` needs `a` then `a/b`. */
function addParents(rel: string, dirs: Set<string>): void {
  const parts = rel.split("/");
  for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
}

export function planTransfer(entries: readonly TransferEntry[]): { ok: true; plan: PlannedTransfer } | { ok: false; error: string } {
  const files = new Map<string, number>();
  const dirs = new Set<string>();
  let total = 0;
  for (const entry of entries) {
    const rel = remoteRelative(entry.rel);
    if (rel === null) return { ok: false, error: "Dateiname ungültig." };
    if (entry.dir) {
      if (rel) {
        addParents(rel, dirs);
        dirs.add(rel);
      }
      continue;
    }
    if (!rel) return { ok: false, error: "Dateiname ungültig." };
    if (!Number.isFinite(entry.size) || entry.size < 0) return { ok: false, error: "Dateigrösse ungültig." };
    const prev = files.get(rel);
    if (prev !== undefined) total -= prev;
    if (total + entry.size > MAX_TRANSFER_BYTES) return { ok: false, error: "Maximal 10 GB." };
    files.set(rel, entry.size);
    total += entry.size;
    // A dropped folder arrives as files with a relative path, not as directory entries.
    addParents(rel, dirs);
  }
  if (files.size === 0 && dirs.size === 0) return { ok: false, error: "Nichts zum Hochladen." };
  return {
    ok: true,
    plan: {
      files: [...files].map(([rel, size]) => ({ rel, size })),
      dirs: [...dirs].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b)),
      total,
    },
  };
}

export function transferSummary(files: number, bytes: number, dirs = 0): string {
  if (files === 0 && dirs > 0) return dirs === 1 ? "1 Ordner" : `${dirs} Ordner`;
  const count = files === 1 ? "1 Datei" : `${files} Dateien`;
  return `${count} · ${formatBytes(bytes)}`;
}

export function encodePathHeader(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function decodePathHeader(value: string): string {
  const bin = atob(value);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
  return new TextDecoder().decode(bytes);
}

export function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "download";
  const star = encodeURIComponent(filename);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${star}`;
}

/** Run `fn` over `items` with at most `limit` calls in flight. Stops starting new work after the first failure. */
export async function runPool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  let failure: unknown;
  const worker = async () => {
    while (failure === undefined) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        await fn(items[index]);
      } catch (err) {
        if (failure === undefined) failure = err;
        return;
      }
    }
  };
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  if (failure !== undefined) throw failure;
}
