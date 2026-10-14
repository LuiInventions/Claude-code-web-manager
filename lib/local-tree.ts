import fs from "node:fs/promises";
import path from "node:path";

export interface ExpandedItem {
  rel: string;
  size: number;
  dir?: boolean;
  source: string;
}

const MAX_ENTRIES = 100_000;

/**
 * Turn dropped or picked paths into upload entries.
 * A directory keeps its own name and includes every nested file.
 * Symlinks are skipped so a link cannot pull in another tree.
 */
export async function expandDroppedPaths(inputs: readonly string[]): Promise<ExpandedItem[]> {
  const items: ExpandedItem[] = [];
  const seen = new Set<string>();
  let failed = 0;
  for (const input of inputs) {
    if (!input.trim()) continue;
    const abs = path.resolve(input);
    let st: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      st = await fs.lstat(abs);
    } catch {
      failed += 1;
      continue;
    }
    if (st.isSymbolicLink()) continue;
    const base = path.basename(abs) || "Ordner";
    if (st.isDirectory()) await walkDir(abs, base, items, seen);
    else if (st.isFile()) items.push({ rel: base.replace(/\\/g, "/"), size: st.size, source: abs });
  }
  if (items.length === 0) {
    throw new Error(failed > 0 ? "Ordner konnte nicht gelesen werden." : "Nichts zum Hochladen.");
  }
  return items;
}

async function walkDir(dir: string, rel: string, items: ExpandedItem[], seen: Set<string>): Promise<void> {
  let real = dir;
  try {
    real = await fs.realpath(dir);
  } catch {
    throw new Error("Ordner konnte nicht gelesen werden.");
  }
  if (seen.has(real)) return;
  seen.add(real);
  items.push({ rel, size: 0, dir: true, source: dir });
  let dirents: { name: string; isSymbolicLink: () => boolean; isDirectory: () => boolean; isFile: () => boolean }[];
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    throw new Error("Ordner konnte nicht gelesen werden.");
  }
  for (const ent of dirents) {
    if (items.length > MAX_ENTRIES) throw new Error("Zu viele Dateien.");
    if (ent.isSymbolicLink()) continue;
    const name = ent.name.toString();
    const full = path.join(dir, name);
    const child = `${rel}/${name}`;
    if (ent.isDirectory()) await walkDir(full, child, items, seen);
    else if (ent.isFile()) {
      const st = await fs.lstat(full);
      items.push({ rel: child, size: st.size, source: full });
    }
  }
}
