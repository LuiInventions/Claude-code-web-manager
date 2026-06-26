/** Client-safe pure formatters (no Node imports — usable in browser code). */

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatRelativeTime(ms: number): string {
  if (!ms) return "";
  const diffSec = Math.round((Date.now() - ms) / 1000);
  if (diffSec < 45) return "gerade eben";
  const min = Math.round(diffSec / 60);
  if (min < 60) return `vor ${min} Min`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} Std`;
  const d = Math.round(h / 24);
  if (d < 7) return `vor ${d} ${d === 1 ? "Tag" : "Tagen"}`;
  const w = Math.round(d / 7);
  if (w < 5) return `vor ${w} Wo`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `vor ${mo} Mon`;
  const y = Math.round(d / 365);
  return `vor ${y} ${y === 1 ? "Jahr" : "Jahren"}`;
}
