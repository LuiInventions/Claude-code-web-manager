"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { confirmUploadQuestion, imageSetFolderName, imageSetNames, imageSetPrompt, takeImages, uniqueImageName } from "@/lib/remote-upload-flow";
import { joinRemote, transferSummary } from "@/lib/remote-transfer";
import { cn } from "../ui";
import { CenterDialog, TransferProgress } from "./CenterDialog";
import { collectDataTransfer, uploadLocalItems, type LocalItem } from "./remoteUppyUpload";

interface PastedImage {
  id: string;
  name: string;
  size: number;
  file: File;
  url: string;
}

type Phase = "pick" | "confirm" | "work" | "copy" | "error";

function chipClass(on: boolean): string {
  return cn(
    "h-9 shrink-0 cursor-pointer rounded-lg px-3 text-sm font-semibold",
    on ? "bg-white text-[#1a1030]" : "bg-[#2c2158] text-white hover:bg-[#3a2c78]",
  );
}

function FolderBar({
  names,
  selected,
  allowNew,
  onSelect,
}: {
  names: string[];
  selected: string;
  allowNew: boolean;
  onSelect: (name: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <span className="text-xs font-medium text-[#d2c6f5]">Ordner</span>
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
            onClick={() => onSelect(name)}
            className={cn(chipClass(selected === name), "font-mono")}
          >
            {name}
          </button>
        ))}
        {names.length === 0 && !allowNew && <span className="text-sm text-[#d2c6f5]">Noch kein Bildordner</span>}
      </div>
    </div>
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
  onClose,
  onRefresh,
}: {
  dir: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [images, setImages] = useState<PastedImage[]>([]);
  const [error, setError] = useState("");
  const [folderName, setFolderName] = useState("");
  const [sets, setSets] = useState<string[]>([]);
  const [target, setTarget] = useState("new");
  const [listNonce, setListNonce] = useState(0);
  const [question, setQuestion] = useState("");
  const [queued, setQueued] = useState<LocalItem[]>([]);
  const [sentence, setSentence] = useState("");
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState<PastedImage | null>(null);
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
  const addRef = useRef<(incoming: File[]) => void>(() => {});
  imagesRef.current = images;
  phaseRef.current = phase;

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
      void collectDataTransfer(data).then((items) => {
        const incoming = items.flatMap((item) => (item.file ? [item.file] : []));
        if (incoming.length > 0) addRef.current(incoming);
      });
    };
    const onPaste = (event: ClipboardEvent) => {
      if (phaseRef.current !== "pick" || !event.clipboardData) return;
      const incoming = filesFromClipboard(event.clipboardData);
      if (incoming.length === 0) return;
      event.preventDefault();
      if (inputRef.current) inputRef.current.value = "";
      addRef.current(incoming);
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
    fetch(`/api/remote/fs?${params}`)
      .then((response) => response.json())
      .then((data: { entries?: { name: string; dir?: boolean }[] }) => {
        if (!cancelled) setSets(imageSetNames(data.entries ?? []));
      })
      .catch(() => {
        if (!cancelled) setSets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dir, listNonce]);

  const addFiles = (incoming: File[]) => {
    if (incoming.length === 0) return;
    const decision = takeImages(
      imagesRef.current,
      incoming.map((file) => ({ name: file.name || "bild", type: file.type, size: file.size })),
    );
    setError(decision.error);
    if (decision.take.length === 0) return;
    const next = decision.take.map((index) => {
      const file = incoming[index];
      const url = URL.createObjectURL(file);
      urlsRef.current.add(url);
      return {
        id: crypto.randomUUID(),
        name: file.name || "bild",
        size: file.size,
        file,
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
    if (image) {
      URL.revokeObjectURL(image.url);
      urlsRef.current.delete(image.url);
    }
    const next = imagesRef.current.filter((item) => item.id !== id);
    imagesRef.current = next;
    setImages(next);
    setZoom((currentZoom) => (currentZoom?.id === id ? null : currentZoom));
  };

  const goNext = () => {
    if (images.length === 0) return;
    const folder = target === "new" ? imageSetFolderName() : target;
    const folderPath = joinRemote(dir, folder);
    if (!folderPath) {
      setError("Pfad ungültig.");
      return;
    }
    const used = new Set<string>();
    const items: LocalItem[] = images.map((image) => ({
      rel: `${folder}/${uniqueImageName(image.name, used)}`,
      size: image.size,
      file: image.file,
    }));
    setFolderName(folder);
    setQueued(items);
    setQuestion(confirmUploadQuestion(items, dir));
    setSentence(imageSetPrompt(folderPath));
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
        dir,
        items: queued,
        signal: ctrl.signal,
        onProgress: (nextWritten, nextTotal, name) => {
          setWritten(nextWritten);
          setTotal(nextTotal);
          setCurrent(name);
        },
      });
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
    setTarget(name);
    if (name === "new") return;
    const path = joinRemote(dir, name);
    if (path) setSentence(imageSetPrompt(path));
  };

  const knownSets = folderName && !sets.includes(folderName) ? [folderName, ...sets] : sets;
  const previewPath = target !== "new" ? joinRemote(dir, target) : null;
  const previewSentence = previewPath ? imageSetPrompt(previewPath) : "";

  const copySentence = async (value = sentence) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      sentenceRef.current?.focus();
      sentenceRef.current?.select();
    }
  };

  const close = () => {
    if (zoom) {
      setZoom(null);
      return;
    }
    if (phase === "work") {
      abortRef.current?.abort();
      return;
    }
    onClose();
  };

  return (
    <CenterDialog
      title={phase === "copy" ? "Bilder hochgeladen" : phase === "work" ? "Wird hochgeladen" : "Bild hochladen"}
      subtitle={dir}
      busy={phase === "work"}
      solid
      wide
      onClose={close}
    >
      {phase === "pick" && (
        <div className="grid gap-4">
          <FolderBar names={sets} selected={target} allowNew onSelect={selectFolder} />
          <p className="text-xs text-[#d2c6f5]">
            {target === "new" ? "Jeder Upload legt einen neuen Ordner an." : `Neue Bilder kommen in ${target}.`}
          </p>
          {previewSentence && (
            <div className="flex gap-2">
              <input
                readOnly
                value={previewSentence}
                onFocus={(event) => event.currentTarget.select()}
                aria-label="Satz für die KI"
                className="h-12 min-w-0 flex-1 rounded-xl border-2 border-[#7c5cff] bg-[#120a24] px-4 font-mono text-sm text-white outline-none"
              />
              <button
                type="button"
                onClick={() => void copySentence(previewSentence)}
                className="h-12 cursor-pointer rounded-xl bg-white px-4 text-sm font-semibold text-[#1a1030] hover:bg-[#efeaff]"
              >
                {copied ? "Kopiert" : "Kopieren"}
              </button>
            </div>
          )}
          <div className="grid min-h-56 grid-cols-2 gap-3 rounded-2xl bg-[#120a24] p-3 sm:grid-cols-5">
            {images.length === 0 && (
              <p className="col-span-full grid place-items-center text-sm text-[#d2c6f5]">Noch keine Bilder</p>
            )}
            {images.map((image) => (
              <div key={image.id} className="relative aspect-square">
                <button
                  type="button"
                  onClick={() => setZoom(image)}
                  className="size-full cursor-pointer overflow-hidden rounded-xl bg-[#2a1b4a]"
                  aria-label={`${image.name} vergrössern`}
                >
                  <img src={image.url} alt={image.name} className="size-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 truncate bg-[#1a1030] px-1.5 py-1 text-left text-[10px] text-white">
                    {image.name}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`${image.name} entfernen`}
                  onClick={() => remove(image.id)}
                  className="absolute right-1 top-1 z-10 inline-flex size-6 cursor-pointer items-center justify-center rounded-md bg-[#1a1030] text-white"
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
            className="h-12 w-full rounded-xl border-2 border-[#7c5cff] bg-[#120a24] px-4 text-sm text-white outline-none placeholder:text-[#c4b6ef]"
          />
          <p className="text-xs text-[#d2c6f5]">
            {images.length} / 10 · bis zu 10 Bilder, zusammen maximal 2 GB
          </p>
          {error && <p className="text-xs text-danger">{error}</p>}
          <button
            type="button"
            disabled={images.length === 0}
            onClick={goNext}
            className="h-11 cursor-pointer rounded-xl bg-white text-sm font-semibold text-[#1a1030] hover:bg-[#efeaff] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Weiter
          </button>
        </div>
      )}
      {phase === "confirm" && (
        <div className="grid gap-5 py-2">
          <p className="break-all text-center text-[15px] font-medium leading-relaxed text-white">{question}</p>
          <div className="flex justify-center gap-3">
            <button
              type="button"
              onClick={() => setPhase("pick")}
              className="h-11 cursor-pointer rounded-xl bg-[#2c2158] px-5 text-sm font-semibold text-white hover:bg-[#3a2c78]"
            >
              Zurück
            </button>
            <button
              type="button"
              onClick={() => void run()}
              className="h-11 cursor-pointer rounded-xl bg-white px-5 text-sm font-semibold text-[#1a1030] hover:bg-[#efeaff]"
            >
              Hochladen
            </button>
          </div>
        </div>
      )}
      {phase === "work" && (
        <div>
          <TransferProgress label="Wird hochgeladen" written={written} total={total} detail={current} />
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="mx-auto block cursor-pointer text-sm text-white/70 hover:text-white"
          >
            Abbrechen
          </button>
        </div>
      )}
      {phase === "copy" && (
        <div className="grid gap-4 py-2">
          <p className="text-center text-sm font-semibold text-white">Die Bilder liegen auf dem Server.</p>
          <p className="text-center text-xs text-[#d2c6f5]">{summary}</p>
          <FolderBar
            names={knownSets}
            selected={target === "new" ? folderName : target}
            allowNew={false}
            onSelect={selectFolder}
          />
          <label className="grid gap-2">
            <span className="text-xs font-medium text-[#d2c6f5]">Satz für die KI</span>
            <div className="flex gap-2">
              <input
                ref={sentenceRef}
                readOnly
                value={sentence}
                onFocus={(event) => event.currentTarget.select()}
                aria-label="Satz für die KI"
                className="h-12 min-w-0 flex-1 rounded-xl border-2 border-[#7c5cff] bg-[#120a24] px-4 font-mono text-sm text-white outline-none"
              />
              <button
                type="button"
                onClick={() => void copySentence()}
                className="h-12 cursor-pointer rounded-xl bg-white px-4 text-sm font-semibold text-[#1a1030] hover:bg-[#efeaff]"
              >
                {copied ? "Kopiert" : "Kopieren"}
              </button>
            </div>
          </label>
          <button
            type="button"
            onClick={onClose}
            className="h-11 cursor-pointer rounded-xl bg-[#2c2158] text-sm font-semibold text-white hover:bg-[#3a2c78]"
          >
            Schliessen
          </button>
        </div>
      )}
      {phase === "error" && (
        <div className="grid gap-3 py-4 text-center">
          <p className="text-sm text-danger">{error}</p>
          <button type="button" onClick={() => setPhase("pick")} className="cursor-pointer text-sm text-white/70 hover:text-white">
            Zurück
          </button>
        </div>
      )}
      {zoom && (
        <div className="absolute inset-0 z-10 grid content-center justify-items-center gap-4 rounded-2xl bg-[#120a24] p-6">
          <img src={zoom.url} alt={zoom.name} className="max-h-[60vh] max-w-full rounded-xl object-contain" />
          <p className="max-w-full truncate text-xs text-[#d2c6f5]">{zoom.name}</p>
          <button
            type="button"
            onClick={() => setZoom(null)}
            className="h-10 cursor-pointer rounded-xl bg-white px-4 text-sm font-semibold text-[#1a1030]"
          >
            Schliessen
          </button>
        </div>
      )}
    </CenterDialog>
  );
}
