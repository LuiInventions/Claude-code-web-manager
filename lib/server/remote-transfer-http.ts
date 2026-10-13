import type { IncomingMessage, ServerResponse } from "node:http";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { remoteMkdir, remotePut, remoteRead, remoteWalk, saveRemoteTree } from "./remote-copy";
import { tarArchiveSize, tarEnd, tarMemberPrefix, tarPadding } from "./remote-tar";
import {
  contentDisposition,
  decodePathHeader,
  joinRemote,
  MAX_TRANSFER_BYTES,
  remoteBaseName,
  remoteRelative,
} from "../remote-transfer";

const UPLOAD = "/api/remote/upload";
const DOWNLOAD = "/api/remote/download";

export function isRemoteTransfer(url: string | undefined): boolean {
  const pathOnly = (url || "").split("?")[0];
  return pathOnly === UPLOAD || pathOnly === DOWNLOAD;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  if (res.headersSent || res.writableEnded) {
    res.end();
    return;
  }
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
  });
  res.end(data);
}

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  return typeof value === "string" ? value : "";
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    n += buf.length;
    if (n > 1_000_000) throw new Error("Anfrage zu gross.");
    chunks.push(buf);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function writeLine(res: ServerResponse, body: unknown): Promise<void> {
  const ok = res.write(`${JSON.stringify(body)}\n`);
  if (!ok) await once(res, "drain");
}

function portOf(getPort: () => number | null): number {
  const port = getPort();
  if (!port) {
    const err = new Error("Nicht mit dem Server verbunden.");
    (err as Error & { status?: number }).status = 409;
    throw err;
  }
  return port;
}

async function handleUpload(req: IncomingMessage, res: ServerResponse, getPort: () => number | null): Promise<void> {
  if (req.method !== "POST") {
    json(res, 405, { error: "Methode nicht erlaubt." });
    return;
  }
  let root = "";
  let rel = "";
  try {
    root = decodePathHeader(header(req, "x-ccc-dir")).trim();
    rel = decodePathHeader(header(req, "x-ccc-rel"));
  } catch {
    json(res, 400, { error: "Pfad ungültig." });
    return;
  }
  if (!root) {
    json(res, 400, { error: "Ordner fehlt." });
    return;
  }
  const safe = remoteRelative(rel);
  const kind = header(req, "x-ccc-kind");
  if (safe === null || !safe) {
    json(res, 400, { error: "Dateiname ungültig." });
    return;
  }
  const port = portOf(getPort);
  if (kind === "dir") {
    req.resume();
    await remoteMkdir(port, root, safe);
    json(res, 200, { ok: true });
    return;
  }
  const len = Number(header(req, "content-length"));
  if (!Number.isInteger(len) || len < 0) {
    json(res, 411, { error: "Länge fehlt." });
    req.destroy();
    return;
  }
  if (len > MAX_TRANSFER_BYTES) {
    json(res, 413, { error: "Maximal 10 GB." });
    req.destroy();
    return;
  }
  await remotePut(port, root, safe, req, len, reqCloseSignal(req));
  json(res, 200, { ok: true, size: len });
}

function reqCloseSignal(req: IncomingMessage): AbortSignal {
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  req.on("aborted", stop);
  req.on("close", () => {
    if (!req.complete) ctrl.abort();
  });
  return ctrl.signal;
}

