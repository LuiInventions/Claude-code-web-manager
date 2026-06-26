"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  HardDrive,
} from "lucide-react";
import type { FsEntry } from "@/lib/fs-explorer";
import { cn, Spinner } from "./ui";

export async function fetchDir(
  path?: string,
): Promise<{ entries: FsEntry[]; truncated?: boolean }> {
  const url = path ? `/api/fs?path=${encodeURIComponent(path)}` : "/api/fs";
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

function norm(p: string): string {
  return p.replace(/[\\/]+$/, "").toLowerCase();
}
/** Is `target` the same as or nested under `parent`? */
function isUnder(target: string, parent: string): boolean {
  const t = norm(target);
  const p = norm(parent);
  return t === p || t.startsWith(p + "\\") || t.startsWith(p + "/");
}

/**
 * Lazy filesystem tree. `rootPath` omitted -> shows drives (Explorer);
 * `rootPath` set -> shows that folder's contents. `revealPath` auto-expands the
 * tree toward (and including) a target path. `selectDirs` makes folder clicks
 * also call `onOpenFile` (so a folder preview/summary shows).
 */
export function FileTree({
  rootPath,
  selectedPath,
  onOpenFile,
  revealPath,
  selectDirs,
}: {
  rootPath?: string;
  selectedPath: string | null;
  onOpenFile: (path: string) => void;
  revealPath?: string | null;
  selectDirs?: boolean;
}) {
  const [roots, setRoots] = useState<FsEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    /* eslint-disable react-hooks/set-state-in-effect -- reset to loading on rootPath change */
    setRoots(null);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    fetchDir(rootPath)
      .then((d) => on && setRoots(d.entries))
      .catch((e) => on && setError((e as Error).message));
    return () => {
      on = false;
    };
  }, [rootPath]);

  if (error) return <p className="px-4 py-2 text-xs text-danger">{error}</p>;
  if (!roots)
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  if (roots.length === 0)
    return <p className="px-4 py-2 text-xs text-faint">leer</p>;

  return (
    <>
      {roots.map((r) => (
        <TreeNode
          key={r.path}
          entry={r}
          depth={0}
          selected={selectedPath}
          onOpenFile={onOpenFile}
          isDrive={!rootPath}
          revealPath={revealPath ?? null}
          selectDirs={selectDirs}
        />
      ))}
    </>
  );
}

function TreeNode({
  entry,
  depth,
  selected,
  onOpenFile,
  isDrive,
  revealPath,
  selectDirs,
}: {
  entry: FsEntry;
  depth: number;
  selected: string | null;
  onOpenFile: (p: string) => void;
  isDrive?: boolean;
  revealPath: string | null;
  selectDirs?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rowRef = useRef<HTMLButtonElement>(null);

  const isDir = entry.type === "dir";
  const isSelected = selected === entry.path;
  const indent = depth * 14 + 8;

  const loadChildren = async () => {
    if (children !== null) return;
    setLoading(true);
    try {
      const d = await fetchDir(entry.path);
      setChildren(d.entries);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onClick = async () => {
    if (isDir) {
      if (selectDirs) onOpenFile(entry.path); // preview folder (README / summary)
      const next = !expanded;
      setExpanded(next);
      if (next) await loadChildren();
    } else {
      onOpenFile(entry.path);
    }
  };

  // Auto-reveal: expand toward AND including the target, scroll it into view.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!revealPath) return;
    if (isDir && isUnder(revealPath, entry.path)) {
      if (!expanded) setExpanded(true);
      void loadChildren();
    }
    if (norm(entry.path) === norm(revealPath)) {
      rowRef.current?.scrollIntoView({ block: "center" });
    }
  }, [revealPath]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  return (
    <div>
      <button
        ref={rowRef}
        onClick={onClick}
        style={{ paddingLeft: indent }}
        className={cn(
          "group flex w-full cursor-pointer items-center gap-1.5 py-1 pr-2 text-left text-[13px] transition-colors",
          isSelected ? "bg-selected text-ink" : "text-muted hover:bg-raised hover:text-ink",
        )}
      >
        {isDir ? (
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-faint transition-transform",
              expanded && "rotate-90",
            )}
          />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {isDrive ? (
          <HardDrive className="size-4 shrink-0 text-accent" />
        ) : isDir ? (
          expanded ? (
            <FolderOpen className="size-4 shrink-0 text-info" />
          ) : (
            <Folder className="size-4 shrink-0 text-info" />
          )
        ) : (
          <FileIcon className="size-4 shrink-0 text-faint" />
        )}
        <span className={cn("truncate", entry.hidden && "opacity-60")}>{entry.name}</span>
      </button>
      {expanded && (
        <div>
          {loading && (
            <div style={{ paddingLeft: indent + 14 }} className="py-1">
              <Spinner className="size-3.5" />
            </div>
          )}
          {err && (
            <p style={{ paddingLeft: indent + 14 }} className="py-1 pr-2 text-xs text-danger">
              {err}
            </p>
          )}
          {children?.map((c) => (
            <TreeNode
              key={c.path}
              entry={c}
              depth={depth + 1}
              selected={selected}
              onOpenFile={onOpenFile}
              revealPath={revealPath}
              selectDirs={selectDirs}
            />
          ))}
          {children && children.length === 0 && (
            <p style={{ paddingLeft: indent + 14 }} className="py-1 text-xs text-faint">
              leer
            </p>
          )}
        </div>
      )}
    </div>
  );
}
