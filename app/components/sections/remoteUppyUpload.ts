import { getDroppedFiles } from "@uppy/utils";
import type { ExpandedItem } from "@/lib/local-tree";
import { droppedItemsOrError, relativeUploadPath } from "@/lib/remote-upload-flow";
import { encodePathHeader, MAX_TRANSFER_BYTES, planTransfer, remoteRelative, runPool } from "@/lib/remote-transfer";

export type UploadKind = "remote" | "local";

export interface LocalItem {
  rel: string;
  size: number;
  dir?: boolean;
  file?: File;
  /** Absolute path on this PC. Set when Electron can see the dropped folder. */
  source?: string;
}

function desktopPaths(files: readonly File[]): string[] {
  const pathForFile = window.cccDesktop?.pathForFile;
  if (!pathForFile) return [];
  const paths: string[] = [];
  for (const file of files) {
    try {
      const found = pathForFile(file);
      if (found) paths.push(found);
    } catch {
      // The File was built in script and has no disk path.
    }
  }
  return paths;
}

/** Ask the local server to walk real folders. Electron's directory reader never finishes. */
export async function expandLocalPaths(paths: readonly string[]): Promise<LocalItem[]> {
  const response = await fetch("/api/local/expand", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  const data = (await response.json()) as { items?: ExpandedItem[]; error?: string };
  if (!response.ok || !data.items) throw new Error(data.error || "Ordner konnte nicht gelesen werden.");
  return data.items.map((item) => ({
    rel: item.rel,
    size: item.size,
    dir: item.dir,
    source: item.source,
  }));
}

/**
 * Read a drop or a paste.
 * A folder dropped in the desktop app is walked from its real path, because the
 * browser directory API hangs there and the confirm step would never open.
 * Call this synchronously from the drop handler so the DataTransfer is still valid.
 */
export function collectDataTransfer(data: DataTransfer, fromDrop = false): Promise<LocalItem[]> {
  const fallback = [...data.files];
  const dropped = fromDrop ? window.cccDesktop?.takeDropPaths?.() ?? [] : [];
  const paths = dropped.length > 0 ? dropped : desktopPaths(fallback);
  if (paths.length > 0) return expandLocalPaths(paths);
  const walked = Promise.race([
    getDroppedFiles(data, { logDropError: () => {} }).catch(() => [] as File[]),
    new Promise<File[]>((resolve) => {
      window.setTimeout(() => resolve([]), 8000);
    }),
  ]);
  return walked.then((dropped) => {
    const decision = droppedItemsOrError(dropped, fallback);
    if (!decision.ok) throw new Error(decision.error);
    return itemsFromBrowserFiles(decision.files);
  });
}

export function itemsFromBrowserFiles(files: readonly File[]): LocalItem[] {
  return files.map((file) => {
    const tagged = file as File & { relativePath?: string | null };
    return {
      rel: relativeUploadPath({
        name: file.name,
        size: file.size,
        relativePath: tagged.relativePath,
        webkitRelativePath: file.webkitRelativePath,
      }),
      size: file.size,
      file,
    };
  });
}

function uploadEndpoint(kind: UploadKind): string {
  return kind === "local" ? "/api/fs/upload" : "/api/remote/upload";
}

function postOne(
  kind: UploadKind,
  dir: string,
  rel: string,
  body: Blob | null,
  fileKind: "file" | "dir",
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Abgebrochen."));
      return;
    }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    signal.addEventListener("abort", abort);
    const finish = (fn: () => void) => {
      signal.removeEventListener("abort", abort);
      fn();
    };
    xhr.open("POST", uploadEndpoint(kind));
    xhr.setRequestHeader("x-ccc-dir", encodePathHeader(dir));
    xhr.setRequestHeader("x-ccc-rel", encodePathHeader(rel));
    xhr.setRequestHeader("x-ccc-kind", fileKind);
    xhr.onload = () => {
      finish(() => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }
        let message = "Hochladen fehlgeschlagen.";
        try {
          const parsed = JSON.parse(xhr.responseText) as { error?: string };
          if (parsed.error) message = parsed.error;
        } catch {
          // The body was not JSON.
        }
        reject(new Error(message));
      });
    };
    xhr.onerror = () => finish(() => reject(new Error("Hochladen fehlgeschlagen.")));
    xhr.onabort = () => finish(() => reject(new Error("Abgebrochen.")));
    xhr.send(body);
  });
}

