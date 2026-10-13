import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  joinRemote,
  localDestWith,
  MAX_TRANSFER_BYTES,
  remoteBaseName,
  remoteRelative,
} from "../remote-transfer";

/**
 * Wire format spoken with the Python broker. One connection, one command.
 * Binary bodies follow the command line and are not base64.
 *
 * PUT <root-b64> <rel-b64> <size>\n <size bytes>  → OK {json}\n | ERR …\n
 * MKDIR <root-b64> <rel-b64>\n                    → OK {json}\n
 * GET <path-b64>\n                                → OK <size>\n <size bytes>
 * WALK <path-b64>\n                               → FILE/DIR lines, then END
 */

class ByteQueue {
  private parts: Buffer[] = [];
  private length = 0;
  private ended = false;
  private error: Error | null = null;
  private wake: (() => void) | null = null;

  constructor(socket: net.Socket) {
    socket.on("data", (chunk: Buffer) => {
      this.parts.push(chunk);
      this.length += chunk.length;
      this.poke();
    });
    socket.on("error", (err: Error) => {
      this.error = err;
      this.poke();
    });
    socket.on("end", () => {
      this.ended = true;
      this.poke();
    });
    socket.on("close", () => {
      this.ended = true;
      this.poke();
    });
  }

  private poke(): void {
    const fn = this.wake;
    this.wake = null;
    fn?.();
  }

  private wait(): Promise<void> {
    if (this.length > 0 || this.ended || this.error) return Promise.resolve();
    return new Promise((resolve) => {
      this.wake = resolve;
    });
  }

  private take(n: number): Buffer {
    const out = Buffer.allocUnsafe(n);
    let filled = 0;
    while (filled < n) {
      const part = this.parts[0];
      const need = n - filled;
      if (part.length <= need) {
        part.copy(out, filled);
        filled += part.length;
        this.parts.shift();
      } else {
        part.copy(out, filled, 0, need);
        this.parts[0] = part.subarray(need);
        filled += need;
      }
    }
    this.length -= n;
    return out;
  }

  async read(n: number): Promise<Buffer> {
    while (this.length < n) {
      if (this.error) throw this.error;
      if (this.ended) throw new Error("Übertragung unvollständig.");
      await this.wait();
    }
    return this.take(n);
  }

  async readLine(): Promise<string> {
    while (true) {
      let offset = 0;
      for (let i = 0; i < this.parts.length; i++) {
        const idx = this.parts[i].indexOf(0x0a);
        if (idx >= 0) {
          const buf = this.take(offset + idx + 1);
          return buf.subarray(0, buf.length - 1).toString("utf8");
        }
        offset += this.parts[i].length;
      }
      if (this.error) throw this.error;
      if (this.ended) throw new Error("Übertragung unvollständig.");
      await this.wait();
    }
  }
}

function writeAll(socket: net.Socket, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      socket.off("error", onError);
      socket.off("drain", onDrain);
      if (err) reject(err);
      else resolve();
    };
    const onError = (err: Error) => finish(err);
    const onDrain = () => finish();
    socket.on("error", onError);
    const ok = socket.write(data);
    if (ok) finish();
    else socket.once("drain", onDrain);
  });
}

function connect(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    const onError = (err: Error) => {
      socket.off("connect", onConnect);
      reject(err);
    };
    const onConnect = () => {
      socket.off("error", onError);
      resolve(socket);
    };
    socket.once("error", onError);
    socket.once("connect", onConnect);
  });
}

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error("Abgebrochen.");
    err.name = "AbortError";
    throw err;
  }
}

async function withSocket<T>(port: number, signal: AbortSignal | undefined, fn: (socket: net.Socket, queue: ByteQueue) => Promise<T>): Promise<T> {
  throwIfAborted(signal);
  const socket = await connect(port);
  const queue = new ByteQueue(socket);
  const onAbort = () => socket.destroy(new Error("Abgebrochen."));
  signal?.addEventListener("abort", onAbort);
  try {
    return await fn(socket, queue);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    socket.destroy();
  }
}

