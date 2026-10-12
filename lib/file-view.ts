import fs from "node:fs/promises";
import path from "node:path";
import { isProbablyBinary } from "./fs-explorer";

export type FileKind = "text" | "image" | "pdf" | "audio" | "video" | "binary";

export interface FileView {
  path: string;
  name: string;
  size: number;
  kind: FileKind;
  tooLarge?: boolean;
  content?: string;
  dataUrl?: string;
}

const TEXT_MAX = 2 * 1024 * 1024;
const MEDIA_MAX = 8 * 1024 * 1024;

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"]);
const AUDIO = new Set(["mp3", "wav", "ogg", "m4a", "flac"]);
const VIDEO = new Set(["mp4", "webm", "ogv", "mov"]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  if (i <= 0) return "";
  return name.slice(i + 1).toLowerCase();
}

export function kindForName(name: string): FileKind {
  const ext = extOf(name);
  if (IMAGE.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (AUDIO.has(ext)) return "audio";
  if (VIDEO.has(ext)) return "video";
  return "text";
}

function mimeFor(name: string): string {
  const ext = extOf(name);
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    ico: "image/x-icon",
    avif: "image/avif",
    pdf: "application/pdf",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    flac: "audio/flac",
    mp4: "video/mp4",
    webm: "video/webm",
    ogv: "video/ogg",
    mov: "video/quicktime",
  };
  return map[ext] || "application/octet-stream";
}

/** Classify bytes the same way for a local disk read and a remote broker read. */
export function viewFromBuffer(filePath: string, name: string, buf: Buffer): FileView {
  const hinted = kindForName(name);
  const size = buf.length;
  if (hinted !== "text") {
    return {
      path: filePath,
      name,
      size,
      kind: hinted,
      dataUrl: `data:${mimeFor(name)};base64,${buf.toString("base64")}`,
    };
  }
  if (isProbablyBinary(buf)) return { path: filePath, name, size, kind: "binary" };
  return { path: filePath, name, size, kind: "text", content: buf.toString("utf8") };
}

export async function readViewFile(filePath: string): Promise<FileView> {
  const abs = path.resolve(filePath);
  const st = await fs.stat(abs);
  if (!st.isFile()) throw new Error("Keine Datei.");
  const name = path.basename(abs);
  const kind = kindForName(name);
  const max = kind === "text" ? TEXT_MAX : MEDIA_MAX;
  if (st.size > max) return { path: abs, name, size: st.size, kind, tooLarge: true };
  return viewFromBuffer(abs, name, await fs.readFile(abs));
}

export async function writeViewFile(filePath: string, content: string): Promise<void> {
  const abs = path.resolve(filePath);
  let st: Awaited<ReturnType<typeof fs.stat>> | null = null;
  try {
    st = await fs.stat(abs);
  } catch {
    st = null;
  }
  if (st?.isDirectory()) throw new Error("Ordner kann nicht gespeichert werden.");
  if (Buffer.byteLength(content, "utf8") > TEXT_MAX) throw new Error("Datei zu gross.");
  await fs.writeFile(abs, content, "utf8");
}
