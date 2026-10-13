"use client";

import { useRef, useState } from "react";
import { transferSummary } from "@/lib/remote-transfer";
import { CenterDialog, TransferProgress, TransferSuccess } from "./CenterDialog";

interface DownloadState {
  phase: "work" | "done" | "error";
  name: string;
  written: number;
  total: number;
  filesDone: number;
  files: number;
  error: string;
  folder: string;
  summary: string;
}

export function useRemoteDownload() {
  const [state, setState] = useState<DownloadState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = async (remotePath: string, directory: boolean, label: string) => {
    const desktop = window.cccDesktop;
    if (!desktop?.pickFolder) {
      const query = new URLSearchParams({ path: remotePath, dir: directory ? "1" : "0" });
      const link = document.createElement("a");
      link.href = `/api/remote/download?${query}`;
      link.download = directory ? `${label}.tar` : label;
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }
    const folder = await desktop.pickFolder("Zielordner auf diesem PC");
    if (!folder) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState({
      phase: "work",
      name: label,
      written: 0,
      total: 0,
      filesDone: 0,
      files: 0,
      error: "",
      folder,
      summary: "",
    });
    try {
      const res = await fetch("/api/remote/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: remotePath, dest: folder, dir: directory }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Herunterladen fehlgeschlagen.");
      }
      if (!res.body) throw new Error("Herunterladen fehlgeschlagen.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const take = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as {
          type?: string;
          error?: string;
          written?: number;
          total?: number;
          filesDone?: number;
          files?: number;
          name?: string;
          bytes?: number;
          folder?: string;
        };
        if (event.type === "error") throw new Error(event.error || "Herunterladen fehlgeschlagen.");
        if (event.type === "progress") {
          setState((prev) =>
            prev
              ? {
                  ...prev,
                  written: event.written ?? prev.written,
                  total: event.total ?? prev.total,
                  filesDone: event.filesDone ?? prev.filesDone,
                  files: event.files ?? prev.files,
                  name: event.name || prev.name,
                }
              : prev,
          );
        }
        if (event.type === "done") {
          setState((prev) =>
            prev
              ? {
                  ...prev,
                  phase: "done",
                  written: event.bytes ?? prev.written,
                  total: event.bytes ?? prev.total,
                  folder: event.folder || prev.folder,
                  summary: transferSummary(event.files ?? prev.files, event.bytes ?? prev.written),
                }
              : prev,
          );
        }
      };
      for (;;) {
        const step = await reader.read();
        if (step.done) break;
        buf += decoder.decode(step.value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) take(line);
      }
      if (buf.trim()) take(buf);
    } catch (err) {
      if (ctrl.signal.aborted) {
        setState(null);
        return;
      }
      setState((prev) =>
        prev ? { ...prev, phase: "error", error: (err as Error).message || "Herunterladen fehlgeschlagen." } : prev,
      );
    }
  };

  const close = () => {
    abortRef.current?.abort();
    setState(null);
  };

  const dialog = state ? (
    <CenterDialog
      title={state.phase === "done" ? "Gespeichert" : state.phase === "error" ? "Herunterladen" : "Wird heruntergeladen"}
      subtitle={state.folder}
      busy={state.phase === "work"}
      onClose={close}
    >
      {state.phase === "work" && (
        <div>
          <TransferProgress
            label="Wird heruntergeladen"
            written={state.written}
            total={state.total}
            detail={state.files > 0 ? `${state.filesDone} / ${state.files} · ${state.name}` : state.name}
          />
          <button type="button" onClick={close} className="mx-auto block cursor-pointer text-sm text-muted hover:text-ink">
            Abbrechen
          </button>
        </div>
      )}
      {state.phase === "done" && (
        <TransferSuccess
          title="Gespeichert"
          summary={state.summary}
          onClose={close}
          onOpen={
            window.cccDesktop?.openPath
              ? () => {
                  void window.cccDesktop?.openPath(state.folder);
                }
              : undefined
          }
        />
      )}
      {state.phase === "error" && <p className="py-4 text-center text-sm text-danger">{state.error}</p>}
    </CenterDialog>
  ) : null;

  return { start, dialog };
}
