import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { summarizeFolder } from "./folder-summary";

/**
 * Read-only filesystem access for the Explorer tab. Browses the whole machine
 * (all drives) — the trust boundary is the loopback bind, not path scoping.
 * The only "write" is launching explorer.exe to reveal a path.
 */

export interface FsEntry {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number | null;
  mtimeMs: number | null;
  hidden: boolean;
}

const MAX_ENTRIES = 3000;
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024; // 2 MB
const README_RE = /^readme(\.md|\.txt|\.markdown)?$/i;

export async function listDrives(): Promise<FsEntry[]> {
  const drives: FsEntry[] = [];
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c);
    const root = `${letter}:\\`;
    if (existsSync(root)) {
      drives.push({
        name: `${letter}:`,
        path: root,
        type: "dir",
        size: null,
        mtimeMs: null,
        hidden: false,
      });
    }
  }
  return drives;
}

export async function listDir(
  dirPath: string,
): Promise<{ entries: FsEntry[]; truncated: boolean }> {
  const abs = path.resolve(dirPath);
  const dirents = await fs.readdir(abs, { withFileTypes: true });
  const truncated = dirents.length > MAX_ENTRIES;
  const entries: FsEntry[] = [];
  for (const d of dirents.slice(0, MAX_ENTRIES)) {
    const full = path.join(abs, d.name);
    let isDir = d.isDirectory();
    let size: number | null = null;
    let mtimeMs: number | null = null;
    try {
      const st = await fs.stat(full);
      isDir = st.isDirectory();
      size = isDir ? null : st.size;
      mtimeMs = st.mtimeMs;
    } catch {
      /* permission denied / dangling link — keep dirent type */
    }
    entries.push({
      name: d.name,
      path: full,
      type: isDir ? "dir" : "file",
      size,
      mtimeMs,
      hidden: d.name.startsWith("."),
    });
  }
  entries.sort(sortEntries);
  return { entries, truncated };
}

export function sortEntries(a: FsEntry, b: FsEntry): number {
  if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export interface FilePreview {
  kind: "file";
  path: string;
  name: string;
  size: number;
  language: string;
  binary: boolean;
  tooLarge: boolean;
  content: string | null;
}

export interface FolderPreview {
  kind: "folder";
  path: string;
  name: string;
  readme: string | null;
  summary: string | null;
}

export async function readFilePreview(filePath: string): Promise<FilePreview> {
  const abs = path.resolve(filePath);
  const st = await fs.stat(abs);
  const name = path.basename(abs);
  const base: FilePreview = {
    kind: "file",
    path: abs,
    name,
    size: st.size,
    language: detectLanguage(name),
    binary: false,
    tooLarge: false,
    content: null,
  };
  if (st.size > MAX_PREVIEW_BYTES) return { ...base, tooLarge: true };
  const buf = await fs.readFile(abs);
  if (isProbablyBinary(buf)) return { ...base, binary: true };
  return { ...base, content: buf.toString("utf8") };
}

export async function readFolderPreview(dirPath: string): Promise<FolderPreview> {
  const abs = path.resolve(dirPath);
  const name = path.basename(abs) || abs;
  let files: string[] = [];
  try {
    files = (await fs.readdir(abs, { withFileTypes: true })).map((e) => e.name);
  } catch {
    /* unreadable */
  }
  const readmeName = files.find((f) => README_RE.test(f));
  if (readmeName) {
    try {
      const content = await fs.readFile(path.join(abs, readmeName), "utf8");
      return { kind: "folder", path: abs, name, readme: content.slice(0, 40000), summary: null };
    } catch {
      /* fall through to summary */
    }
  }
  let summary: string | null = null;
  try {
    summary = await summarizeFolder(abs);
  } catch (e) {
    summary = `Zusammenfassung nicht möglich: ${(e as Error).message}`;
  }
  return { kind: "folder", path: abs, name, readme: null, summary };
}

/** Unified preview: a file's content, or a folder's README / AI summary. */
export async function readPathPreview(
  p: string,
): Promise<FilePreview | FolderPreview> {
  const abs = path.resolve(p);
  const st = await fs.stat(abs);
  return st.isDirectory() ? readFolderPreview(abs) : readFilePreview(abs);
}

export function isProbablyBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8000);
  if (len === 0) return false;
  let suspicious = 0;
  for (let i = 0; i < len; i++) {
    const c = buf[i];
    if (c === 0) return true; // a null byte is a strong binary signal
    if ((c < 7 || (c > 14 && c < 27) || c === 127) && c !== 27) suspicious++;
  }
  return suspicious / len > 0.3;
}

export function detectLanguage(name: string): string {
  if (name.toLowerCase() === "dockerfile") return "dockerfile";
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    mjs: "javascript", cjs: "javascript", json: "json", md: "markdown",
    mdx: "markdown", css: "css", scss: "scss", less: "less", html: "html",
    xml: "xml", svg: "xml", vue: "xml", svelte: "xml", py: "python", rb: "ruby",
    go: "go", rs: "rust", java: "java", c: "c", h: "c", cpp: "cpp", cc: "cpp",
    hpp: "cpp", cs: "csharp", php: "php", sh: "bash", bash: "bash", zsh: "bash",
    ps1: "powershell", psm1: "powershell", bat: "dos", cmd: "dos", yml: "yaml",
    yaml: "yaml", toml: "ini", ini: "ini", sql: "sql", kt: "kotlin",
    swift: "swift", dart: "dart", env: "bash", txt: "plaintext", log: "plaintext",
  };
  return map[ext] || "plaintext";
}

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

export async function openInExplorer(target: string): Promise<void> {
  const abs = path.resolve(target);
  const st = await fs.stat(abs);
  const child = st.isDirectory()
    ? spawn("explorer.exe", [abs], { detached: true, stdio: "ignore" })
    : spawn("explorer.exe", [`/select,${abs}`], {
        detached: true,
        stdio: "ignore",
      });
  child.unref();
}
