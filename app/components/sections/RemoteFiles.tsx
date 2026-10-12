"use client";

import { useEffect, useState } from "react";
import { Folder, File, ChevronLeft, Search } from "lucide-react";
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
 * Server files through the open SSH session. Search matches names under the
 * current folder. Right-click copies a path into the clipboard.
 */
export default function RemoteFiles({
  onUsePath,
}: {
  onUsePath: (path: string) => void;
}) {
  const [cwd, setCwd] = useState("~");
  const [query, setQuery] = useState("");
  const [listing, setListing] = useState<Listing>({ entries: [] });
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; dir: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ path: cwd });
      if (q) params.set("q", q);
      fetch(`/api/remote/fs?${params}`)
        .then((r) => r.json())
        .then((data: Listing) => {
          if (!cancelled) setListing(data);
        })
        .catch(() => {
          if (!cancelled) setListing({ error: "Dateiliste fehlgeschlagen.", entries: [] });
        });
    }, q ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cwd, query]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

  const entries = listing.entries ?? [];
  const shownPath = listing.path || cwd;

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-canvas">
      <div className="border-b border-line px-3 py-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-faint">Dateien</div>
        <div className="mt-2 flex items-center gap-1">
          <button
            type="button"
            title="Übergeordneter Ordner"
            onClick={() => setCwd(listing.parent || parentDir(shownPath))}
            className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-raised hover:text-ink"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={shownPath}>
            {shownPath}
          </div>
        </div>
        <label className="mt-2 flex items-center gap-2 rounded-md border border-line bg-raised px-2">
          <Search className="size-3.5 shrink-0 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Suchen"
            aria-label="Dateien suchen"
            className="h-8 w-full bg-transparent text-sm text-ink outline-none"
          />
        </label>
      </div>
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
              if (entry.dir) {
                setQuery("");
                setCwd(entry.path);
              }
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
          className="fixed z-50 min-w-44 rounded-md border border-line bg-surface py-1 shadow-none"
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
              onUsePath(menu.dir ? menu.path : parentDir(menu.path));
              setMenu(null);
            }}
          >
            Als Startordner
          </button>
        </div>
      )}
    </aside>
  );
}