/** Create directories shallow-first. Same-depth folders can run together; a child waits for its parent. */
async function mkdirAll(kind: UploadKind, dir: string, dirs: readonly string[], signal: AbortSignal): Promise<void> {
  let depth = -1;
  let batch: string[] = [];
  const flush = async () => {
    const current = batch;
    batch = [];
    await runPool(current, 3, async (rel) => {
      if (signal.aborted) throw new Error("Abgebrochen.");
      await postOne(kind, dir, rel, null, "dir", signal);
    });
  };
  for (const rel of dirs) {
    const next = rel.split("/").length;
    if (batch.length > 0 && next !== depth) await flush();
    depth = next;
    batch.push(rel);
  }
  if (batch.length > 0) await flush();
}

function failureMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message) return error.message;
  return "Hochladen fehlgeschlagen.";
}

async function uploadFilesWithUppy(
  kind: UploadKind,
  dir: string,
  planned: { rel: string; size: number }[],
  files: Map<string, File>,
  onProgress: (written: number, total: number, current: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const total = planned.reduce((sum, file) => sum + file.size, 0);
  const [{ default: Uppy }, { default: XHRUpload }] = await Promise.all([
    import("@uppy/core"),
    import("@uppy/xhr-upload"),
  ]);
  if (signal.aborted) throw new Error("Abgebrochen.");
  const uppy = new Uppy({
    autoProceed: false,
    restrictions: {
      maxFileSize: MAX_TRANSFER_BYTES,
      maxNumberOfFiles: null,
      allowedFileTypes: null,
    },
  }).use(XHRUpload, {
    endpoint: uploadEndpoint(kind),
    method: "POST",
    formData: false,
    timeout: 0,
    limit: 3,
    shouldRetry: () => false,
    headers: (file) => ({
      "x-ccc-dir": encodePathHeader(dir),
      "x-ccc-rel": encodePathHeader(String(file.meta.relativePath || file.name || "")),
      "x-ccc-kind": "file",
    }),
    getResponseData: () => ({ url: "" }),
    onAfterResponse: (xhr) => {
      if (xhr.status >= 200 && xhr.status < 300) return;
      let message = "Hochladen fehlgeschlagen.";
      try {
        const parsed = JSON.parse(xhr.responseText) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        // The body was not JSON.
      }
      throw new Error(message);
    },
  });

  const onAbort = () => uppy.cancelAll();
  signal.addEventListener("abort", onAbort);
  let done = 0;
  const flying = new Map<string, number>();
  const publish = (current: string) => {
    let written = done;
    for (const value of flying.values()) written += value;
    onProgress(Math.min(total, written), total, current);
  };
  uppy.on("upload-progress", (file, progress) => {
    if (!file) return;
    flying.set(file.id, progress.bytesUploaded);
    publish(String(file.meta.relativePath || file.name || ""));
  });
  uppy.on("upload-success", (file) => {
    if (!file) return;
    flying.delete(file.id);
    done += file.size ?? 0;
    publish(String(file.meta.relativePath || file.name || ""));
  });

  try {
    uppy.addFiles(
      planned.map((item) => {
        const body = files.get(item.rel);
        if (!body) throw new Error("Datei fehlt.");
        return {
          name: item.rel.split("/").pop() || item.rel,
          type: body.type || "application/octet-stream",
          data: body,
          meta: { relativePath: item.rel },
        };
      }),
    );
    if (signal.aborted) throw new Error("Abgebrochen.");
    const result = await uppy.upload();
    if (signal.aborted) throw new Error("Abgebrochen.");
    const failed = result?.failed?.filter(Boolean) ?? [];
    if (failed.length > 0) throw new Error(failureMessage(failed[0]?.error));
  } finally {
    signal.removeEventListener("abort", onAbort);
    uppy.destroy();
  }
}

async function uploadFromSources(options: {
  kind: UploadKind;
  dir: string;
  items: readonly LocalItem[];
  onProgress: (written: number, total: number, current: string) => void;
  signal: AbortSignal;
}): Promise<{ files: number; bytes: number; dirs: number }> {
  const response = await fetch("/api/transfer/paths", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: options.kind,
      dir: options.dir,
      items: options.items.map((item) => ({
        rel: item.rel,
        source: item.source,
        dir: Boolean(item.dir),
        size: item.size,
      })),
    }),
    signal: options.signal,
  });
  if (!response.ok) {
    let message = "Hochladen fehlgeschlagen.";
    try {
      const parsed = (await response.json()) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      // The body was not JSON.
    }
    throw new Error(message);
  }
  if (!response.body) throw new Error("Hochladen fehlgeschlagen.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let doneInfo: { files: number; bytes: number; dirs: number } | null = null;
  const takeLine = (line: string) => {
    if (!line) return;
    const msg = JSON.parse(line) as {
      type?: string;
      written?: number;
      total?: number;
      current?: string;
      error?: string;
      files?: number;
      bytes?: number;
      dirs?: number;
    };
    if (msg.type === "progress") options.onProgress(msg.written ?? 0, msg.total ?? 0, msg.current ?? "");
    else if (msg.type === "error") throw new Error(msg.error || "Hochladen fehlgeschlagen.");
    else if (msg.type === "done") doneInfo = { files: msg.files ?? 0, bytes: msg.bytes ?? 0, dirs: msg.dirs ?? 0 };
  };
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    buf += decoder.decode(step.value, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      takeLine(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
    }
  }
  takeLine(buf.trim());
  if (!doneInfo) throw new Error("Hochladen fehlgeschlagen.");
  return doneInfo;
}

