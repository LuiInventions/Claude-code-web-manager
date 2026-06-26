// app/components/ConfirmPushModal.tsx
"use client";

import { useState } from "react";
import { GitPullRequestArrow, ShieldAlert, X } from "lucide-react";
import { Button, Input } from "./ui";

export default function ConfirmPushModal({
  repoName,
  repoPath,
  branch,
  changedFiles,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  repoName: string;
  repoPath: string;
  branch: string | null;
  changedFiles: string[];
  busy: boolean;
  error: string | null;
  onConfirm: (message: string) => void;
  onCancel: () => void;
}) {
  const [message, setMessage] = useState("Update via Jarvis Control Center");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4">
      <div className="w-full max-w-lg rounded-xl border border-line bg-elevated shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <ShieldAlert className="size-4 text-warn" />
          <span className="text-sm font-semibold text-ink">Push bestätigen</span>
          <button
            onClick={onCancel}
            aria-label="Abbrechen"
            className="ml-auto inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-faint transition-colors hover:bg-raised hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3 p-5">
          <p className="text-sm text-muted">
            <span className="font-medium text-ink">{repoName}</span> nach{" "}
            <span className="font-mono text-accent">origin/{branch ?? "—"}</span> pushen.
          </p>
          <p className="truncate font-mono text-[11px] text-faint" title={repoPath}>
            {repoPath}
          </p>

          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-faint">
              Geänderte Dateien ({changedFiles.length})
            </div>
            <ul className="max-h-40 overflow-auto rounded-md border border-line bg-surface p-2 font-mono text-[11px] text-muted">
              {changedFiles.length === 0 ? (
                <li className="text-faint">Keine uncommitteten Änderungen (nur Commits werden gepusht).</li>
              ) : (
                changedFiles.map((f) => <li key={f}>{f}</li>)
              )}
            </ul>
          </div>

          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-faint">
              Commit-Message
            </div>
            <Input value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            icon={GitPullRequestArrow}
            loading={busy}
            onClick={() => onConfirm(message.trim() || "Update via Jarvis Control Center")}
          >
            Bestätigen & Pushen
          </Button>
        </div>
      </div>
    </div>
  );
}