function parseOk(line: string, fallback: string): void {
  if (line.startsWith("ERR")) throw new Error(line.slice(4).trim() || fallback);
  if (!line.startsWith("OK ")) throw new Error(fallback);
  const data = JSON.parse(line.slice(3)) as { error?: string };
  if (data.error) throw new Error(data.error);
}

export async function remotePut(
  port: number,
  root: string,
  rel: string,
  bytes: AsyncIterable<Buffer>,
  size: number,
  signal?: AbortSignal,
): Promise<void> {
  const safe = remoteRelative(rel);
  if (!safe) throw new Error("Dateiname ungültig.");
  if (!Number.isFinite(size) || size < 0 || size > MAX_TRANSFER_BYTES) throw new Error("Maximal 10 GB.");
  await withSocket(port, signal, async (socket, queue) => {
    await writeAll(socket, Buffer.from(`PUT ${b64(root)} ${b64(safe)} ${size}\n`));
    let sent = 0;
    for await (const chunk of bytes) {
      throwIfAborted(signal);
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (sent + buf.length > size) throw new Error("Übertragung unvollständig.");
      if (buf.length === 0) continue;
      await writeAll(socket, buf);
      sent += buf.length;
    }
    if (sent !== size) throw new Error("Übertragung unvollständig.");
    parseOk(await queue.readLine(), "Hochladen fehlgeschlagen.");
  });
}

export async function remoteMkdir(port: number, root: string, rel: string, signal?: AbortSignal): Promise<void> {
  const safe = remoteRelative(rel);
  if (safe === null || !safe) throw new Error("Pfad ungültig.");
  await withSocket(port, signal, async (socket, queue) => {
    await writeAll(socket, Buffer.from(`MKDIR ${b64(root)} ${b64(safe)}\n`));
    parseOk(await queue.readLine(), "Ordner anlegen fehlgeschlagen.");
  });
}

export interface WalkedRemote {
  files: { rel: string; size: number }[];
  dirs: string[];
  total: number;
}

export async function remoteWalk(port: number, remotePath: string, signal?: AbortSignal): Promise<WalkedRemote> {
  return withSocket(port, signal, async (socket, queue) => {
    await writeAll(socket, Buffer.from(`WALK ${b64(remotePath)}\n`));
    const files: { rel: string; size: number }[] = [];
    const dirs: string[] = [];
    let total = 0;
    while (true) {
      const line = await queue.readLine();
      if (line.startsWith("ERR")) throw new Error(line.slice(4).trim() || "Ordner lesen fehlgeschlagen.");
      if (line.startsWith("END ")) {
        const [, countRaw, bytesRaw] = line.split(" ");
        if (files.length !== Number(countRaw) || total !== Number(bytesRaw)) throw new Error("Antwort ungültig.");
        return { files, dirs, total };
      }
      if (line.startsWith("DIR ")) {
        const rel = remoteRelative(Buffer.from(line.slice(4).trim(), "base64").toString("utf8"));
        if (!rel) throw new Error("Pfad ungültig.");
        dirs.push(rel);
        continue;
      }
      const match = /^FILE (\d+) (\S+)$/.exec(line);
      if (!match) throw new Error("Antwort ungültig.");
      const size = Number(match[1]);
      const rel = remoteRelative(Buffer.from(match[2], "base64").toString("utf8"));
      if (!rel || !Number.isSafeInteger(size) || size < 0) throw new Error("Pfad ungültig.");
      if (total + size > MAX_TRANSFER_BYTES) throw new Error("Maximal 10 GB.");
      total += size;
      files.push({ rel, size });
    }
  });
}

