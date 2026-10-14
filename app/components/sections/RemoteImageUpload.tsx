"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { X } from "lucide-react";
import {
  confirmUploadQuestion,
  imageFilesInListing,
  imageSetFolderName,
  imageSetNames,
  imageSetPrompt,
  imageSetRelPaths,
  MAX_IMAGE_COUNT,
  mergeImageSetContents,
  takeImages,
  type ImageSetContents,
  type ListedSetFile,
} from "@/lib/remote-upload-flow";
import { encodePathHeader, joinRemote, transferSummary } from "@/lib/remote-transfer";
import { Button, cn } from "../ui";
import { CenterDialog, TransferProgress } from "./CenterDialog";
import { collectDataTransfer, uploadLocalItems, type LocalItem, type UploadKind } from "./remoteUppyUpload";

interface PastedImage {
  id: string;
  name: string;
  size: number;
  url: string;
  type?: string;
  file?: File;
  source?: string;
}

interface ListedImage {
  name: string;
  path: string;
  size: number;
}

type Phase = "pick" | "confirm" | "confirm-delete" | "work" | "copy" | "error";

/** Bigger than this is named, not decoded. A full-size decode freezes the window. */
const PREVIEW_MAX = 8 * 1024 * 1024;

function childPath(kind: UploadKind, dir: string, name: string): string | null {
  if (kind === "remote") return joinRemote(dir, name);
  if (!dir.trim() || !name) return null;
  const sep = dir.includes("\\") ? "\\" : "/";
  return `${dir.replace(/[\\/]+$/, "")}${sep}${name}`;
}

function localPreview(filePath: string): string {
  return `/api/fs/raw?${new URLSearchParams({ path: filePath })}`;
}

async function listLocalSet(name: string): Promise<ListedImage[]> {
  const params = new URLSearchParams({ name });
  const response = await fetch(`/api/image-set/local?${params}`);
  const data = (await response.json()) as { images?: ListedImage[]; error?: string };
  if (!response.ok) throw new Error(data.error || "Bildordner fehlt.");
  return data.images ?? [];
}

/** Names already in the destination folder. A failed list is null, not an empty set. */
async function listFolderImages(kind: UploadKind, folderPath: string): Promise<ListedSetFile[] | null> {
  try {
    const params = new URLSearchParams({ path: folderPath });
    const url = kind === "remote" ? `/api/remote/fs?${params}` : `/api/fs?${params}`;
    const response = await fetch(url);
    const data = (await response.json()) as {
      entries?: { name: string; dir?: boolean; type?: string; size?: number | null }[];
    };
    if (!response.ok) return null;
    return imageFilesInListing(data.entries ?? []);
  } catch {
    return null;
  }
}

