"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Save, X } from "lucide-react";
import { Button, cn } from "../ui";
import type { FileView } from "@/lib/file-view";

export interface OpenFile {
  path: string;
  name: string;
}

/**
 * File area that sits where the session grid sits. CodeMirror draws and edits
 * text. Pictures, PDF, audio, and video use the browser's own viewers.
 */
export default function FileWorkbench({
  source,
  files,
  activePath,
  onActivate,
  onClose,
}: {
  source: "local" | "remote";
  files: OpenFile[];
  activePath: string | null;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
}) {
  if (files.length === 0) {
    return (
      <div className="grid h-full place-items-center px-6 text-center text-sm text-faint">
        Datei links anklicken.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 overflow-auto border-b border-glass-border px-2 py-1.5">
        {files.map((file) => {
          const on = file.path === activePath;
          return (
            <div
              key={file.path}
              className={cn(
                "flex max-w-56 shrink-0 items-center rounded-lg",
                on ? "bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] text-ink" : "text-muted hover:bg-white/5",
              )}
            >
              <button
                type="button"
                onClick={() => onActivate(file.path)}
                className="cursor-pointer truncate px-2.5 py-1 text-left text-[12.5px]"
                title={file.path}
              >
                {file.name}
              </button>
              <button
                type="button"
                aria-label={`${file.name} schließen`}
                onClick={() => onClose(file.path)}
                className="mr-1 inline-flex size-5 cursor-pointer items-center justify-center rounded text-faint hover:text-ink"
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
      {files.map((file) => (
        <FileBody
          key={`${source}:${file.path}`}
          source={source}
          file={file}
          hidden={file.path !== activePath}
        />
      ))}
    </div>
  );
}

function FileBody({
  source,
  file,
  hidden,
}: {
  source: "local" | "remote";
  file: OpenFile;
  hidden: boolean;
}) {
  const [view, setView] = useState<FileView | null>(null);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const url =
      source === "remote"
        ? `/api/remote/file?path=${encodeURIComponent(file.path)}`
        : `/api/fs/file?path=${encodeURIComponent(file.path)}`;
    fetch(url)
      .then(async (r) => {
        const data = (await r.json()) as FileView & { error?: string };
        if (!r.ok || data.error) throw new Error(data.error || "Datei konnte nicht geöffnet werden.");
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setView(data);
        setDraft(data.content ?? "");
        setSaved(data.content ?? "");
        setError(null);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source, file.path]);

  const save = async () => {
    if (!view || view.kind !== "text" || saving) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(source === "remote" ? "/api/remote/file" : "/api/fs/file", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: file.path, content: draft }),
      });
      const data = (await r.json()) as { error?: string };
      if (!r.ok || data.error) throw new Error(data.error || "Speichern fehlgeschlagen.");
      setSaved(draft);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const dirty = draft !== saved;
  const showEditor = view?.kind === "text" && !view.tooLarge;

  return (
    <div className={hidden ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
      <div className="flex shrink-0 items-center gap-2 border-b border-glass-border px-3 py-1.5">
        <FileText className="size-3.5 shrink-0 text-faint" />
        <span className="truncate font-mono text-[11px] text-faint" title={file.path}>
          {file.path}
        </span>
        {showEditor && (
          <Button
            variant="primary"
            size="sm"
            icon={Save}
            className="ml-auto"
            loading={saving}
            disabled={!dirty}
            onClick={() => void save()}
          >
            Speichern
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {loading && <p className="px-4 py-3 text-sm text-faint">Wird geladen…</p>}
        {error && <p className="px-4 py-3 text-sm text-danger">{error}</p>}
        {view?.tooLarge && (
          <p className="px-4 py-3 text-sm text-muted">
            {view.name} ist zu gross für die Ansicht ({view.size} Bytes).
          </p>
        )}
        {view && !view.tooLarge && view.kind === "binary" && (
          <p className="px-4 py-3 text-sm text-muted">{view.name} ist eine Binärdatei ({view.size} Bytes).</p>
        )}
        {view && !view.tooLarge && view.kind === "image" && view.dataUrl && (
          <div className="grid h-full place-items-center overflow-auto p-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={view.dataUrl} alt={view.name} className="max-h-full max-w-full object-contain" />
          </div>
        )}
        {view && !view.tooLarge && view.kind === "pdf" && view.dataUrl && (
          <iframe title={view.name} src={view.dataUrl} className="h-full w-full border-0 bg-canvas" />
        )}
        {view && !view.tooLarge && view.kind === "audio" && view.dataUrl && (
          <div className="grid h-full place-items-center p-6">
            <audio controls src={view.dataUrl} />
          </div>
        )}
        {view && !view.tooLarge && view.kind === "video" && view.dataUrl && (
          <div className="grid h-full place-items-center p-6">
            <video controls src={view.dataUrl} className="max-h-full max-w-full" />
          </div>
        )}
        {showEditor && (
          <CodeEditor filename={view?.name || file.name} initial={saved} onChange={setDraft} onSave={() => void save()} />
        )}
      </div>
    </div>
  );
}

function CodeEditor({
  filename,
  initial,
  onChange,
  onSave,
}: {
  filename: string;
  initial: string;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    let destroyed = false;
    let editor: { destroy: () => void } | null = null;
    void (async () => {
      const [{ EditorView, basicSetup }, { keymap }, { oneDark }, { Compartment }, { languages }, { LanguageDescription }] =
        await Promise.all([
          import("codemirror"),
          import("@codemirror/view"),
          import("@codemirror/theme-one-dark"),
          import("@codemirror/state"),
          import("@codemirror/language-data"),
          import("@codemirror/language"),
        ]);
      if (destroyed || !host.current) return;
      const language = new Compartment();
      const view = new EditorView({
        parent: host.current,
        doc: initial,
        extensions: [
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                onSaveRef.current();
                return true;
              },
            },
          ]),
          basicSetup,
          oneDark,
          language.of([]),
          EditorView.theme({
            "&": { height: "100%", fontSize: "13px" },
            ".cm-scroller": {
              overflow: "auto",
              fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      });
      editor = view;
      if (destroyed) {
        view.destroy();
        return;
      }
      const found = LanguageDescription.matchFilename(languages, filename);
      if (!found) return;
      const support = await found.load();
      if (destroyed) return;
      view.dispatch({ effects: language.reconfigure(support) });
    })();
    return () => {
      destroyed = true;
      editor?.destroy();
    };
    // Mount once per file. Keystrokes stay in the CodeMirror document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename]);

  return <div ref={host} className="h-full min-h-0" />;
}
