import path from "node:path";

/**
 * Path + host safety helpers. This app is intentionally powerful (full FS read,
 * arbitrary shell), so the ONLY trust boundary is the loopback bind. These
 * helpers add defense-in-depth.
 */

export function isLoopbackHost(host?: string | null): boolean {
  if (!host) return false;
  let h = host.trim().toLowerCase();
  if (h.startsWith("[")) {
    // IPv6 literal e.g. [::1]:3000
    const end = h.indexOf("]");
    h = end === -1 ? h.slice(1) : h.slice(1, end);
  } else if (h.includes(":")) {
    h = h.split(":")[0];
  }
  return h === "127.0.0.1" || h === "localhost" || h === "::1";
}

/** Normalize to an absolute, OS-correct path. */
export function normalizeAbs(p: string): string {
  return path.resolve(p);
}

/** True if `child` is the same as or nested under `parent`. */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
