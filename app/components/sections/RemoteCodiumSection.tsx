"use client";

import { useCallback, useEffect, useState } from "react";
import { Monitor } from "lucide-react";
import { Button } from "../ui";

interface LocalCodiumStatus {
  starting: boolean;
  ready: boolean;
  url: string;
  error: string;
  dir: string;
}

const EMPTY: LocalCodiumStatus = {
  starting: false,
  ready: false,
  url: "",
  error: "",
  dir: "",
};

/**
 * VS Codium on this PC, in the folder the launcher uses for Local.
 * The remote SSH tab does not start or log into this editor.
 */
export default function RemoteCodiumSection() {
  const [status, setStatus] = useState<LocalCodiumStatus>(EMPTY);
  const [reload, setReload] = useState(0);

  const load = useCallback(() => {
    fetch("/api/codium")
      .then((r) => r.json())
      .then((d: LocalCodiumStatus) => setStatus({ ...EMPTY, ...d }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    void fetch("/api/codium", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    }).then(() => load());
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [load]);

  const retry = () => {
    void fetch("/api/codium", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    }).then(() => load());
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-5 py-2">
        <Monitor className="size-4 shrink-0 text-faint" />
        <div className="mr-auto min-w-0">
          <h2 className="text-sm font-semibold text-ink">VS Codium</h2>
          <p className="truncate text-[11px] text-faint">{status.dir || "Lokaler Projektordner"}</p>
        </div>
        {status.url && (
          <Button size="sm" onClick={() => setReload((n) => n + 1)}>
            Neu laden
          </Button>
        )}
        <Button size="sm" onClick={retry}>
          Erneut versuchen
        </Button>
      </header>
      {status.url ? (
        <iframe
          key={`${status.url}:${reload}`}
          title="VS Codium"
          src={status.url}
          className="min-h-0 w-full flex-1 border-0 bg-surface"
          referrerPolicy="no-referrer"
          allow="clipboard-read; clipboard-write"
        />
      ) : (
        <div className="grid flex-1 place-items-center px-6 text-center">
          <div className="max-w-md space-y-2">
            <p className="text-sm text-muted">
              {status.error || (status.starting ? "VS Codium startet lokal…" : "VS Codium startet lokal…")}
            </p>
            <p className="text-xs text-faint">
              Der Editor öffnet denselben lokalen Ordner wie der Launcher unter Local.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
