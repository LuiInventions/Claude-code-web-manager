"use client";

import { useEffect, useState } from "react";
import { Folder, File, Search, ChevronLeft } from "lucide-react";
import { cn } from "../ui";
import { copyText } from "../term-copy";

interface Entry {
  name: string;
  path: string;
  dir: boolean;
}

interface Listing {
  path?: string;
  parent?: string;
  entries?: Entry[];
  error?: string;
}

function parentDir(path: string): string {
  const cut = path.replace(/\/+$/, "");
  const i = cut.lastIndexOf("/");
  if (i <= 0) return "/";
  return cut.slice(0, i);
}

/**
 * Server files under the Remote rail, from the search field down.
 * The current directory lives in the Ordner field. Clicking a folder writes
 * that path there. Right-click copies a path.
 */
export default function RemoteFiles({
  path,
  onPathChange,
}: {
  path: string;
  onPathChange: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [listing, setListing] = useState<Listing>({ entries: [] });
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; dir: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ path: path.trim() || "~" });
      if (q) params.set("q", q);
      fetch(`/api/remote/fs?${params}`)
        .then((r) => r.json())
        .then((data: Listing) => {
          if (!cancelled) setListing(data);
        })
        .catch(() => {
          if (!cancelled) setListing({ error: "Dateiliste fehlgeschlagen.", entries: [] });
        });
    }, q ? 250 : 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [path, query]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

  const entries = listing.entries ?? [];
  const shownPath = listing.path || path;
  const up = listing.parent && listing.parent !== shownPath ? listing.parent : "";

  const openDir = (next: string) => {
    setQuery("");
    onPathChange(next);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-glass-border">
      <label className="flex items-center gap-2 border-b border-glass-border px-3">
        <Search className="size-3.5 shrink-0 text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Suchen"
          aria-label="Dateien suchen"
          className="h-9 w-full bg-transparent text-sm text-ink outline-none"
        />
      </label>
      {up && (
        <div className="px-3 py-2">
          <button
            type="button"
            onClick={() => openDir(up)}
            className="inline-flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-raised/80 text-[13px] font-medium text-muted transition-colors hover:text-ink"
          >
            <ChevronLeft className="size-4" />
            Zurück
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {listing.error && <p className="px-3 py-2 text-xs text-danger">{listing.error}</p>}
        {entries.length === 0 && !listing.error && (
          <p className="px-3 py-2 text-xs text-faint">Keine Einträge.</p>
        )}
        {entries.map((entry) => (
          <button
            key={entry.path}
            type="button"
            onClick={() => {
              if (entry.dir) openDir(entry.path);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenu({ x: e.clientX, y: e.clientY, path: entry.path, dir: entry.dir });
            }}
            className={cn(
              "flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink hover:bg-raised",
            )}
          >
            {entry.dir ? (
              <Folder className="size-3.5 shrink-0 text-muted" />
            ) : (
              <File className="size-3.5 shrink-0 text-faint" />
            )}
            <span className="truncate">{entry.name}</span>
          </button>
        ))}
      </div>
      {menu && (
        <div
          className="glass-pane fixed z-50 min-w-44 rounded-lg py-1"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm text-ink hover:bg-raised"
            onClick={() => {
              void copyText(menu.path);
              setMenu(null);
            }}
          >
            Pfad kopieren
          </button>
          <button
            type="button"
            className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm text-ink hover:bg-raised"
            onClick={() => {
              openDir(menu.dir ? menu.path : parentDir(menu.path));
              setMenu(null);
            }}
          >
            Als Startordner
          </button>
        </div>
      )}
    </div>
  );
}
