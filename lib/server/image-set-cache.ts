import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { imageMime, isImageSetFolder } from "../remote-upload-flow";
import { dataPath } from "../store";

export interface CachedImage {
  name: string;
  path: string;
  size: number;
}

/** Local copies of uploaded image sets. Opening a set reads these, not the server. */
export function imageSetCacheRoot(): string {
  return dataPath("image-sets");
}

export function safeImageFileName(name: string): string | null {
  const base = name.trim();
  if (!base || base === "." || base === ".." || base.includes("/") || base.includes("\\") || base.includes("\0")) {
    return null;
  }
  if (imageMime(base) === null) return null;
  return base;
}

function setDir(name: string, root = imageSetCacheRoot()): string {
  if (!isImageSetFolder(name)) throw new Error("Nur Bildordner.");
  const dir = path.resolve(root, name);
  const rel = path.relative(path.resolve(root), dir);
  if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || rel.includes(path.sep)) {
    throw new Error("Nur Bildordner.");
  }
  return dir;
}

function fileDest(name: string, fileName: string, root?: string): string {
  const base = safeImageFileName(fileName);
  if (!base) throw new Error("Dateiname ungültig.");
  return path.join(setDir(name, root), base);
}

async function replaceSymlink(dest: string): Promise<void> {
  try {
    const st = await fs.promises.lstat(dest);
    if (st.isSymbolicLink()) await fs.promises.unlink(dest);
  } catch {
    // The file is not there yet.
  }
}

export async function saveImageSetBytes(options: {
  name: string;
  fileName: string;
  body: AsyncIterable<Buffer | Uint8Array | string> | Iterable<Buffer | Uint8Array | string>;
  length: number;
  root?: string;
}): Promise<string> {
  if (!Number.isInteger(options.length) || options.length < 0) throw new Error("Länge fehlt.");
  const dest = fileDest(options.name, options.fileName, options.root);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await replaceSymlink(dest);
  const out = fs.createWriteStream(dest);
  let left = options.length;
  try {
    for await (const chunk of options.body) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      left -= buf.length;
      if (left < 0) throw new Error("Übertragung unvollständig.");
      if (buf.length === 0) continue;
      if (!out.write(buf)) await once(out, "drain");
    }
    if (left !== 0) throw new Error("Übertragung unvollständig.");
    out.end();
    await once(out, "finish");
  } catch (err) {
    out.destroy();
    await fs.promises.rm(dest, { force: true }).catch(() => {});
    throw err;
  }
  return dest;
}

/** Copy a file that is already on this PC. Symlinks are refused. */
export async function saveImageSetFile(name: string, fileName: string, source: string, root?: string): Promise<string> {
  const dest = fileDest(name, fileName, root);
  const st = await fs.promises.lstat(source);
  if (st.isSymbolicLink() || !st.isFile()) throw new Error("Datei fehlt.");
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await replaceSymlink(dest);
  await fs.promises.copyFile(source, dest);
  return dest;
}

export async function listImageSetCache(name: string, root?: string): Promise<CachedImage[]> {
  const dir = setDir(name, root);
  let names: string[] = [];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return [];
  }
  const images: CachedImage[] = [];
  for (const entry of names) {
    const base = safeImageFileName(entry);
    if (!base) continue;
    const full = path.join(dir, base);
    try {
      const st = await fs.promises.lstat(full);
      if (st.isSymbolicLink() || !st.isFile()) continue;
      images.push({ name: base, path: full, size: st.size });
    } catch {
      // Skip a file that vanished while listing.
    }
  }
  images.sort((a, b) => a.name.localeCompare(b.name));
  return images;
}

export async function removeImageSetCache(name: string, root?: string): Promise<void> {
  await fs.promises.rm(setDir(name, root), { recursive: true, force: true });
}
