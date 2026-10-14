import fs from "node:fs";
import path from "node:path";
import { saveImageSetFile } from "../../image-set-cache";
import { writeLocalTree, type UploadSource } from "../../local-upload";
import {
  imageSetFolderName,
  imageSetPrompt,
  imageUploadName,
  isImageFile,
  isImageSetFolder,
  MAX_IMAGE_COUNT,
} from "../../../remote-upload-flow";
import { planTransfer } from "../../../remote-transfer";
import { ActionError } from "../errors";

/** MCP copies stay at 64 MB. The upload dialog in the window allows 10 GB. */
export const MCP_TRANSFER_CAP = 64 * 1024 * 1024;
const MAX_WALK_ENTRIES = 2000;

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "__pycache__"]);

export interface PreparedImage {
  source: string;
  name: string;
  size: number;
}

/** Walk files and folders on this PC into relative upload entries. Symlinks are refused. */
export async function collectUpload(sources: string[]): Promise<UploadSource[]> {
  if (sources.length === 0) throw new ActionError("At least one file or folder is required.");
  const items: UploadSource[] = [];
  const budget = { bytes: 0, entries: 0 };
  for (const raw of sources) {
    const source = path.resolve(raw.trim());
    if (!raw.trim()) throw new ActionError("A path is empty.");
    await walkUpload(source, path.basename(source), items, budget);
  }
  return items;
}

async function walkUpload(
  source: string,
  relBase: string,
  items: UploadSource[],
  budget: { bytes: number; entries: number },
): Promise<void> {
  if (budget.entries >= MAX_WALK_ENTRIES) {
    throw new ActionError(`That tree has more than ${MAX_WALK_ENTRIES} entries. Upload a smaller folder.`);
  }
  let st: fs.Stats;
  try {
    st = await fs.promises.lstat(source);
  } catch {
    throw new ActionError(`Path not found: ${source}`);
  }
  if (st.isSymbolicLink()) throw new ActionError(`Refusing a symlink: ${source}`);
  budget.entries += 1;
  if (st.isDirectory()) {
    items.push({ rel: relBase, size: 0, dir: true });
    const names = await fs.promises.readdir(source);
    for (const name of names) {
      await walkUpload(path.join(source, name), `${relBase}/${name}`, items, budget);
    }
    return;
  }
  if (!st.isFile()) throw new ActionError(`Not a file or folder: ${source}`);
  budget.bytes += st.size;
  if (budget.bytes > MCP_TRANSFER_CAP) {
    throw new ActionError("MCP uploads at most 64 MB. Use the upload dialog for a larger copy.");
  }
  items.push({ rel: relBase, size: st.size, source });
}

export function assertTransferFits(items: readonly UploadSource[]): void {
  const planned = planTransfer(items);
  if (!planned.ok) throw new ActionError(planned.error);
  if (planned.plan.total > MCP_TRANSFER_CAP) {
    throw new ActionError("MCP uploads at most 64 MB. Use the upload dialog for a larger copy.");
  }
}

