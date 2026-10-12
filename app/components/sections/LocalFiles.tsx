"use client";

import { useEffect, useState } from "react";
import { Folder, File, Search } from "lucide-react";
import { cn } from "../ui";
import { copyText } from "../term-copy";

interface Entry {
  name: string;
  path: string;
  type: "dir" | "file";
}

interface Listing {
  path?: string;
  entries?: Entry[];
  error?: string;
}

function parentDir(path: string): string {
  const cut = path.replace(/[\\/]+$/, "");
  const i = Math.max(cut.lastIndexOf("/"), cut.lastIndexOf("\\"));
  if (i < 0) return cut;
  if (i === 0) return cut[0] === "/" ? "/" : cut;
  const parent = cut.slice(0, i);
  if (/^[A-Za-z]:$/.test(parent)) return parent + cut[i];
  return parent;
}

/**
 * Local folder list in the same shape as the remote file rail: search, then
 * rows. Clicking a folder writes that path into Ordner.
 */
export default function LocalFiles({
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
    const dir = path.trim();
    if (!dir) {
      setListing({ entries: [] });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ path: dir });
      fetch(`/api/fs?${params}`)
        .then((r) => r.json())
        .then((data: Listing) => {
          if (!cancelled) setListing(data.error ? { error: data.error, entries: [] } : data);
        })
        .catch(() => {
          if (!cancelled) setListing({ error: "Dateiliste fehlgeschlagen.", entries: [] });
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [path]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

  const q = query.trim().toLowerCase();
  const entries = (listing.entries ?? []).filter((entry) => !q || entry.name.toLowerCase().includes(q));
  const shown = listing.path || path;
  const up = shown.trim() ? parentDir(shown) : "";
  const canUp = Boolean(up && up !== shown);

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
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {!path.trim() && <p className="px-3 py-2 text-xs text-faint">Ordner öffnen, um Dateien zu sehen.</p>}
        {listing.error && <p className="px-3 py-2 text-xs text-danger">{listing.error}</p>}
        {canUp && (
          <button
            type="button"
            onClick={() => openDir(up)}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[13px] text-muted hover:bg-raised hover:text-ink"
          >
            <Folder className="size-3.5 shrink-0" />
            <span>..</span>
          </button>
        )}
        {path.trim() && entries.length === 0 && !listing.error && (
          <p className="px-3 py-2 text-xs text-faint">Keine Einträge.</p>
        )}
        {entries.map((entry) => (
          <button
            key={entry.path}
            type="button"
            onClick={() => {
              if (entry.type === "dir") openDir(entry.path);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenu({ x: e.clientX, y: e.clientY, path: entry.path, dir: entry.type === "dir" });
            }}
            className={cn(
              "flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink hover:bg-raised",
            )}
          >
            {entry.type === "dir" ? (
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