export async function uploadLocalItems(options: {
  kind?: UploadKind;
  dir: string;
  items: readonly LocalItem[];
  onProgress: (written: number, total: number, current: string) => void;
  signal: AbortSignal;
}): Promise<{ files: number; bytes: number; dirs: number }> {
  const kind = options.kind ?? "remote";
  const planned = planTransfer(options.items);
  if (!planned.ok) throw new Error(planned.error);
  const sourced = options.items.filter((item) => !item.file);
  const blobs = options.items.filter((item) => item.file);
  if (blobs.length === 0) return uploadFromSources({ ...options, kind, items: sourced });
  const files = new Map<string, File>();
  for (const item of blobs) {
    const rel = remoteRelative(item.rel);
    if (rel && item.file) files.set(rel, item.file);
  }
  let base = 0;
  let sourceBytes = 0;
  let sourceFiles = 0;
  let dirs = planned.plan.dirs.length;
  if (sourced.length > 0) {
    const fromDisk = await uploadFromSources({
      kind,
      dir: options.dir,
      items: sourced,
      signal: options.signal,
      onProgress: (written, total, name) => options.onProgress(written, total, name),
    });
    base = fromDisk.bytes;
    sourceBytes = fromDisk.bytes;
    sourceFiles = fromDisk.files;
    dirs = fromDisk.dirs;
  }
  await mkdirAll(kind, options.dir, planned.plan.dirs, options.signal);
  if (options.signal.aborted) throw new Error("Abgebrochen.");
  const blobPlan = planned.plan.files.filter((file) => files.has(file.rel));
  if (blobPlan.length === 0) {
    options.onProgress(base, sourceBytes, "");
    return { files: sourceFiles, bytes: sourceBytes, dirs };
  }
  await uploadFilesWithUppy(kind, options.dir, blobPlan, files, (written, total, name) => {
    options.onProgress(base + written, sourceBytes + total, name);
  }, options.signal);
  return {
    files: sourceFiles + blobPlan.length,
    bytes: sourceBytes + blobPlan.reduce((sum, file) => sum + file.size, 0),
    dirs,
  };
}