/** Copy files and folders into an existing folder on this PC. */
export async function uploadLocalTree(dir: string, sources: string[]) {
  const root = await existingDir(dir);
  rejectOverlap(root, sources);
  const items = await collectUpload(sources);
  assertTransferFits(items);
  try {
    const result = await writeLocalTree({ dir: root, items });
    return { dir: root, ...result };
  } catch (err) {
    throw new ActionError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Copy images into `image_set` plus 8 letters, or into `setName` when that
 * folder already belongs to this uploader. Returns the sentence the CLI paste uses.
 */
export async function uploadLocalImages(dir: string, sources: string[], setName?: string) {
  const root = await existingDir(dir);
  const folder = setName?.trim() || imageSetFolderName();
  if (!isImageSetFolder(folder)) {
    throw new ActionError("folder must be an existing image_set name. Omit it to create a new set.");
  }
  const dest = path.join(root, folder);
  const used = await existingImageNames(dest);
  const prepared = await prepareImages(sources, used);
  await fs.promises.mkdir(dest, { recursive: true });
  try {
    await writeLocalTree({
      dir: root,
      items: prepared.files.map((file) => ({
        rel: `${folder}/${file.name}`,
        size: file.size,
        source: file.source,
      })),
    });
  } catch (err) {
    throw new ActionError(err instanceof Error ? err.message : String(err));
  }
  for (const file of prepared.files) {
    await saveImageSetFile(folder, file.name, file.source);
  }
  return imageResult(folder, dest, prepared);
}

/** Check image names, the 10-image cap, and the 64 MB cap. `used` are names already in the set. */
export async function prepareImages(sources: string[], used: string[]): Promise<{ files: PreparedImage[]; bytes: number }> {
  const clean = sources.map((item) => item.trim()).filter(Boolean);
  if (clean.length === 0) throw new ActionError("At least one image is required.");
  if (used.length + clean.length > MAX_IMAGE_COUNT) {
    throw new ActionError(
      `An image set holds at most ${MAX_IMAGE_COUNT} images. This set already has ${used.length}.`,
    );
  }
  const taken = new Set(used);
  const files: PreparedImage[] = [];
  let bytes = 0;
  for (const raw of clean) {
    const source = path.resolve(raw);
    let st: fs.Stats;
    try {
      st = await fs.promises.lstat(source);
    } catch {
      throw new ActionError(`Image not found: ${source}`);
    }
    if (st.isSymbolicLink() || !st.isFile()) throw new ActionError(`Not an image file: ${source}`);
    if (!isImageFile({ name: path.basename(source) })) {
      throw new ActionError(`Not a supported image: ${source}`);
    }
    bytes += st.size;
    if (bytes > MCP_TRANSFER_CAP) {
      throw new ActionError("MCP image uploads at most 64 MB.");
    }
    files.push({ source, name: imageUploadName(path.basename(source), undefined, taken), size: st.size });
  }
  return { files, bytes };
}

export function imageResult(
  folder: string,
  folderPath: string,
  prepared: { files: PreparedImage[]; bytes: number },
) {
  return {
    folder,
    path: folderPath,
    prompt: imageSetPrompt(folderPath),
    files: prepared.files.map((file) => file.name),
    bytes: prepared.bytes,
    note: "prompt is the sentence the window copies for the CLI. Paste it with session_send.",
  };
}

/** Name search under `root`. Skips dependency and build folders. At most 200 hits. */
export async function searchTree(root: string, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) throw new ActionError("query is required.");
  const base = path.resolve(root);
  let st: fs.Stats;
  try {
    st = await fs.promises.stat(base);
  } catch {
    throw new ActionError(`Folder not found: ${base}`);
  }
  if (!st.isDirectory()) throw new ActionError(`Not a folder: ${base}`);
  const entries: { name: string; path: string; dir: boolean }[] = [];
  let seen = 0;
  const walk = async (dir: string) => {
    if (entries.length >= 200 || seen > 2500) return;
    seen += 1;
    let names: fs.Dirent[];
    try {
      names = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const dirs: string[] = [];
    const files: string[] = [];
    for (const entry of names) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) dirs.push(entry.name);
      } else if (entry.isFile()) files.push(entry.name);
    }
    for (const name of [...dirs, ...files]) {
      if (!name.toLowerCase().includes(q)) continue;
      entries.push({ name, path: path.join(dir, name), dir: dirs.includes(name) });
      if (entries.length >= 200) return;
    }
    for (const name of dirs) {
      if (entries.length >= 200 || seen > 2500) return;
      await walk(path.join(dir, name));
    }
  };
  await walk(base);
  return {
    path: base,
    query: q,
    entries,
    note: entries.length
      ? "Matches are name substrings under this folder. Copy one with the copy-path tool, or read a file."
      : "Nothing matched. Try a shorter name.",
  };
}

/** Absolute path that stays inside `root`. A relative input is joined onto `root`. */
export function resolveUnder(root: string, input: string): string {
  const base = path.resolve(root);
  const raw = input.trim();
  if (!raw) return base;
  const target = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(base, raw);
  const rel = path.relative(base, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new ActionError(`Path is outside ${base}.`);
  }
  return target;
}

export async function existingDir(dir: string): Promise<string> {
  const root = path.resolve(dir.trim());
  if (!dir.trim()) throw new ActionError("dir is required.");
  let st: fs.Stats;
  try {
    st = await fs.promises.stat(root);
  } catch {
    throw new ActionError(`Folder not found: ${root}`);
  }
  if (!st.isDirectory()) throw new ActionError(`Not a folder: ${root}`);
  return root;
}

async function existingImageNames(dir: string): Promise<string[]> {
  try {
    const names = await fs.promises.readdir(dir);
    return names.filter((name) => isImageFile({ name }));
  } catch {
    return [];
  }
}

function rejectOverlap(dest: string, sources: string[]): void {
  const root = path.resolve(dest);
  for (const raw of sources) {
    const source = path.resolve(raw.trim());
    if (source === root) {
      throw new ActionError("The destination folder cannot be one of the folders being uploaded.");
    }
    const destInside = path.relative(source, root);
    if (destInside !== "" && !destInside.startsWith("..") && !path.isAbsolute(destInside)) {
      throw new ActionError("The destination folder cannot be inside a folder being uploaded.");
    }
  }
}