export async function remoteRead(
  port: number,
  remotePath: string,
  write: (chunk: Buffer) => Promise<void>,
  signal?: AbortSignal,
): Promise<number> {
  return withSocket(port, signal, async (socket, queue) => {
    await writeAll(socket, Buffer.from(`GET ${b64(remotePath)}\n`));
    const line = await queue.readLine();
    if (line.startsWith("ERR")) throw new Error(line.slice(4).trim() || "Herunterladen fehlgeschlagen.");
    const match = /^OK (\d+)$/.exec(line);
    if (!match) throw new Error("Antwort ungültig.");
    const size = Number(match[1]);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_TRANSFER_BYTES) throw new Error("Maximal 10 GB.");
    let left = size;
    while (left > 0) {
      throwIfAborted(signal);
      const chunk = await queue.read(Math.min(1024 * 1024, left));
      await write(chunk);
      left -= chunk.length;
    }
    return size;
  });
}

async function openLocal(dest: string): Promise<fs.promises.FileHandle> {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  try {
    const st = await fs.promises.lstat(dest);
    if (st.isSymbolicLink()) await fs.promises.unlink(dest);
  } catch {
    // The file is not there yet.
  }
  return fs.promises.open(dest, "w");
}

async function writeFully(handle: fs.promises.FileHandle, chunk: Buffer): Promise<void> {
  let off = 0;
  while (off < chunk.length) {
    const { bytesWritten } = await handle.write(chunk, off, chunk.length - off);
    if (bytesWritten <= 0) throw new Error("Schreiben fehlgeschlagen.");
    off += bytesWritten;
  }
}

export interface SaveProgress {
  written: number;
  total: number;
  filesDone: number;
  files: number;
  name: string;
}

export async function saveRemoteTree(opts: {
  port: number;
  remotePath: string;
  localDir: string;
  directory: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: SaveProgress) => void;
}): Promise<{ files: number; bytes: number; folder: string }> {
  const localStat = await fs.promises.stat(opts.localDir);
  if (!localStat.isDirectory()) throw new Error("Ziel ist kein Ordner.");
  const walked = await remoteWalk(opts.port, opts.remotePath, opts.signal);
  const baseName = remoteBaseName(opts.remotePath);
  let written = 0;
  const report = async (name: string, filesDone: number) => {
    await opts.onProgress?.({
      written,
      total: walked.total,
      filesDone,
      files: walked.files.length,
      name,
    });
  };
  await report("", 0);

  if (!opts.directory) {
    const dest = localDestWith(path, opts.localDir, baseName);
    if (!dest) throw new Error("Pfad ungültig.");
    const handle = await openLocal(dest);
    try {
      await remoteRead(
        opts.port,
        opts.remotePath,
        async (chunk) => {
          await writeFully(handle, chunk);
          written += chunk.length;
          await report(baseName, 0);
        },
        opts.signal,
      );
    } catch (err) {
      await handle.close();
      await fs.promises.rm(dest, { force: true });
      throw err;
    }
    await handle.close();
    await report(baseName, 1);
    return { files: 1, bytes: written, folder: opts.localDir };
  }

  const folder = localDestWith(path, opts.localDir, baseName);
  if (!folder) throw new Error("Pfad ungültig.");
  await fs.promises.mkdir(folder, { recursive: true });
  for (const dir of walked.dirs) {
    const dest = localDestWith(path, folder, dir);
    if (!dest) throw new Error("Pfad ungültig.");
    await fs.promises.mkdir(dest, { recursive: true });
  }
  let filesDone = 0;
  for (const file of walked.files) {
    throwIfAborted(opts.signal);
    const remoteFile = joinRemote(opts.remotePath, file.rel);
    const dest = localDestWith(path, folder, file.rel);
    if (!remoteFile || !dest) throw new Error("Pfad ungültig.");
    const handle = await openLocal(dest);
    try {
      await remoteRead(
        opts.port,
        remoteFile,
        async (chunk) => {
          await writeFully(handle, chunk);
          written += chunk.length;
          await report(file.rel, filesDone);
        },
        opts.signal,
      );
    } catch (err) {
      await handle.close();
      await fs.promises.rm(dest, { force: true });
      throw err;
    }
    await handle.close();
    filesDone += 1;
    await report(file.rel, filesDone);
  }
  return { files: walked.files.length, bytes: written, folder: opts.localDir };
}
