"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, GitPullRequestArrow, RefreshCw, Trash2, Upload } from "lucide-react";
import type { PushEntry } from "@/lib/repo-push-store";
import type { SectionCommand } from "../app-commands";
import { formatRelativeTime } from "@/lib/format";
import { Badge, Button, EmptyState, Spinner } from "../ui";
import ConfirmPushModal from "../ConfirmPushModal";

/** Absolute local date+time, e.g. "26.06.26, 01:32". */
function formatChangedAt(ms: number): string {
  if (!ms) return "unbekannt";
  return new Date(ms).toLocaleString("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function RepoPushSection({
  command,
}: {
  command?: SectionCommand | null;
}) {
  const [queue, setQueue] = useState<PushEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<PushEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/repo-push");
      const d = (await r.json()) as { queue: PushEntry[] };
      const next = d.queue ?? [];
      setQueue(next);
    } catch {
      /* keep last */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load]);

  // Jarvis request_push action opens the modal for a specific repo.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!command) return;
    const p = command.payload as { requestPush?: { repoPath: string; repoName: string } };
    if (p?.requestPush) {
      const found = queue.find((e) => e.repoPath === p.requestPush!.repoPath);
      setActive(
        found ?? {
          repoPath: p.requestPush.repoPath,
          repoName: p.requestPush.repoName,
          reason: "jarvis",
          changedFiles: [],
          ahead: 0,
          status: "pending",
          addedAt: 0,
        },
      );
      setError(null);
    }
  }, [command?.nonce]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  // Remove a repo from the list (non-destructive — local changes stay on disk).
  const remove = async (repoPath: string) => {
    setQueue((q) => q.filter((e) => e.repoPath !== repoPath));
    try {
      await fetch(`/api/repo-push?repoPath=${encodeURIComponent(repoPath)}`, {
        method: "DELETE",
      });
    } catch {
      /* next poll re-syncs */
    }
    await load();
  };

  const push = async (message: string) => {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/repo-push/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoPath: active.repoPath, message }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setActive(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-center justify-between px-6 py-4">
        <p className="text-sm text-muted">{queue.length} Repo(s) warten auf Push</p>
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={load} loading={loading}>
          Aktualisieren
        </Button>
      </div>

      {loading && queue.length === 0 && (
        <div className="flex justify-center py-24">
          <Spinner className="size-6" />
        </div>
      )}

      {!loading && queue.length === 0 && (
        <EmptyState
          icon={Upload}
          title="Nichts zu pushen"
          description="Sobald Claude ein GitHub-Repo bearbeitet hat, erscheint es hier."
        />
      )}

      {queue.length > 0 && (
        <div className="grid grid-cols-1 gap-4 px-6 pb-8 md:grid-cols-2">
          {queue.map((e) => (
            <PushCard
              key={e.repoPath}
              entry={e}
              onPush={() => {
                setActive(e);
                setError(null);
              }}
              onRemove={() => void remove(e.repoPath)}
            />
          ))}
        </div>
      )}

      {active && (
        <ConfirmPushModal
          repoName={active.repoName}
          repoPath={active.repoPath}
          branch={null}
          changedFiles={active.changedFiles}
          busy={busy}
          error={error}
          onConfirm={push}
          onCancel={() => setActive(null)}
        />
      )}
    </div>
  );
}

function PushCard({
  entry,
  onPush,
  onRemove,
}: {
  entry: PushEntry;
  onPush: () => void;
  onRemove: () => void;
}) {
  const changed = entry.changedAt ?? entry.addedAt;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{entry.repoName}</div>
          <div className="truncate font-mono text-[11px] text-faint">{entry.repoPath}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {entry.status === "error" ? (
            <Badge tone="danger" dot>Fehler</Badge>
          ) : entry.status === "pushing" ? (
            <Badge tone="warn" dot pulse>pusht…</Badge>
          ) : (
            <Badge tone="warn" dot>{entry.changedFiles.length} Änderungen</Badge>
          )}
          <button
            type="button"
            onClick={onRemove}
            title="Aus Liste entfernen (Änderungen bleiben erhalten)"
            aria-label="Aus Liste entfernen"
            className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-faint transition-colors hover:bg-raised hover:text-danger"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
      <div
        className="flex items-center gap-1.5 text-[11px] text-muted"
        title={`Geändert ${formatRelativeTime(changed)}`}
      >
        <Clock className="size-3.5 shrink-0 text-faint" />
        <span>Geändert: {formatChangedAt(changed)}</span>
        <span className="text-faint">· {formatRelativeTime(changed)}</span>
      </div>
      {entry.message && <p className="text-xs text-danger">{entry.message}</p>}
      <Button
        size="sm"
        variant="primary"
        icon={GitPullRequestArrow}
        className="mt-auto"
        onClick={onPush}
      >
        Pushen
      </Button>
    </div>
  );
}
