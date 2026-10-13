"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { encodePathHeader, planTransfer, remoteRelative, runPool, transferSummary } from "@/lib/remote-transfer";
import { cn } from "../ui";
import { CenterDialog, TransferProgress, TransferSuccess } from "./CenterDialog";

interface Collected {
  rel: string;
  size: number;
  dir?: boolean;
  file?: File;
}

interface EntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file: (ok: (file: File) => void, err?: () => void) => void;
  createReader: () => {
    readEntries: (ok: (entries: EntryLike[]) => void, err?: () => void) => void;
  };
}

function entryOf(item: DataTransferItem): EntryLike | null {
  const read = (item as unknown as { webkitGetAsEntry?: () => EntryLike | null }).webkitGetAsEntry;
  return read?.() ?? null;
}

async function readEntry(entry: EntryLike, prefix: string): Promise<Collected[]> {
  const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      entry.file(resolve, () => reject(new Error("Datei nicht lesbar.")));
    });
    return [{ rel, size: file.size, file }];
  }
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const children: EntryLike[] = [];
  for (;;) {
    const batch = await new Promise<EntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, () => reject(new Error("Ordner nicht lesbar.")));
    });
    if (batch.length === 0) break;
    children.push(...batch);
  }
  if (children.length === 0) return [{ rel, size: 0, dir: true }];
  const out: Collected[] = [];
  for (const child of children) out.push(...(await readEntry(child, rel)));
  return out;
}

async function fromDataTransfer(data: DataTransfer): Promise<Collected[]> {
  const entries: EntryLike[] = [];
  if (data.items) {
    for (let i = 0; i < data.items.length; i++) {
      const entry = entryOf(data.items[i]);
      if (entry) entries.push(entry);
    }
  }
  if (entries.length > 0) {
    const out: Collected[] = [];
    for (const entry of entries) out.push(...(await readEntry(entry, "")));
    return out;
  }
  return [...data.files].map((file) => ({
    rel: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    size: file.size,
    file,
  }));
}

function fromFileList(list: FileList | File[]): Collected[] {
  return [...list].map((file) => ({
    rel: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    size: file.size,
    file,
  }));
}

function postOne(
  dir: string,
  rel: string,
  body: Blob | null,
  kind: "file" | "dir",
  onLoaded: (loaded: number) => void,
  register: (xhr: XMLHttpRequest) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    register(xhr);
    xhr.open("POST", "/api/remote/upload");
    xhr.setRequestHeader("x-ccc-dir", encodePathHeader(dir));
    xhr.setRequestHeader("x-ccc-rel", encodePathHeader(rel));
    xhr.setRequestHeader("x-ccc-kind", kind);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onLoaded(event.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      let message = "Hochladen fehlgeschlagen.";
      try {
        const data = JSON.parse(xhr.responseText) as { error?: string };
        if (data.error) message = data.error;
      } catch {
        // The body was not JSON.
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("Hochladen fehlgeschlagen."));
    xhr.onabort = () => reject(new Error("Abgebrochen."));
    xhr.send(body);
  });
}

