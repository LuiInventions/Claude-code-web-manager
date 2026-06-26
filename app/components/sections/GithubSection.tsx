"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Code,
  FolderOpen,
  Globe,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Rocket,
  Plug,
  Settings,
  Unplug,
  X,
} from "lucide-react";
import type { GithubState, StoredRepo } from "@/lib/github-store";
import { Badge, Button, EmptyState, Input, Spinner, cn } from "../ui";
import { FileTree } from "../FileTree";
import { useAppCommands } from "../app-commands";

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? "";

const revealInExplorer = (path: string) =>
  fetch("/api/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  }).catch(() => {});

export default function GithubSection() {
  const { launchClaudeInRepo } = useAppCommands();
  const [state, setState] = useState<GithubState | null>(null);
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [visRepo, setVisRepo] = useState<StoredRepo | null>(null);

  const load = useCallback(async (silent = false) => {
    try {
      const r = await fetch("/api/github");
      const d = (await r.json()) as GithubState;
      setState(d);
      if (!silent) setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    load();
    // While clones are in flight, poll so statuses update live.
    const id = setInterval(() => load(true), 3000);
    return () => clearInterval(id);
  }, [load]);

  const connect = async () => {
    if (!token.trim()) return;
    setConnecting(true);
    setError(null);
    try {
      const r = await fetch("/api/github/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setToken("");
      setState(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  // Re-list repos from GitHub and pull/clone each to the latest remote state.
  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const r = await fetch("/api/github/refresh", { method: "POST" });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setState(d as GithubState);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const disconnect = async () => {
    await fetch("/api/github/disconnect", { method: "POST" }).catch(() => {});
    setState({ connected: false, login: null, name: null, avatarUrl: null, repos: [] });
  };

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!state.connected) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl border border-line bg-surface text-accent">
          <Code className="size-6" />
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-ink">Mit GitHub verbinden</h3>
          <p className="text-sm text-muted">
            Füge einen Personal Access Token (classic, Scope <code>repo</code>) ein. Er
            wird nur lokal gespeichert und nie an den Browser zurückgegeben.
          </p>
        </div>
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ghp_…"
          spellCheck={false}
        />
        {error && <p className="text-xs text-danger">{error}</p>}
        <Button
          variant="primary"
          icon={Plug}
          className="w-full"
          onClick={connect}
          loading={connecting}
          disabled={!token.trim()}
        >
          Verbinden
        </Button>
        <a
          href="https://github.com/settings/tokens/new?scopes=repo&description=jarvis-control-center"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-accent hover:underline"
        >
          Token erstellen →
        </a>
      </div>
    );
  }

  const cloning = state.repos.filter(
    (r) => r.cloneStatus === "cloning" || r.cloneStatus === "pending",
  ).length;

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-center justify-between gap-3 px-6 py-4">
        <p className="text-sm text-muted">
          Verbunden als <span className="font-medium text-ink">{state.login}</span>
          <span className="text-faint"> · {state.repos.length} Repos</span>
          {cloning > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs text-warn">
              <Loader2 className="size-3.5 animate-spin" /> {cloning} werden geklont…
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            icon={Plus}
            onClick={() => setCreating(true)}
          >
            Neues Repo
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={RefreshCw}
            onClick={refresh}
            loading={refreshing}
          >
            Aktualisieren
          </Button>
          <Button size="sm" variant="ghost" icon={Unplug} onClick={disconnect}>
            Trennen
          </Button>
        </div>
      </div>

      {error && (
        <div className="mx-6 mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {state.repos.length === 0 ? (
        <EmptyState icon={Code} title="Keine Repos" description="Es wurden keine Repos gefunden." />
      ) : (
        <div className="grid grid-cols-1 gap-4 px-6 pb-8 md:grid-cols-2 xl:grid-cols-3">
          {state.repos.map((r) => (
            <RepoCard
              key={r.fullName}
              repo={r}
              onEdit={launchClaudeInRepo}
              onOpen={revealInExplorer}
              onSettings={() => setVisRepo(r)}
            />
          ))}
        </div>
      )}

      {creating && (
        <CreateRepoModal
          onClose={() => setCreating(false)}
          onCreated={(s) => {
            setState(s);
            setCreating(false);
          }}
        />
      )}
      {visRepo && (
        <VisibilityModal
          repo={visRepo}
          onClose={() => setVisRepo(null)}
          onApplied={(s) => {
            setState(s);
            setVisRepo(null);
          }}
        />
      )}
    </div>
  );
}

/** Centered modal shell — dark backdrop, click-outside / ✕ to close. */
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-line bg-elevated shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h3 className="text-sm font-medium text-ink">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Schließen"
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-faint transition-colors hover:bg-raised hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Create a new GitHub repo from a local folder: pick a folder in the in-app
 * explorer, name it, choose public/private, then create + push.
 */
function CreateRepoModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (state: GithubState) => void;
}) {
  const [folder, setFolder] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    if (!folder || !name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/github/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderPath: folder, name: name.trim(), private: isPrivate }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      onCreated(d as GithubState);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Neues Repo erstellen" onClose={onClose}>
      <div className="flex min-h-0 flex-col gap-3 p-5">
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-faint">
            Ordner wählen
          </div>
          <div className="h-56 overflow-auto rounded-md border border-line bg-surface py-1">
            <FileTree
              selectedPath={folder}
              selectDirs
              onOpenFile={(p) => {
                setFolder(p);
                setName((cur) => (cur.trim() ? cur : baseName(p)));
              }}
            />
          </div>
          {folder && (
            <p className="mt-1 truncate font-mono text-[11px] text-muted" title={folder}>
              {folder}
            </p>
          )}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-faint">
            Repo-Name
          </span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="mein-repo"
            spellCheck={false}
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-faint">
            Sichtbarkeit
          </span>
          <div className="grid grid-cols-2 gap-2">
            <VisibilityChoice
              icon={Lock}
              label="Privat"
              hint="Nur du"
              active={isPrivate}
              onClick={() => setIsPrivate(true)}
            />
            <VisibilityChoice
              icon={Globe}
              label="Öffentlich"
              hint="Für alle sichtbar"
              active={!isPrivate}
              onClick={() => setIsPrivate(false)}
            />
          </div>
        </div>

        {err && <p className="text-xs text-danger">{err}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <Button variant="ghost" onClick={onClose}>
          Abbrechen
        </Button>
        <Button
          variant="primary"
          icon={Plus}
          onClick={create}
          loading={busy}
          disabled={!folder || !name.trim()}
        >
          Erstellen &amp; pushen
        </Button>
      </div>
    </Modal>
  );
}

/** Per-repo visibility editor: switch an existing repo public ↔ private. */
function VisibilityModal({
  repo,
  onClose,
  onApplied,
}: {
  repo: StoredRepo;
  onClose: () => void;
  onApplied: (state: GithubState) => void;
}) {
  const [isPrivate, setIsPrivate] = useState(repo.private);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const apply = async () => {
    if (isPrivate === repo.private) return onClose();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/github/visibility", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName: repo.fullName, private: isPrivate }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      onApplied(d as GithubState);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Einstellungen · ${repo.name}`} onClose={onClose}>
      <div className="flex flex-col gap-3 p-5">
        <div className="text-[11px] font-medium uppercase tracking-wide text-faint">
          Sichtbarkeit
        </div>
        <div className="grid grid-cols-2 gap-2">
          <VisibilityChoice
            icon={Lock}
            label="Privat"
            hint="Nur du"
            active={isPrivate}
            onClick={() => setIsPrivate(true)}
          />
          <VisibilityChoice
            icon={Globe}
            label="Öffentlich"
            hint="Für alle sichtbar"
            active={!isPrivate}
            onClick={() => setIsPrivate(false)}
          />
        </div>
        {err && <p className="text-xs text-danger">{err}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <Button variant="ghost" onClick={onClose}>
          Abbrechen
        </Button>
        <Button
          variant="primary"
          onClick={apply}
          loading={busy}
          disabled={isPrivate === repo.private}
        >
          Speichern
        </Button>
      </div>
    </Modal>
  );
}

function VisibilityChoice({
  icon: Icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon: typeof Lock;
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex cursor-pointer flex-col gap-0.5 rounded-md border px-3 py-2 text-left transition-colors",
        active
          ? "border-accent bg-accent/10 text-ink"
          : "border-line bg-raised text-muted hover:border-line-strong hover:text-ink",
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <Icon className="size-3.5" /> {label}
      </span>
      <span className="text-[11px] text-faint">{hint}</span>
    </button>
  );
}

function CloneBadge({ status }: { status: StoredRepo["cloneStatus"] }) {
  if (status === "cloned") return <Badge tone="running" dot>geklont</Badge>;
  if (status === "cloning") return <Badge tone="warn" dot pulse>klont…</Badge>;
  if (status === "error") return <Badge tone="danger" dot>Fehler</Badge>;
  return <Badge tone="neutral">wartet</Badge>;
}

function RepoCard({
  repo,
  onEdit,
  onOpen,
  onSettings,
}: {
  repo: StoredRepo;
  onEdit: (path: string, name: string, prompt: string) => void;
  onOpen: (path: string) => void;
  onSettings: () => void;
}) {
  const ready = repo.cloneStatus === "cloned";
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{repo.name}</div>
          <div className="truncate font-mono text-[11px] text-faint">{repo.fullName}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge tone="neutral">{repo.private ? "privat" : "öffentlich"}</Badge>
          <CloneBadge status={repo.cloneStatus} />
          <button
            onClick={onSettings}
            title="Einstellungen · Sichtbarkeit"
            aria-label="Einstellungen · Sichtbarkeit"
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-faint transition-colors hover:bg-raised hover:text-ink"
          >
            <Settings className="size-4" />
          </button>
        </div>
      </div>
      {repo.description && (
        <p className="line-clamp-2 text-xs text-muted">{repo.description}</p>
      )}
      <div className="mt-auto flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={FolderOpen}
          disabled={!ready}
          onClick={() => onOpen(repo.localPath)}
        >
          Öffnen
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={Rocket}
          className="flex-1"
          disabled={!ready}
          onClick={() =>
            onEdit(repo.localPath, repo.name, `Arbeite am Repo ${repo.name}.`)
          }
        >
          Mit Claude bearbeiten
        </Button>
      </div>
    </div>
  );
}
