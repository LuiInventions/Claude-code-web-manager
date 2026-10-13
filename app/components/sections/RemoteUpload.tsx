"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { confirmUploadQuestion } from "@/lib/remote-upload-flow";
import { planTransfer, transferSummary } from "@/lib/remote-transfer";
import { cn } from "../ui";
import { CenterDialog, TransferProgress, TransferSuccess } from "./CenterDialog";
import { collectDataTransfer, itemsFromBrowserFiles, uploadLocalItems, type LocalItem } from "./remoteUppyUpload";

type Phase = "idle" | "confirm" | "work" | "done" | "error";

function openPicker(input: HTMLInputElement | null) {
  if (!input) return;
  try {
    input.showPicker();
    return;
  } catch {
    // showPicker throws when the browser refuses the gesture.
  }
  input.click();
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
  const [phase, setPhase] = useState<Phase>("idle");
  const [hot, setHot] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<LocalItem[]>([]);
  const [written, setWritten] = useState(0);
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState("");
  const [summary, setSummary] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const input = dirRef.current;
    input?.setAttribute("webkitdirectory", "");
    input?.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    const allow = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    window.addEventListener("dragover", allow);
    window.addEventListener("drop", allow);
    return () => {
      window.removeEventListener("dragover", allow);
      window.removeEventListener("drop", allow);
    };
  }, []);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (phaseRef.current !== "idle") return;
      const data = event.clipboardData;
      if (!data) return;
      const hasFile = data.files.length > 0 || [...data.items].some((item) => item.kind === "file");
      if (!hasFile) return;
      event.preventDefault();
      void offer(collectDataTransfer(data));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [dir]);

  const offer = async (incoming: Promise<LocalItem[]> | LocalItem[]) => {
    if (phaseRef.current === "work") return;
    setError("");
    let items: LocalItem[];
    try {
      items = await incoming;
    } catch (err) {
      setError((err as Error).message);
      setPhase("idle");
      return;
    }
    const planned = planTransfer(items);
    if (!planned.ok) {
      setError(planned.error);
      setPhase("idle");
      return;
    }
    setPending(items);
    setQuestion(confirmUploadQuestion(items, dir));
    setPhase("confirm");
  };

  const run = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase("work");
    setWritten(0);
    setTotal(0);
    setCurrent("");
    setError("");
    try {
      const result = await uploadLocalItems({
        dir,
        items: pending,
        signal: ctrl.signal,
        onProgress: (nextWritten, nextTotal, name) => {
          setWritten(nextWritten);
          setTotal(nextTotal);
          setCurrent(name);
        },
      });
      setSummary(transferSummary(result.files, result.bytes, result.dirs));
      setPhase("done");
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

  const cancel = () => {
    abortRef.current?.abort();
  };

  return (
    <CenterDialog
      title={phase === "done" ? "Hochgeladen" : phase === "work" ? "Wird hochgeladen" : "Dateien hochladen"}
      subtitle={dir}
      busy={phase === "work"}
      solid
      onClose={phase === "work" ? cancel : onClose}
    >
      {phase === "idle" && (
        <div className="grid gap-3">
          <div
            role="button"
            tabIndex={0}
            aria-label="Dateien auswählen"
            onClick={() => openPicker(fileRef.current)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openPicker(fileRef.current);
              }
            }}
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
              event.stopPropagation();
              depth.current = 0;
              setHot(false);
              void offer(collectDataTransfer(event.dataTransfer));
            }}
            className={cn(
              "grid h-64 cursor-pointer place-items-center rounded-2xl bg-[#4b2ad4] text-center text-white outline-none focus-visible:ring-2 focus-visible:ring-white",
              hot && "bg-[#6d4aff] ring-4 ring-white",
            )}
          >
            <span>
              <Plus className="mx-auto size-12" />
              <span className="mt-3 block text-sm font-semibold">Dateien oder Ordner hier ablegen</span>
              <span className="mt-1 block px-6 text-xs text-white/80">
                Bilder, Videos, Text, Code, PDF und Ordner · Klicken oder Strg+V · maximal 10 GB
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              const input = dirRef.current;
              if (!input) return;
              input.setAttribute("webkitdirectory", "");
              input.setAttribute("directory", "");
              openPicker(input);
            }}
            className="h-10 cursor-pointer rounded-xl bg-[#2c2158] text-sm font-semibold text-white hover:bg-[#3a2c78]"
          >
            Ordner wählen
          </button>
          {error && <p className="text-xs text-danger">{error}</p>}
          {/* No accept attribute: every file type must stay selectable. */}
          <input
            ref={fileRef}
            type="file"
            multiple
            tabIndex={-1}
            className="sr-only"
            onChange={(event) => {
              const list = event.target.files;
              event.target.value = "";
              if (list && list.length) void offer(itemsFromBrowserFiles([...list]));
            }}
          />
          <input
            ref={dirRef}
            type="file"
            multiple
            tabIndex={-1}
            className="sr-only"
            onChange={(event) => {
              const list = event.target.files;
              event.target.value = "";
              if (list && list.length) void offer(itemsFromBrowserFiles([...list]));
            }}
          />
        </div>
      )}
      {phase === "confirm" && (
        <div className="grid gap-5 py-2">
          <p className="break-all text-center text-[15px] font-medium leading-relaxed text-white">{question}</p>
          <div className="flex justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                setPending([]);
                setPhase("idle");
              }}
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
          <button type="button" onClick={cancel} className="mx-auto block cursor-pointer text-sm text-white/70 hover:text-white">
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
              setPending([]);
              setPhase("idle");
            }}
            className="cursor-pointer text-sm text-white/70 hover:text-white"
          >
            Zurück
          </button>
        </div>
      )}
    </CenterDialog>
  );
}