export default function RemoteUpload({
  dir,
  onClose,
  onRefresh,
}: {
  dir: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "work" | "done" | "error">("idle");
  const [hot, setHot] = useState(false);
  const [error, setError] = useState("");
  const [written, setWritten] = useState(0);
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState("");
  const [summary, setSummary] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const xhrs = useRef(new Set<XMLHttpRequest>());
  const cancelRef = useRef(false);
  const busyRef = useRef(false);
  const startRef = useRef<(pending: Promise<Collected[]> | Collected[]) => Promise<void>>(async () => {});

  useEffect(() => {
    dirRef.current?.setAttribute("webkitdirectory", "");
    dirRef.current?.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      if (!data) return;
      const hasFile = data.files.length > 0 || [...data.items].some((item) => item.kind === "file");
      if (!hasFile) return;
      event.preventDefault();
      void startRef.current(fromDataTransfer(data));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const start = async (pending: Promise<Collected[]> | Collected[]) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError("");
    let items: Collected[];
    try {
      items = await pending;
    } catch (err) {
      busyRef.current = false;
      setError((err as Error).message);
      return;
    }
    const planned = planTransfer(items);
    if (!planned.ok) {
      busyRef.current = false;
      setError(planned.error);
      return;
    }
    const files = new Map<string, File>();
    for (const item of items) {
      const rel = remoteRelative(item.rel);
      if (rel && item.file) files.set(rel, item.file);
    }
    cancelRef.current = false;
    setPhase("work");
    setWritten(0);
    setTotal(planned.plan.total);
    setCurrent("");
    let doneBytes = 0;
    const flying = new Map<string, number>();
    const publish = () => {
      let n = doneBytes;
      for (const value of flying.values()) n += value;
      setWritten(n);
    };
    try {
      await runPool(planned.plan.dirs, 3, async (rel) => {
        if (cancelRef.current) throw new Error("Abgebrochen.");
        setCurrent(rel);
        await postOne(dir, rel, null, "dir", () => {}, (xhr) => xhrs.current.add(xhr));
      });
      await runPool(planned.plan.files, 3, async (file) => {
        if (cancelRef.current) throw new Error("Abgebrochen.");
        const body = files.get(file.rel);
        if (!body) throw new Error("Datei fehlt.");
        flying.set(file.rel, 0);
        setCurrent(file.rel);
        await postOne(
          dir,
          file.rel,
          body,
          "file",
          (loaded) => {
            flying.set(file.rel, loaded);
            publish();
          },
          (xhr) => xhrs.current.add(xhr),
        );
        flying.delete(file.rel);
        doneBytes += file.size;
        publish();
      });
      setSummary(transferSummary(planned.plan.files.length, planned.plan.total, planned.plan.dirs.length));
      setPhase("done");
      onRefresh();
    } catch (err) {
      for (const xhr of xhrs.current) xhr.abort();
      onRefresh();
      if (cancelRef.current || (err as Error).message === "Abgebrochen.") {
        onClose();
        return;
      }
      setError((err as Error).message);
      setPhase("error");
      busyRef.current = false;
    }
  };
  startRef.current = start;

  const cancel = () => {
    cancelRef.current = true;
    for (const xhr of xhrs.current) xhr.abort();
  };

  return (
    <CenterDialog
      title={phase === "done" ? "Hochgeladen" : phase === "work" ? "Wird hochgeladen" : "Dateien hochladen"}
      subtitle={dir}
      busy={phase === "work"}
      onClose={phase === "work" ? cancel : onClose}
    >
      {phase === "idle" && (
        <div
          className="grid gap-3"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            depth.current += 1;
            setHot(true);
          }}
          onDragLeave={() => {
            depth.current -= 1;
            if (depth.current <= 0) {
              depth.current = 0;
              setHot(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            depth.current = 0;
            setHot(false);
            void start(fromDataTransfer(event.dataTransfer));
          }}
        >
          <div
            role="button"
            tabIndex={0}
            aria-label="Dateien auswählen"
            onClick={() => fileRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileRef.current?.click();
              }
            }}
            className={cn(
              "grid h-64 cursor-pointer place-items-center rounded-2xl border border-dashed border-line text-center outline-none focus-visible:border-accent",
              hot && "border-accent bg-accent/10",
            )}
          >
            <span>
              <Plus className="mx-auto size-12 text-ink" />
              <span className="mt-3 block text-sm font-medium text-ink">Dateien oder Ordner hier ablegen</span>
              <span className="mt-1 block text-xs text-faint">Klicken, einfügen oder Ordner wählen · maximal 10 GB</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => dirRef.current?.click()}
            className="cursor-pointer text-sm text-muted hover:text-ink"
          >
            Ordner wählen
          </button>
          {error && <p className="text-xs text-danger">{error}</p>}
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              const list = event.target.files;
              event.target.value = "";
              if (list && list.length) void start(fromFileList(list));
            }}
          />
          <input
            ref={dirRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              const list = event.target.files;
              event.target.value = "";
              if (list && list.length) void start(fromFileList(list));
            }}
          />
        </div>
      )}
      {phase === "work" && (
        <div>
          <TransferProgress label="Wird hochgeladen" written={written} total={total} detail={current} />
          <button type="button" onClick={cancel} className="mx-auto block cursor-pointer text-sm text-muted hover:text-ink">
            Abbrechen
          </button>
        </div>
      )}
      {phase === "done" && <TransferSuccess title="Hochgeladen" summary={summary} onClose={onClose} />}
      {phase === "error" && (
        <div className="grid gap-3 py-4 text-center">
          <p className="text-sm text-danger">{error}</p>
          <button
            type="button"
            onClick={() => {
              busyRef.current = false;
              setPhase("idle");
            }}
            className="cursor-pointer text-sm text-muted hover:text-ink"
          >
            Zurück
          </button>
        </div>
      )}
    </CenterDialog>
  );
}
