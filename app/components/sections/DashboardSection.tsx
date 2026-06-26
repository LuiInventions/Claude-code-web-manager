"use client";

import { useCallback, useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  FolderGit2,
  FolderOpen,
  GitBranch,
  RefreshCw,
} from "lucide-react";
import type { ProjectDetail, ProjectSummary } from "@/lib/projects";
import type { GitStatus } from "@/lib/git";
import { Badge, Button, Card, EmptyState, Spinner } from "../ui";
import { FileTree } from "../FileTree";

interface ScanResult {
  projectsDir: string;
  projects: ProjectSummary[];
}

const revealInExplorer = (path: string) =>
  fetch("/api/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  }).catch(() => {});

export default function DashboardSection() {
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ProjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/projects");
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setData(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    load();
    const id = setInterval(() => load(true), 60000); // quiet auto-refresh
    return () => clearInterval(id);
  }, [load]);

  const openDetail = async (p: ProjectSummary) => {
    setDetailLoading(true);
    try {
      const res = await fetch(
        `/api/projects/detail?path=${encodeURIComponent(p.path)}`,
      );
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setSelected(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDetailLoading(false);
    }
  };

  if (selected)
    return (
      <ProjectDetailView project={selected} onBack={() => setSelected(null)} />
    );

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-center justify-between px-6 py-4">
        <p className="text-sm text-muted">
          {data ? `${data.projects.length} projects` : "Scanning…"}{" "}
          {data && (
            <span className="font-mono text-xs text-faint">
              · {data.projectsDir}
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {data && (
            <Button
              size="sm"
              variant="secondary"
              icon={FolderOpen}
              onClick={() => revealInExplorer(data.projectsDir)}
            >
              Open folder
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            icon={RefreshCw}
            onClick={() => load()}
            loading={loading}
          >
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="mx-6 mb-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex justify-center py-24">
          <Spinner className="size-6" />
        </div>
      )}

      {data && data.projects.length === 0 && (
        <EmptyState
          icon={FolderGit2}
          title="No projects found"
          description={`No projects found in ${data.projectsDir}. Change the projects folder in Settings.`}
        />
      )}

      {data && data.projects.length > 0 && (
        <div className="grid grid-cols-1 gap-1 px-4 pb-6 sm:grid-cols-2 lg:grid-cols-3">
          {data.projects.map((p) => (
            <ProjectCard key={p.path} p={p} onClick={() => openDetail(p)} />
          ))}
        </div>
      )}

      {detailLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/60">
          <Spinner className="size-6" />
        </div>
      )}
    </div>
  );
}

function ProjectCard({
  p,
  onClick,
}: {
  p: ProjectSummary;
  onClick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="flex cursor-pointer flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-raised"
    >
      <div className="truncate text-sm text-ink">{p.name}</div>
      <div className="truncate font-mono text-[11px] text-faint">
        {shortenPath(p.path)}
      </div>
    </div>
  );
}

/** Collapse a long absolute path to its last two segments. */
function shortenPath(full: string): string {
  const parts = full.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 2) return full;
  return `…/${parts.slice(-2).join("/")}`;
}

function ProjectDetailView({
  project,
  onBack,
}: {
  project: ProjectDetail;
  onBack: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-elevated px-5 py-3">
        <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={onBack}>
          Back
        </Button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-ink">{project.name}</span>
            {project.stack.primary !== "Unknown" && (
              <Badge tone="accent">{project.stack.primary}</Badge>
            )}
          </div>
          <div className="truncate font-mono text-[11px] text-faint">
            {project.path}
          </div>
        </div>
        <div className="ml-auto">
          <Button
            size="sm"
            variant="secondary"
            icon={FolderOpen}
            onClick={() => revealInExplorer(project.path)}
          >
            Show in Explorer
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-72 shrink-0 flex-col border-r border-line bg-elevated">
          <div className="border-b border-line px-4 py-2 text-xs font-medium uppercase tracking-wide text-faint">
            File tree
          </div>
          <div className="min-h-0 flex-1 overflow-auto py-1.5">
            <FileTree
              rootPath={project.path}
              selectedPath={null}
              onOpenFile={revealInExplorer}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-6">
          {project.git.isRepo && <GitPanel git={project.git} />}
          {project.readmeFull ? (
            <div className="md-body">
              <Markdown remarkPlugins={[remarkGfm]}>{project.readmeFull}</Markdown>
            </div>
          ) : (
            <p className="text-sm text-faint">No README found.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function GitPanel({ git }: { git: GitStatus }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2 text-sm">
        <GitBranch className="size-4 text-faint" />
        <span className="font-medium text-ink">{git.branch ?? "—"}</span>
        {git.dirty ? (
          <Badge tone="warn" dot>
            dirty
          </Badge>
        ) : (
          <Badge tone="running" dot>
            clean
          </Badge>
        )}
        {(git.ahead > 0 || git.behind > 0) && (
          <span className="text-xs text-faint">
            ↑{git.ahead} ↓{git.behind}
          </span>
        )}
      </div>
      {git.commits.length > 0 ? (
        <ul className="space-y-2">
          {git.commits.map((c) => (
            <li key={c.hash} className="flex items-start gap-2 text-xs">
              <span className="shrink-0 font-mono text-accent">{c.hash}</span>
              <span className="min-w-0 flex-1">
                <span className="text-ink">{c.subject}</span>{" "}
                <span className="text-faint">
                  · {c.relTime} · {c.author}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-faint">No commits yet.</p>
      )}
    </Card>
  );
}
