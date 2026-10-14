import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { isImageSetFolder } from "../remote-upload-flow";
import { localDestWith, planTransfer, remoteRelative, type TransferEntry } from "../remote-transfer";

export interface UploadSource extends TransferEntry {
  source?: string;
}

/**
 * Copy already-read local paths into `dir`. Directory entries are created.
 * A relative path that would leave `dir` is rejected.
 */
export async function writeLocalTree(options: {
  dir: string;
  items: readonly UploadSource[];
  signal?: AbortSignal;
  onProgress?: (written: number, total: number, current: string) => void;
}): Promise<{ files: number; bytes: number; dirs: number }> {
  const rootStat = await fs.promises.stat(options.dir);
  if (!rootStat.isDirectory()) throw new Error("Ziel ist kein Ordner.");
  const planned = planTransfer(options.items);
  if (!planned.ok) throw new Error(planned.error);
  const sources = new Map<string, string>();
  for (const item of options.items) {
    if (item.dir || !item.source) continue;
    const rel = remoteRelative(item.rel);
    if (rel) sources.set(rel, item.source);
  }
  for (const rel of planned.plan.dirs) {
    throwIfAborted(options.signal);
    const dest = localDestWith(path, options.dir, rel);
    if (!dest) throw new Error("Pfad ungültig.");
    await fs.promises.mkdir(dest, { recursive: true });
  }
  let written = 0;
  const total = planned.plan.total;
  options.onProgress?.(0, total, "");
  for (const file of planned.plan.files) {
    throwIfAborted(options.signal);
    const source = sources.get(file.rel);
    if (!source) throw new Error("Datei fehlt.");
    const dest = localDestWith(path, options.dir, file.rel);
    if (!dest) throw new Error("Pfad ungültig.");
    const st = await fs.promises.lstat(source);
    if (st.isSymbolicLink() || !st.isFile()) throw new Error("Datei fehlt.");
    await copyFile(source, dest, options.signal, (n) => {
      written += n;
      options.onProgress?.(Math.min(total, written), total, file.rel);
    });
  }
  options.onProgress?.(total, total, "");
  return { files: planned.plan.files.length, bytes: total, dirs: planned.plan.dirs.length };
}

/** Stream one request body into a file under `dir`. `kind: dir` only creates the folder. */
export async function writeLocalBody(options: {
  dir: string;
  rel: string;
  kind: "file" | "dir";
  body: AsyncIterable<Buffer | Uint8Array | string> | Iterable<Buffer | Uint8Array | string>;
  length: number;
  signal?: AbortSignal;
}): Promise<void> {
  const rootStat = await fs.promises.stat(options.dir);
  if (!rootStat.isDirectory()) throw new Error("Ziel ist kein Ordner.");
  const dest = localDestWith(path, options.dir, options.rel);
  if (!dest) throw new Error("Pfad ungültig.");
  if (options.kind === "dir") {
    await fs.promises.mkdir(dest, { recursive: true });
    return;
  }
  if (!Number.isInteger(options.length) || options.length < 0) throw new Error("Länge fehlt.");
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await replaceSymlink(dest);
  const out = fs.createWriteStream(dest);
  let left = options.length;
  try {
    for await (const chunk of options.body) {
      throwIfAborted(options.signal);
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
}

/** Delete one image_set folder that sits directly inside `dir`. */
export async function removeLocalImageSet(dir: string, name: string): Promise<void> {
  if (!isImageSetFolder(name)) throw new Error("Nur Bildordner.");
  const root = path.resolve(dir);
  const dest = path.resolve(root, name);
  const rel = path.relative(root, dest);
  if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) || rel.includes(path.sep)) {
    throw new Error("Pfad ungültig.");
  }
  let st: fs.Stats;
  try {
    st = await fs.promises.lstat(dest);
  } catch {
    throw new Error("Ordner fehlt.");
  }
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("Ordner fehlt.");
  await fs.promises.rm(dest, { recursive: true });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Abgebrochen.");
}

async function replaceSymlink(dest: string): Promise<void> {
  try {
    const st = await fs.promises.lstat(dest);
    if (st.isSymbolicLink()) await fs.promises.unlink(dest);
  } catch {
    // The file is not there yet.
  }
}

async function copyFile(
  source: string,
  dest: string,
  signal: AbortSignal | undefined,
  onBytes: (n: number) => void,
): Promise<void> {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await replaceSymlink(dest);
  const input = fs.createReadStream(source);
  const out = fs.createWriteStream(dest);
  const onAbort = () => input.destroy(new Error("Abgebrochen."));
  signal?.addEventListener("abort", onAbort);
  try {
    for await (const chunk of input) {
      throwIfAborted(signal);
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (buf.length === 0) continue;
      if (!out.write(buf)) await once(out, "drain");
      onBytes(buf.length);
    }
    out.end();
    await once(out, "finish");
  } catch (err) {
    input.destroy();
    out.destroy();
    await fs.promises.rm(dest, { force: true }).catch(() => {});
    throw err;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
