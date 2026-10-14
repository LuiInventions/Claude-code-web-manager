import { formatBytes } from "./format";
import { planTransfer, type TransferEntry } from "./remote-transfer";

export const MAX_IMAGE_COUNT = 10;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024 * 1024;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif|tiff?|ico)$/i;
const LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export interface NamedFile {
  name: string;
  size: number;
  type?: string;
  relativePath?: string | null;
  webkitRelativePath?: string;
}

/** Path Uppy or a folder input attached to a dropped or picked file. */
export function relativeUploadPath(file: NamedFile): string {
  const raw = file.relativePath || file.webkitRelativePath || file.name;
  return raw.replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * One confirmation for a drop or a picked selection.
 * A single file or folder is named. Several top-level items are counted.
 */
export function confirmUploadQuestion(entries: readonly TransferEntry[], dest: string): string {
  const planned = planTransfer(entries);
  if (!planned.ok) return planned.error;
  const roots = new Map<string, { dir: boolean }>();
  for (const entry of entries) {
    const rel = entry.rel.replace(/\\/g, "/").replace(/^\/+/, "");
    const root = rel.split("/").find((part) => part && part !== ".") ?? "";
    if (!root || root === "..") continue;
    const prev = roots.get(root);
    const dir = Boolean(entry.dir) || rel.slice(root.length).includes("/");
    roots.set(root, { dir: Boolean(prev?.dir) || dir });
  }
  const size = formatBytes(planned.plan.total);
  const list = [...roots.entries()];
  if (list.length === 1) {
    return `Möchten Sie ${list[0][0]} (${size}) nach ${dest} hochladen?`;
  }
  const allDirs = list.length > 0 && list.every(([, info]) => info.dir);
  const label = allDirs ? `${list.length} Ordner` : list.every(([, info]) => !info.dir) ? `${list.length} Dateien` : `${list.length} Elemente`;
  return `Möchten Sie ${label} (${size}) nach ${dest} hochladen?`;
}

export function isImageFile(file: { name: string; type?: string }): boolean {
  if ((file.type || "").toLowerCase().startsWith("image/")) return true;
  return IMAGE_EXT.test(file.name);
}

export interface TakeImagesResult {
  /** Indexes into `incoming` that fit the 10-image and 2 GB limits. */
  take: number[];
  error: string;
}

/** Keep images that still fit. `error` explains the first reason something was left out. */
export function takeImages(existing: readonly { size: number }[], incoming: readonly { name: string; type?: string; size: number }[]): TakeImagesResult {
  const take: number[] = [];
  let count = existing.length;
  let bytes = existing.reduce((sum, file) => sum + file.size, 0);
  let error = "";
  for (let i = 0; i < incoming.length; i++) {
    const file = incoming[i];
    if (!isImageFile(file)) {
      if (!error) error = "Nur Bilder.";
      continue;
    }
    if (count >= MAX_IMAGE_COUNT) {
      if (!error) error = "Maximal 10 Bilder.";
      continue;
    }
    if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_IMAGE_BYTES || bytes + file.size > MAX_IMAGE_BYTES) {
      if (!error) error = "Maximal 2 GB.";
      continue;
    }
    take.push(i);
    count += 1;
    bytes += file.size;
  }
  return { take, error };
}

const IMAGE_SET_NAME = /^image_set[A-Za-z]+$/;

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
  ico: "image/x-icon",
};

/** Content type for a preview, or null when the name is not an image we can show. */
export function imageMime(name: string): string | null {
  const base = name.replace(/\\/g, "/").split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  return IMAGE_MIME[base.slice(dot + 1).toLowerCase()] ?? null;
}

/** True for a folder this uploader created. Deletes accept only this shape. */
export function isImageSetFolder(name: string): boolean {
  return IMAGE_SET_NAME.test(name);
}

/** Folder names this uploader created, in a stable order for the picker bar. */
export function imageSetNames(entries: readonly { name: string; dir?: boolean }[]): string[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.dir && IMAGE_SET_NAME.test(entry.name)) seen.add(entry.name);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** `image_set` plus 8 letters, so the folder name is safe to paste into a prompt. */
export function imageSetFolderName(seed?: Uint8Array): string {
  const bytes = seed && seed.length >= 8 ? seed : randomLetterBytes();
  let name = "image_set";
  for (let i = 0; i < 8; i++) name += LETTERS[bytes[i] % LETTERS.length];
  return name;
}

function randomLetterBytes(): Uint8Array {
  const bytes = new Uint8Array(8);
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

/** The same sentence every time, with the folder filled in, so it can be pasted to the CLI. */
export function imageSetPrompt(folderPath: string): string {
  return `in ${folderPath} sind die bilder:`;
}

/**
 * A dropped folder that the browser could not walk must not become a 0-byte file.
 * `walked` is what the directory API returned. `fallback` is `dataTransfer.files`.
 */
export function droppedItemsOrError<T extends NamedFile>(
  walked: readonly T[],
  fallback: readonly T[],
): { ok: true; files: T[] } | { ok: false; error: string } {
  if (walked.length > 0) return { ok: true, files: [...walked] };
  if (fallback.length === 0) return { ok: false, error: "Nichts zum Hochladen." };
  const readable = fallback.some((file) => file.size > 0 || Boolean(file.relativePath || file.webkitRelativePath));
  if (!readable) return { ok: false, error: "Ordner konnte nicht gelesen werden." };
  return { ok: true, files: [...fallback] };
}

export function uniqueImageName(name: string, used: Set<string>): string {
  const base = name.replace(/\\/g, "/").split("/").pop()?.replace(/^\.+/, "") || "bild";
  const clean = base.replace(/[<>:"|?*\u0000-\u001f]/g, "_") || "bild";
  if (!used.has(clean)) {
    used.add(clean);
    return clean;
  }
  const dot = clean.lastIndexOf(".");
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : "";
  let n = 2;
  while (used.has(`${stem}-${n}${ext}`)) n += 1;
  const next = `${stem}-${n}${ext}`;
  used.add(next);
  return next;
}