async function rememberImageSet(name: string, items: LocalItem[], signal: AbortSignal): Promise<void> {
  for (const item of items) {
    if (item.dir) continue;
    const file = item.rel.split("/").pop() || "";
    if (item.file) {
      const response = await fetch("/api/image-set/cache", {
        method: "POST",
        headers: {
          "x-ccc-set": encodePathHeader(name),
          "x-ccc-file": encodePathHeader(file),
          "content-type": item.file.type || "application/octet-stream",
        },
        body: item.file,
        signal,
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Lokale Kopie fehlgeschlagen.");
      continue;
    }
    if (!item.source) throw new Error("Datei fehlt.");
    const response = await fetch("/api/image-set/cache", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, file, source: item.source }),
      signal,
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(data.error || "Lokale Kopie fehlgeschlagen.");
  }
}

function chipClass(on: boolean): string {
  return cn(
    "h-9 max-w-full shrink-0 cursor-pointer rounded-md border px-3 text-sm",
    on
      ? "border-transparent bg-accent font-medium text-accent-ink"
      : "border-line bg-raised text-ink hover:bg-selected",
  );
}

function FolderBar({
  names,
  selected,
  allowNew,
  allowDelete,
  onSelect,
  onDelete,
}: {
  names: string[];
  selected: string;
  allowNew: boolean;
  allowDelete: boolean;
  onSelect: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted">Ordner</span>
        {allowDelete && selected !== "new" && (
          <button
            type="button"
            onClick={() => onDelete(selected)}
            className="ml-auto h-8 cursor-pointer rounded-md px-2 text-sm text-danger hover:bg-danger/10"
          >
            Löschen
          </button>
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" role="listbox" aria-label="Bildordner">
        {allowNew && (
          <button type="button" role="option" aria-selected={selected === "new"} onClick={() => onSelect("new")} className={chipClass(selected === "new")}>
            Neuer Ordner
          </button>
        )}
        {names.map((name) => (
          <button
            key={name}
            type="button"
            role="option"
            aria-selected={selected === name}
            title={name}
            onClick={() => onSelect(name)}
            className={cn(chipClass(selected === name), "font-mono text-[13px]")}
          >
            {name}
          </button>
        ))}
        {names.length === 0 && !allowNew && <span className="text-sm text-muted">Noch kein Bildordner</span>}
      </div>
    </div>
  );
}

function PathBox({ value }: { value: string }) {
  return (
    <label className="grid gap-1 rounded-lg border border-line bg-raised px-3 py-2">
      <span className="text-xs font-medium text-muted">Pfad</span>
      <input
        readOnly
        value={value}
        aria-label="Pfad"
        onFocus={(event) => event.currentTarget.select()}
        className="w-full bg-transparent font-mono text-[13px] leading-5 text-ink outline-none"
      />
    </label>
  );
}

function SentenceBox({
  value,
  copied,
  inputRef,
  onCopy,
}: {
  value: string;
  copied: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onCopy: () => void;
}) {
  return (
    <div className="grid gap-1 rounded-lg border border-line bg-raised px-3 py-2">
      <span className="text-xs font-medium text-muted">Satz</span>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          readOnly
          value={value}
          aria-label="Satz"
          onFocus={(event) => event.currentTarget.select()}
          className="h-9 min-w-0 flex-1 bg-transparent font-mono text-[13px] text-ink outline-none"
        />
        <Button type="button" size="sm" variant="primary" onClick={onCopy}>
          {copied ? "Kopiert" : "Kopieren"}
        </Button>
      </div>
    </div>
  );
}

function LocalTile({ image }: { image: ListedImage }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative aspect-square overflow-hidden rounded-md border border-line bg-raised">
      {failed ? (
        <span className="grid size-full place-items-center px-2 text-center text-xs text-muted">Keine Vorschau</span>
      ) : (
        <img
          src={localPreview(image.path)}
          alt={image.name}
          loading="lazy"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
      <span className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-1.5 py-1 text-left text-xs text-white">
        {image.name}
      </span>
    </div>
  );
}

function SetTiles({ images, quietEmpty }: { images: ListedImage[] | undefined; quietEmpty?: boolean }) {
  if (!images) return <p className="col-span-full text-sm text-muted">Wird geladen…</p>;
  if (images.length === 0) {
    if (quietEmpty) return null;
    return <p className="col-span-full text-sm text-muted">Keine lokale Kopie</p>;
  }
  return (
    <>
      {images.map((image) => (
        <LocalTile key={image.path} image={image} />
      ))}
    </>
  );
}

function filesFromClipboard(data: DataTransfer): File[] {
  if (data.files.length > 0) return [...data.files];
  const out: File[] = [];
  for (const item of data.items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) out.push(file);
  }
  return out;
}

export default function RemoteImageUpload({
  dir,
  kind = "remote",
  onClose,
  onRefresh,
}: {
  dir: string;
  kind?: UploadKind;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [images, setImages] = useState<PastedImage[]>([]);
  const [error, setError] = useState("");
  const [folderName, setFolderName] = useState("");
  const [sets, setSets] = useState<string[]>([]);
  const [pictures, setPictures] = useState<ListedImage[] | undefined>(undefined);
  const [contained, setContained] = useState<ImageSetContents | null>(null);
  const [deleteName, setDeleteName] = useState("");
  const [target, setTarget] = useState("new");
  const [listNonce, setListNonce] = useState(0);
  const [question, setQuestion] = useState("");
  const [queued, setQueued] = useState<LocalItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [written, setWritten] = useState(0);
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState("");
  const [summary, setSummary] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const sentenceRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const imagesRef = useRef(images);
  const urlsRef = useRef(new Set<string>());
  const phaseRef = useRef(phase);
  const targetRef = useRef(target);
  const containedRef = useRef(contained);
  const addRef = useRef<(incoming: LocalItem[]) => void>(() => {});
  imagesRef.current = images;
  phaseRef.current = phase;
  targetRef.current = target;
  containedRef.current = contained;

  useEffect(() => {
    const focusBar = window.setTimeout(() => inputRef.current?.focus(), 0);
    const allowDrag = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      if (phaseRef.current !== "pick" || !event.dataTransfer) return;
      const data = event.dataTransfer;
      void collectDataTransfer(data, true)
        .then((items) => {
          if (items.length > 0) addRef.current(items);
        })
        .catch((err: Error) => setError(err.message));
    };
    const onPaste = (event: ClipboardEvent) => {
      if (phaseRef.current !== "pick" || !event.clipboardData) return;
      const incoming = filesFromClipboard(event.clipboardData);
      if (incoming.length === 0) return;
      event.preventDefault();
      if (inputRef.current) inputRef.current.value = "";
      addRef.current(incoming.map((file) => ({ rel: file.name || "bild", size: file.size, file })));
    };
    window.addEventListener("dragover", allowDrag);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      window.clearTimeout(focusBar);
      window.removeEventListener("dragover", allowDrag);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ path: dir });
    const listUrl = kind === "remote" ? `/api/remote/fs?${params}` : `/api/fs?${params}`;
    fetch(listUrl)
      .then((response) => response.json())
      .then((data: { entries?: { name: string; dir?: boolean; type?: string }[] }) => {
        const entries = (data.entries ?? []).map((entry) => ({
          name: entry.name,
          dir: kind === "remote" ? Boolean(entry.dir) : entry.type === "dir",
        }));
        if (!cancelled) setSets(imageSetNames(entries));
      })
      .catch(() => {
        if (!cancelled) setSets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dir, kind, listNonce]);

  useEffect(() => {
    if (target === "new") {
      setPictures(undefined);
      setContained(null);
      return;
    }
    let cancelled = false;
    setPictures(undefined);
    setContained(null);
    const folderPath = childPath(kind, dir, target);
    Promise.all([
      folderPath ? listFolderImages(kind, folderPath) : Promise.resolve(null),
      listLocalSet(target).catch(() => [] as ListedImage[]),
    ]).then(([folder, cache]) => {
      if (cancelled) return;
      setPictures(cache);
      setContained(mergeImageSetContents(folder, cache));
    });
    return () => {
      cancelled = true;
    };
  }, [target, kind, dir, listNonce]);

  const dropPending = () => {
    for (const image of imagesRef.current) {
      if (image.url.startsWith("blob:")) {
        URL.revokeObjectURL(image.url);
        urlsRef.current.delete(image.url);
      }
    }
    imagesRef.current = [];
    setImages([]);
  };

  const addFiles = (incoming: LocalItem[]) => {
    if (targetRef.current !== "new" && !containedRef.current) {
      setError("Bildordner wird gezählt.");
      return;
    }
    const candidates = incoming
      .filter((item) => !item.dir)
      .map((item) => ({
        name: item.rel.split("/").pop() || "bild",
        type: item.file?.type || "",
        size: item.size,
        file: item.file,
        source: item.source,
      }));
    if (candidates.length === 0) return;
    const held = targetRef.current === "new" ? [] : containedRef.current?.files ?? [];
    const decision = takeImages([...held, ...imagesRef.current], candidates);
    setError(decision.error);
    if (decision.take.length === 0) return;
    const next = decision.take.map((index) => {
      const item = candidates[index];
      const blob = item.file && item.size <= PREVIEW_MAX ? URL.createObjectURL(item.file) : "";
      if (blob) urlsRef.current.add(blob);
      const url = blob || (item.source ? localPreview(item.source) : "");
      return {
        id: crypto.randomUUID(),
        name: item.name,
        size: item.size,
        type: item.type,
        file: item.file,
        source: item.source,
        url,
      };
    });
    const merged = [...imagesRef.current, ...next];
    imagesRef.current = merged;
    setImages(merged);
  };
  addRef.current = addFiles;

  const remove = (id: string) => {
    const image = imagesRef.current.find((item) => item.id === id);
    if (image?.url.startsWith("blob:")) {
      URL.revokeObjectURL(image.url);
      urlsRef.current.delete(image.url);
    }
    const next = imagesRef.current.filter((item) => item.id !== id);
    imagesRef.current = next;
    setImages(next);
  };

  const goNext = () => {
    if (images.length === 0) return;
    if (target !== "new" && !contained) {
      setError("Bildordner wird gezählt.");
      return;
    }
    const held = target === "new" ? [] : contained?.files ?? [];
    if (held.length + images.length > MAX_IMAGE_COUNT) {
      setError("Maximal 10 Bilder.");
      return;
    }
    const folder = target === "new" ? imageSetFolderName() : target;
    const folderPath = childPath(kind, dir, folder);
    if (!folderPath) {
      setError("Pfad ungültig.");
      return;
    }
    const rels = imageSetRelPaths(
      folder,
      held.map((file) => file.name),
      images.map((image) => ({ name: image.name, type: image.type || image.file?.type })),
    );
    const items: LocalItem[] = images.map((image, index) => ({
      rel: rels[index],
      size: image.size,
      file: image.file,
      source: image.file ? undefined : image.source,
    }));
    setFolderName(folder);
    setQueued(items);
    setQuestion(confirmUploadQuestion(items, dir));
    setPhase("confirm");
  };

  const run = async () => {
    if (busyRef.current || queued.length === 0) return;
    busyRef.current = true;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase("work");
    setWritten(0);
    setTotal(0);
    setCurrent("");
    try {
      const result = await uploadLocalItems({
        kind,
        dir,
        items: queued,
        signal: ctrl.signal,
        onProgress: (nextWritten, nextTotal, name) => {
          setWritten(nextWritten);
          setTotal(nextTotal);
          setCurrent(name);
        },
      });
      await rememberImageSet(folderName, queued, ctrl.signal);
      dropPending();
      setSummary(transferSummary(result.files, result.bytes, result.dirs));
      setTarget(folderName);
      setCopied(false);
      setListNonce((n) => n + 1);
      setPhase("copy");
      onRefresh();
    } catch (err) {
      onRefresh();
      const message = (err as Error).message;
      if (ctrl.signal.aborted || message === "Abgebrochen.") {
        onClose();
        return;
      }
      setError(message);
      setPhase("error");
    } finally {
      busyRef.current = false;
    }
  };

  const selectFolder = (name: string) => {
    setCopied(false);
    setError("");
    setTarget(name);
  };

  const askDelete = (name: string) => {
    setDeleteName(name);
    setQuestion(`Möchten Sie ${name} löschen?`);
    setError("");
    setPhase("confirm-delete");
  };

  const runDelete = async () => {
    if (!deleteName) return;
    try {
      const response = await fetch("/api/image-set/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, dir, name: deleteName }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Löschen fehlgeschlagen.");
      if (target === deleteName) setTarget("new");
      setDeleteName("");
      setListNonce((n) => n + 1);
      setPhase("pick");
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
    }
  };

  const knownSets = folderName && !sets.includes(folderName) ? [folderName, ...sets] : sets;
  const previewPath = target !== "new" ? childPath(kind, dir, target) : null;
  const boxPath = (target === "new" ? dir : previewPath) || dir;
  const boxSentence = target === "new" ? "" : previewPath ? imageSetPrompt(previewPath) : "";
  const shown = target === "new" ? images.length : contained ? contained.count + images.length : null;

  const copySentence = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      sentenceRef.current?.focus();
      sentenceRef.current?.select();
    }
  };

  const close = () => {
    if (phase === "work") {
      abortRef.current?.abort();
      return;
    }
    onClose();
  };

  return (
    <CenterDialog
      title={phase === "copy" ? "Bilder hochgeladen" : phase === "work" ? "Wird hochgeladen" : "Bild hochladen"}
      busy={phase === "work"}
      plain
      wide
      onClose={close}
    >
      {phase === "pick" && (
        <div className="grid gap-3">
          <PathBox value={boxPath} />
          {boxSentence && (
            <SentenceBox
              value={boxSentence}
              copied={copied}
              inputRef={sentenceRef}
              onCopy={() => void copySentence(boxSentence)}
            />
          )}
          <FolderBar
            names={sets}
            selected={target}
            allowNew
            allowDelete
            onSelect={selectFolder}
            onDelete={askDelete}
          />
          <div className="grid min-h-48 grid-cols-2 gap-2 rounded-lg border border-line bg-canvas p-3 sm:grid-cols-5">
            {target !== "new" && <SetTiles images={pictures} quietEmpty={images.length > 0} />}
            {target === "new" && images.length === 0 && (
              <p className="col-span-full grid place-items-center text-sm text-muted">Noch keine Bilder</p>
            )}
            {images.map((image) => (
              <div key={image.id} className="relative aspect-square overflow-hidden rounded-md border border-line bg-raised">
                {image.url ? (
                  <img src={image.url} alt={image.name} className="size-full object-cover" />
                ) : (
                  <span className="grid size-full place-items-center px-2 text-center text-xs text-muted">Keine Vorschau</span>
                )}
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-1.5 py-1 text-left text-xs text-white">
                  {image.name}
                </span>
                <button
                  type="button"
                  aria-label={`${image.name} entfernen`}
                  onClick={() => remove(image.id)}
                  className="absolute right-1 top-1 z-10 inline-flex size-8 cursor-pointer items-center justify-center rounded-md bg-surface/90 text-ink hover:bg-surface"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
          <input
            ref={inputRef}
            aria-label="Bilder einfügen"
            placeholder="Bilder mit Strg+V einfügen"
            className="h-10 w-full rounded-lg border border-line bg-raised px-3 text-sm text-ink outline-none placeholder:text-faint"
          />
          <p className="text-sm tabular-nums text-muted" aria-live="polite">
            {shown === null ? `… / ${MAX_IMAGE_COUNT}` : `${shown} / ${MAX_IMAGE_COUNT}`}
            <span className="text-faint"> · maximal 2 GB</span>
          </p>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <Button type="button" variant="primary" className="w-full" disabled={images.length === 0} onClick={goNext}>
            Weiter
          </Button>
        </div>
      )}
      {phase === "confirm-delete" && (
        <div className="grid gap-5 py-2">
          <p className="break-all text-center text-[15px] font-medium leading-relaxed text-ink">{question}</p>
          <div className="flex justify-center gap-3">
            <Button type="button" variant="secondary" onClick={() => setPhase("pick")}>
              Zurück
            </Button>
            <Button type="button" variant="danger" onClick={() => void runDelete()}>
              Löschen
            </Button>
          </div>
        </div>
      )}
      {phase === "confirm" && (
        <div className="grid gap-5 py-2">
          <p className="break-all text-center text-[15px] font-medium leading-relaxed text-ink">{question}</p>
          <div className="flex justify-center gap-3">
            <Button type="button" variant="secondary" onClick={() => setPhase("pick")}>
              Zurück
            </Button>
            <Button type="button" variant="primary" onClick={() => void run()}>
              Hochladen
            </Button>
          </div>
        </div>
      )}
      {phase === "work" && (
        <div>
          <TransferProgress label="Wird hochgeladen" written={written} total={total} detail={current} />
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="mx-auto block cursor-pointer text-sm text-muted hover:text-ink"
          >
            Abbrechen
          </button>
        </div>
      )}
      {phase === "copy" && (
        <div className="grid gap-3 py-1">
          <p className="text-center text-sm font-medium text-ink">
            {kind === "local" ? "Die Bilder liegen im Ordner." : "Die Bilder liegen auf dem Server."}
          </p>
          <p className="text-center text-sm text-muted">{summary}</p>
          <PathBox value={boxPath} />
          <FolderBar
            names={knownSets}
            selected={target === "new" ? folderName : target}
            allowNew={false}
            allowDelete
            onSelect={selectFolder}
            onDelete={askDelete}
          />
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-canvas p-3 sm:grid-cols-5">
            <SetTiles images={pictures} />
          </div>
          {boxSentence && (
            <SentenceBox
              value={boxSentence}
              copied={copied}
              inputRef={sentenceRef}
              onCopy={() => void copySentence(boxSentence)}
            />
          )}
          <Button type="button" variant="secondary" className="w-full" onClick={onClose}>
            Schliessen
          </Button>
        </div>
      )}
      {phase === "error" && (
        <div className="grid gap-3 py-4 text-center">
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
          <button type="button" onClick={() => setPhase("pick")} className="cursor-pointer text-sm text-muted hover:text-ink">
            Zurück
          </button>
        </div>
      )}
    </CenterDialog>
  );
}
