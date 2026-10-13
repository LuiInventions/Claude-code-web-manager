import { getDroppedFiles } from "@uppy/utils";
import { relativeUploadPath } from "@/lib/remote-upload-flow";
import { encodePathHeader, MAX_TRANSFER_BYTES, planTransfer, remoteRelative, runPool } from "@/lib/remote-transfer";

export interface LocalItem {
  rel: string;
  size: number;
  dir?: boolean;
  file?: File;
}

/**
 * Read a drop or a paste with Uppy. Uppy walks folders and, when the browser
 * rejects a file through the directory API, falls back to the file itself.
 * Call this synchronously from the drop handler so the DataTransfer is still valid.
 */
export function collectDataTransfer(data: DataTransfer): Promise<LocalItem[]> {
  const fallback = [...data.files];
  return getDroppedFiles(data, { logDropError: () => {} })
    .then((dropped) => itemsFromBrowserFiles(dropped.length > 0 ? dropped : fallback))
    .catch(() => itemsFromBrowserFiles(fallback));
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

function postOne(dir: string, rel: string, body: Blob | null, kind: "file" | "dir", signal: AbortSignal): Promise<void> {
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
    xhr.open("POST", "/api/remote/upload");
    xhr.setRequestHeader("x-ccc-dir", encodePathHeader(dir));
    xhr.setRequestHeader("x-ccc-rel", encodePathHeader(rel));
    xhr.setRequestHeader("x-ccc-kind", kind);
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
async function mkdirAll(dir: string, dirs: readonly string[], signal: AbortSignal): Promise<void> {
  let depth = -1;
  let batch: string[] = [];
  const flush = async () => {
    const current = batch;
    batch = [];
    await runPool(current, 3, async (rel) => {
      if (signal.aborted) throw new Error("Abgebrochen.");
      await postOne(dir, rel, null, "dir", signal);
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
    endpoint: "/api/remote/upload",
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

export async function uploadLocalItems(options: {
  dir: string;
  items: readonly LocalItem[];
  onProgress: (written: number, total: number, current: string) => void;
  signal: AbortSignal;
}): Promise<{ files: number; bytes: number; dirs: number }> {
  const planned = planTransfer(options.items);
  if (!planned.ok) throw new Error(planned.error);
  const files = new Map<string, File>();
  for (const item of options.items) {
    const rel = remoteRelative(item.rel);
    if (rel && item.file) files.set(rel, item.file);
  }
  await mkdirAll(options.dir, planned.plan.dirs, options.signal);
  if (options.signal.aborted) throw new Error("Abgebrochen.");
  if (planned.plan.files.length === 0) {
    options.onProgress(0, 0, "");
    return { files: 0, bytes: 0, dirs: planned.plan.dirs.length };
  }
  await uploadFilesWithUppy(options.dir, planned.plan.files, files, options.onProgress, options.signal);
  return { files: planned.plan.files.length, bytes: planned.plan.total, dirs: planned.plan.dirs.length };
}