async function handleDownloadPost(req: IncomingMessage, res: ServerResponse, getPort: () => number | null): Promise<void> {
  const body = (await readJson(req)) as { path?: unknown; dest?: unknown; dir?: unknown };
  const remotePath = typeof body.path === "string" ? body.path.trim() : "";
  const dest = typeof body.dest === "string" ? body.dest.trim() : "";
  if (!remotePath || !dest) {
    json(res, 400, { error: "Pfad fehlt." });
    return;
  }
  const localDir = path.resolve(dest);
  let st: fs.Stats;
  try {
    st = await fs.promises.stat(localDir);
  } catch {
    json(res, 400, { error: "Zielordner fehlt." });
    return;
  }
  if (!st.isDirectory()) {
    json(res, 400, { error: "Ziel ist kein Ordner." });
    return;
  }
  const port = portOf(getPort);
  const ctrl = new AbortController();
  const onClose = () => ctrl.abort();
  res.on("close", onClose);
  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
  });
  try {
    const saved = await saveRemoteTree({
      port,
      remotePath,
      localDir,
      directory: body.dir === true,
      signal: ctrl.signal,
      onProgress: (progress) => {
        void writeLine(res, { type: "progress", ...progress });
      },
    });
    await writeLine(res, { type: "done", ...saved });
    res.end();
  } catch (err) {
    if (!res.writableEnded) {
      const message = err instanceof Error ? err.message : "Herunterladen fehlgeschlagen.";
      if (message === "Abgebrochen.") {
        res.end();
        return;
      }
      await writeLine(res, { type: "error", error: message });
      res.end();
    }
  } finally {
    res.off("close", onClose);
  }
}

async function writeRes(res: ServerResponse, chunk: Buffer): Promise<void> {
  if (!res.write(chunk)) await once(res, "drain");
}

async function handleDownloadGet(req: IncomingMessage, res: ServerResponse, getPort: () => number | null): Promise<void> {
  const url = new URL(req.url || "", "http://127.0.0.1");
  const remotePath = url.searchParams.get("path")?.trim() || "";
  const directory = url.searchParams.get("dir") === "1";
  if (!remotePath) {
    json(res, 400, { error: "Pfad fehlt." });
    return;
  }
  const port = portOf(getPort);
  const ctrl = new AbortController();
  res.on("close", () => ctrl.abort());
  const walked = await remoteWalk(port, remotePath, ctrl.signal);
  const name = remoteBaseName(remotePath);

  if (!directory) {
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-disposition": contentDisposition(name),
      "content-length": String(walked.total),
      "cache-control": "no-store",
    });
    await remoteRead(port, remotePath, (chunk) => writeRes(res, chunk), ctrl.signal);
    res.end();
    return;
  }

  const members = [
    ...walked.dirs.map((dir) => ({ name: dir, size: 0, dir: true })),
    ...walked.files.map((file) => ({ name: file.rel, size: file.size })),
  ];
  res.writeHead(200, {
    "content-type": "application/x-tar",
    "content-disposition": contentDisposition(`${name}.tar`),
    "content-length": String(tarArchiveSize(members)),
    "cache-control": "no-store",
  });
  for (const dir of walked.dirs) {
    await writeRes(res, tarMemberPrefix(dir, 0, true));
  }
  for (const file of walked.files) {
    const remoteFile = joinRemote(remotePath, file.rel);
    if (!remoteFile) throw new Error("Pfad ungültig.");
    await writeRes(res, tarMemberPrefix(file.rel, file.size));
    await remoteRead(port, remoteFile, (chunk) => writeRes(res, chunk), ctrl.signal);
    const pad = tarPadding(file.size);
    if (pad.length) await writeRes(res, pad);
  }
  await writeRes(res, tarEnd());
  res.end();
}

/**
 * Upload and download bypass Next so a multi-gigabyte body is streamed
 * straight to the SSH broker instead of being buffered.
 * Returns true when this request belongs to those routes.
 */
export async function handleRemoteTransfer(
  req: IncomingMessage,
  res: ServerResponse,
  getPort: () => number | null,
): Promise<boolean> {
  if (!isRemoteTransfer(req.url)) return false;
  const pathOnly = (req.url || "").split("?")[0];
  try {
    if (pathOnly === UPLOAD) await handleUpload(req, res, getPort);
    else if (req.method === "POST") await handleDownloadPost(req, res, getPort);
    else if (req.method === "GET") await handleDownloadGet(req, res, getPort);
    else json(res, 405, { error: "Methode nicht erlaubt." });
  } catch (err) {
    const status = (err as { status?: number }).status || 502;
    const message = err instanceof Error ? err.message : "Übertragung fehlgeschlagen.";
    if (!res.headersSent) json(res, status, { error: message });
    else if (!res.writableEnded) {
      res.end();
    }
  }
  return true;
}
