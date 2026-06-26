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
import { formatBytes, formatRelativeTime } from "@/lib/format";
import { Badge, Button, Card, cn, EmptyState, Spinner } from "../ui";
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
        <div className="grid grid-cols-1 gap-4 px-6 pb-8 md:grid-cols-2 xl:grid-cols-3">
          {data.projects.map((p) => (
            <ProjectCard
              key={p.path}
              p={p}
              onClick={() => openDetail(p)}
              onReveal={() => revealInExplorer(p.path)}
            />
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
  onReveal,
}: {
  p: ProjectSummary;
  onClick: () => void;
  onReveal: () => void;
}) {
  const lang = langStyle(p.stack.primary);
  const blurb = p.readme ? cleanReadme(p.readme) : null;

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
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-line bg-surface text-left transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lg hover:shadow-black/30"
    >
      {/* language accent rail */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-0.5 opacity-60 transition-opacity group-hover:opacity-100"
        style={{ background: lang.color }}
      />

      {/* header */}
      <div className="flex items-start gap-3 px-4 pt-4">
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border text-[11px] font-bold tracking-tight"
          style={{
            color: lang.color,
            background: `${lang.color}14`,
            borderColor: `${lang.color}33`,
          }}
        >
          {lang.glyph}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-ink transition-colors group-hover:text-accent">
            {p.name}
          </div>
          <div className="truncate font-mono text-[11px] text-faint">
            {shortenPath(p.path)}
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onReveal();
          }}
          title="Open in Explorer"
          aria-label="Open in Explorer"
          className="-mr-1 -mt-1 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-faint opacity-0 transition-all hover:bg-raised hover:text-accent group-hover:opacity-100"
        >
          <FolderOpen className="size-4" />
        </button>
      </div>

      {/* stack: prominent language block + framework tags */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
        {p.stack.primary !== "Unknown" && (
          <span
            className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold"
            style={{
              color: lang.color,
              background: `${lang.color}14`,
              borderColor: `${lang.color}33`,
            }}
          >
            {p.stack.primary}
          </span>
        )}
        {p.stack.tags
          .filter((t) => t !== p.stack.primary)
          .slice(0, 4)
          .map((t) => (
            <span
              key={t}
              className="inline-flex items-center rounded-md border border-line bg-raised px-2 py-0.5 text-xs text-muted"
            >
              {t}
            </span>
          ))}
      </div>

      {blurb && (
        <p className="line-clamp-2 px-4 pt-3 text-xs leading-relaxed text-muted">
          {blurb}
        </p>
      )}

      {/* footer status bar */}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line/70 px-4 py-2.5 text-xs">
        {p.git.isRepo ? (
          <span className="flex min-w-0 items-center gap-2">
            <span className="inline-flex min-w-0 items-center gap-1 font-mono text-muted">
              <GitBranch className="size-3.5 shrink-0 text-faint" />
              <span className="truncate">{p.git.branch ?? "—"}</span>
            </span>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 font-medium",
                p.git.dirty
                  ? "bg-warn/10 text-warn"
                  : "bg-running/10 text-running",
              )}
            >
              <span className="size-1.5 rounded-full bg-current" />
              {p.git.dirty ? "dirty" : "clean"}
            </span>
            {(p.git.ahead > 0 || p.git.behind > 0) && (
              <span className="shrink-0 font-mono text-faint">
                ↑{p.git.ahead} ↓{p.git.behind}
              </span>
            )}
          </span>
        ) : (
          <span className="text-faint">no git</span>
        )}
        <span className="shrink-0 whitespace-nowrap text-faint">
          {formatRelativeTime(p.mtimeMs)}
          {p.sizeBytes != null && ` · ${formatBytes(p.sizeBytes)}`}
        </span>
      </div>
    </div>
  );
}

/** Per-language accent color + short glyph for the project tile. */
function langStyle(primary: string): { color: string; glyph: string } {
  const map: Record<string, { color: string; glyph: string }> = {
    "Node.js": { color: "#8cc84b", glyph: "JS" },
    Python: { color: "#4b8bbe", glyph: "Py" },
    Rust: { color: "#f97316", glyph: "Rs" },
    Go: { color: "#22d3ee", glyph: "Go" },
    ".NET": { color: "#a78bfa", glyph: ".N" },
    JVM: { color: "#ef4444", glyph: "Jv" },
    Flutter: { color: "#42a5f5", glyph: "Fl" },
    Ruby: { color: "#e0566f", glyph: "Rb" },
    PHP: { color: "#8893d8", glyph: "Php" },
  };
  return map[primary] ?? { color: "#6b7b8c", glyph: "·" };
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

function cleanReadme(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#+\s*/gm, "")
    .replace(/[`*_>[\]]/g, "")
    .replace(/!\(.*?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
