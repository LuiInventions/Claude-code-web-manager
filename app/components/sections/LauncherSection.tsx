"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  FileText,
  FolderOpen,
  ListTree,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Rocket,
  Sparkles,
  Split,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { Badge, Button, Textarea, cn } from "../ui";
import type { SectionCommand } from "../app-commands";
import { MODEL_OPTIONS, EFFORT_OPTIONS } from "@/lib/launcher-config";
import ClaudeCmdPane from "./launcher/ClaudeCmdPane";
import UsageBar from "./launcher/UsageBar";
import { useSpeak } from "../use-speak";
import Markdown from "../Markdown";
import type { UsageState } from "@/lib/usage-store";
import { numberInstances, type WindowInstance } from "@/lib/window-instances";

interface ProjectOpt {
  name: string;
  path: string;
}
type Status = "running" | "done" | "error" | "stopped";

interface CmdInfo {
  cwd: string;
  prompt: string;
  model: string;
  effort: string;
  origin?: "github";
  repoFullName?: string;
}
interface LiveSession {
  id: string;
  /** Sessions started together (one Start click) share a batch and show as a grid. */
  batchId: string;
  /** Monotonic creation key — drives the stable instance number (oldest = #1). */
  createdAt: number;
  projectName: string;
  projectPath: string;
  prompt: string;
  status: Status;
  cmd: CmdInfo;
}

/** One AI-proposed sub-session in "KI Modus". */
interface SplitSession {
  title?: string;
  prompt: string;
}

/** A generated review report shown as its own page in the rail. */
interface ReviewPage {
  id: string;
  markdown: string;
  createdAt: number;
  title: string;
}

/** Selectable number of Claude boxes opened per Start. */
const BOX_COUNTS = [1, 2, 3, 4, 5, 6] as const;

/** Symmetric grid geometry for a number of visible boxes (≤2 → 1 column). */
function gridShape(n: number): { cols: number; rows: number } {
  const cols = n <= 2 ? 1 : 2;
  return { cols, rows: Math.max(1, Math.ceil(n / cols)) };
}

export default function LauncherSection({
  command,
}: {
  command?: SectionCommand | null;
}) {
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [githubProjects, setGithubProjects] = useState<ProjectOpt[]>([]);
  const [projectPath, setProjectPath] = useState("");
  const [pathMode, setPathMode] = useState<"list" | "manual">("list");
  const [raw, setRaw] = useState("");
  const [improved, setImproved] = useState("");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [boxCount, setBoxCount] = useState(1);
  const [phase, setPhase] = useState<"idle" | "improved" | "split" | "manual">("idle");
  const [improving, setImproving] = useState(false);
  const [improveError, setImproveError] = useState<string | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);
  const [splitSessions, setSplitSessions] = useState<SplitSession[]>([]);
  // "Ohne KI aufteilen": manually entered sub-prompts (1–6 fields).
  const [manualSessions, setManualSessions] = useState<SplitSession[]>([]);

  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageState | null>(null);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [reviews, setReviews] = useState<ReviewPage[]>([]);
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const { speak } = useSpeak();

  const blocked = !!(usage?.blockedUntil && usage.blockedUntil > nowTs);

  // origin/repoFullName carried from a Jarvis/GitHub prefill into the next start.
  const pendingOriginRef = useRef<{ origin: "github"; repoFullName?: string } | null>(null);

  // Load the Dashboard project list for the dropdown.
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => setProjects(d.projects ?? []))
      .catch(() => {});
  }, []);

  // Also offer the connected GitHub repos (cloned ones) in the same dropdown.
  useEffect(() => {
    fetch("/api/github")
      .then((r) => r.json())
      .then((d) => {
        const repos = (d?.repos ?? []) as Array<{
          name: string;
          localPath: string;
          cloneStatus: string;
        }>;
        setGithubProjects(
          repos
            .filter((r) => r.cloneStatus === "cloned" && r.localPath)
            .map((r) => ({ name: r.name, path: r.localPath })),
        );
      })
      .catch(() => {});
  }, []);

  // Restore still-running sessions after a page refresh / revisit: the PTYs
  // live server-side, so we re-list them and reconnect (scrollback is replayed).
  useEffect(() => {
    fetch("/api/launcher/live-sessions")
      .then((r) => r.json())
      .then((d) => {
        const live = (d.sessions ?? []) as Array<{
          id: string;
          batchId?: string;
          projectName?: string;
          cwd: string;
          prompt: string;
          model: string;
          effort: string;
          origin?: "github";
          repoFullName?: string;
          status: "running" | "done" | "error";
        }>;
        if (!live.length) return;
        // Server lists newest-first; assign descending creation keys so the
        // oldest restored session still becomes #1 under stable numbering.
        const restoreBase = Date.now();
        const rebuilt: LiveSession[] = live.map((s, i) => ({
          id: s.id,
          batchId: s.batchId || s.id,
          createdAt: restoreBase - i,
          projectName: s.projectName || "",
          projectPath: s.cwd,
          prompt: s.prompt,
          status: s.status,
          cmd: {
            cwd: s.cwd,
            prompt: s.prompt,
            model: s.model,
            effort: s.effort,
            origin: s.origin,
            repoFullName: s.repoFullName,
          },
        }));
        setSessions(rebuilt);
        setSelectedId(rebuilt[0].id);
        setSidebarOpen(false);
      })
      .catch(() => {});
  }, []);

  // Usage snapshot (no live stream in PTY mode; refresh on start/exit).
  const refreshUsage = useCallback(() => {
    fetch("/api/launcher/usage")
      .then((r) => r.json())
      .then((d) => setUsage(d as UsageState))
      .catch(() => {});
  }, []);
  useEffect(() => {
    refreshUsage();
  }, [refreshUsage]);

  // While blocked, tick once a second for the countdown and auto-unblock.
  useEffect(() => {
    if (!usage?.blockedUntil || usage.blockedUntil <= Date.now()) return;
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [usage?.blockedUntil]);

  const improve = useCallback(async () => {
    if (!projectPath || !raw.trim()) return;
    setImproving(true);
    setImproveError(null);
    try {
      const r = await fetch("/api/launcher/improve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectPath, prompt: raw }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setImproved(d.improvedPrompt ?? "");
      setPhase("improved");
    } catch (e) {
      setImproveError((e as Error).message);
    } finally {
      setImproving(false);
    }
  }, [projectPath, raw]);

  const nameForPath = (p: string) =>
    projects.find((x) => x.path === p)?.name ??
    githubProjects.find((x) => x.path === p)?.name ??
    p.split(/[\\/]/).filter(Boolean).pop() ??
    "";

  // Open one live PTY Claude session per prompt — a single batch shown as a
  // symmetric grid. Each box is an independent interactive session. Empty
  // prompts are allowed (interactive REPL with no initial task).
  const startBatch = (prompts: string[]) => {
    if (!projectPath || blocked || prompts.length === 0) return;
    const pn = nameForPath(projectPath);
    const po = pendingOriginRef.current;
    const stamp = Date.now().toString(36);
    const batchId = `b_${stamp}${Math.random().toString(36).slice(2, 5)}`;
    const startedAt = Date.now();
    const batch: LiveSession[] = prompts.map((pr, i) => ({
      id: `c_${stamp}${Math.random().toString(36).slice(2, 6)}_${i}`,
      batchId,
      createdAt: startedAt + i,
      projectName: pn,
      projectPath,
      prompt: pr,
      status: "running" as Status,
      cmd: {
        cwd: projectPath,
        prompt: pr,
        model,
        effort,
        origin: po?.origin,
        repoFullName: po?.repoFullName,
      },
    }));
    setSessions((prev) => [...batch, ...prev]);
    setSelectedId(batch[0].id);
    refreshUsage();
    setSidebarOpen(false); // maximize the terminals when a batch starts
    pendingOriginRef.current = null;
    setRaw("");
    setImproved("");
    setSplitSessions([]);
    setSplitError(null);
    setManualSessions([]);
    setPhase("idle");
  };

  // Normal start: `boxCount` boxes, all with the same (improved) prompt.
  const start = () => {
    if (!improved.trim()) return;
    startBatch(Array.from({ length: boxCount }, () => improved));
  };

  // "Ohne Verbesserung starten": `boxCount` boxes with the raw prompt as-is —
  // skips the AI improve step entirely.
  const startRaw = () => {
    if (!raw.trim()) return;
    startBatch(Array.from({ length: boxCount }, () => raw));
  };

  // "Ohne Prompt starten": `boxCount` empty interactive boxes.
  const startEmpty = () => startBatch(Array.from({ length: boxCount }, () => ""));

  // "Ohne KI aufteilen": open the manual split panel, seeded with one field
  // (prefilled from the raw prompt if present). The user adds up to 6 fields.
  const openManual = () => {
    const n = Math.min(Math.max(boxCount, 1), 6);
    setManualSessions(
      Array.from({ length: n }, (_, i) => ({
        prompt: i === 0 && raw.trim() ? raw : "",
      })),
    );
    setPhase("manual");
  };

  // Start the manual split: one box per non-empty manually entered prompt.
  const startManual = () => {
    const prompts = manualSessions.map((s) => s.prompt.trim()).filter(Boolean);
    if (prompts.length) startBatch(prompts);
  };

  // "KI Modus": ask the AI to rework + split the raw prompt into 1–6 sub-tasks.
  const runSplit = useCallback(async () => {
    if (!projectPath || !raw.trim()) return;
    setSplitting(true);
    setSplitError(null);
    try {
      const r = await fetch("/api/launcher/split", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectPath, prompt: raw }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      const sessions = (d.sessions ?? []) as SplitSession[];
      setSplitSessions(sessions.length ? sessions : [{ prompt: raw }]);
      setPhase("split");
    } catch (e) {
      setSplitError((e as Error).message);
    } finally {
      setSplitting(false);
    }
  }, [projectPath, raw]);

  // Start the AI-proposed split: one box per sub-prompt.
  const startSplit = () => {
    const prompts = splitSessions.map((s) => s.prompt.trim()).filter(Boolean);
    if (prompts.length) startBatch(prompts);
  };

  // Jarvis / GitHub: prefill the editable form — NEVER auto-start. The user
  // refines the prompt and presses Start.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!command) return;
    const p = command.payload as {
      projectPath?: string;
      projectName?: string;
      prompt?: string;
      origin?: "github";
      repoFullName?: string;
    };
    if (p?.projectPath) {
      setPathMode("manual");
      setProjectPath(p.projectPath);
      setRaw(p.prompt ?? "");
      setImproved("");
      setPhase("idle");
      pendingOriginRef.current = p.origin
        ? { origin: p.origin, repoFullName: p.repoFullName }
        : null;
    }
  }, [command?.nonce]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  // Stop a session for real. Sessions otherwise keep running server-side until
  // the PC is shut down — refreshing the page never kills them — so closing is
  // the one destructive action and is confirmed first.
  const closeSession = (id: string) => {
    const ok = window.confirm(
      "Diese Claude-Session wirklich stoppen?\n\n" +
        "Sie läuft sonst im Hintergrund weiter (auch nach Neuladen der Seite) " +
        "bis der PC heruntergefahren wird. Stoppen beendet sie endgültig.",
    );
    if (!ok) return;
    void fetch(`/api/launcher/live-sessions?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => {});
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  };

  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  // The active batch (the boxes shown in the grid) follows the selected session.
  const activeBatchId = selected?.batchId ?? sessions[0]?.batchId ?? null;
  const visibleCount = sessions.filter((s) => s.batchId === activeBatchId).length;
  const { cols, rows } = gridShape(visibleCount);
  // Distinct batches in list order (newest first) — one rail button per batch/page.
  const batchIds: string[] = [];
  for (const s of sessions) if (!batchIds.includes(s.batchId)) batchIds.push(s.batchId);

  // Stable per-instance numbers (oldest = #1) so each window can be referenced
  // unambiguously in the list and grid, even as newer ones are added.
  const numberById = new Map<string, number>(
    numberInstances(
      sessions.map(
        (s): WindowInstance => ({
          id: s.id,
          kind: "claude",
          label: s.projectPath || s.projectName,
          createdAt: s.createdAt,
          groupId: s.batchId,
        }),
      ),
    ).map((n) => [n.instance.id, n.number]),
  );

  const activeReview = activeReviewId
    ? (reviews.find((r) => r.id === activeReviewId) ?? null)
    : null;

  const doReview = async () => {
    if (sessions.length === 0 || reviewing) return;
    setReviewing(true);
    setReviewError(null);
    try {
      const payload = sessions
        .map((s) => ({ id: s.id, number: numberById.get(s.id) ?? 0 }))
        .filter((x) => x.number > 0)
        .sort((a, b) => a.number - b.number);
      const r = await fetch("/api/launcher/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessions: payload }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      const page: ReviewPage = {
        id: `rev_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
        markdown: String(d.markdown ?? ""),
        createdAt: Date.now(),
        title: new Date().toLocaleTimeString("de-DE", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };
      setReviews((prev) => [page, ...prev]);
      setActiveReviewId(page.id);
      void speak(String(d.speech ?? "")).catch(() => {});
    } catch (e) {
      setReviewError((e as Error).message);
    } finally {
      setReviewing(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <UsageBar usage={usage} now={nowTs} />
      <div className="flex min-h-0 flex-1">
        {/* Left: form + sessions — collapsible to maximize the terminal */}
        {sidebarOpen && (
        <div className="flex w-[26rem] shrink-0 flex-col border-r border-line bg-elevated">
          <div className="space-y-3 border-b border-line p-4">
            <div className="flex items-center gap-2">
              {pathMode === "list" ? (
                <select
                  value={projectPath}
                  onChange={(e) => setProjectPath(e.target.value)}
                  className="h-9 min-w-0 flex-1 cursor-pointer rounded-md border border-line bg-raised px-2.5 text-sm text-ink outline-none focus:border-accent"
                >
                  <option value="">Projekt wählen…</option>
                  {projects.length > 0 && (
                    <optgroup label="Projekte">
                      {projects.map((p) => (
                        <option key={p.path} value={p.path}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {githubProjects.length > 0 && (
                    <optgroup label="GitHub">
                      {githubProjects.map((p) => (
                        <option key={p.path} value={p.path}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              ) : (
                <input
                  value={projectPath}
                  onChange={(e) => setProjectPath(e.target.value)}
                  placeholder="Absoluter Pfad … z.B. C:\\Users\\…\\projekt"
                  spellCheck={false}
                  className="h-9 min-w-0 flex-1 rounded-md border border-line bg-raised px-2.5 font-mono text-[12.5px] text-ink outline-none focus:border-accent"
                />
              )}
              <button
                type="button"
                onClick={() => setPathMode((m) => (m === "list" ? "manual" : "list"))}
                title={pathMode === "list" ? "Eigenen Pfad eingeben" : "Aus Projektliste wählen"}
                className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 text-xs text-muted transition-colors hover:text-ink"
              >
                {pathMode === "list" ? (
                  <>
                    <FolderOpen className="size-3.5" /> Pfad wählen
                  </>
                ) : (
                  <>
                    <ListTree className="size-3.5" /> Liste
                  </>
                )}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-faint">
                  Modell
                </span>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="h-9 w-full cursor-pointer rounded-md border border-line bg-raised px-2.5 text-sm text-ink outline-none focus:border-accent"
                >
                  {MODEL_OPTIONS.map((o) => (
                    <option key={o.label} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-faint">
                  Effort
                </span>
                <select
                  value={effort}
                  onChange={(e) => setEffort(e.target.value)}
                  className="h-9 w-full cursor-pointer rounded-md border border-line bg-raised px-2.5 text-sm text-ink outline-none focus:border-accent"
                >
                  {EFFORT_OPTIONS.map((o) => (
                    <option key={o.label} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wide text-faint">
                Boxen
              </span>
              <div className="flex overflow-hidden rounded-md border border-line">
                {BOX_COUNTS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setBoxCount(n)}
                    title={`${n} Claude-Box${n > 1 ? "en" : ""} gleichzeitig öffnen`}
                    className={cn(
                      "cursor-pointer px-3 py-1.5 text-xs font-medium transition-colors",
                      boxCount === n
                        ? "bg-selected text-ink"
                        : "bg-raised text-muted hover:text-ink",
                    )}
                  >
                    ×{n}
                  </button>
                ))}
              </div>
            </div>

            {phase === "idle" && (
              <>
                <Textarea
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  rows={4}
                  placeholder="Roher Prompt … z.B. 'füge dark mode hinzu'"
                />
                {improveError && <p className="text-xs text-danger">{improveError}</p>}
                {splitError && <p className="text-xs text-danger">{splitError}</p>}
                <Button
                  variant="primary"
                  icon={Wand2}
                  className="w-full"
                  onClick={improve}
                  loading={improving}
                  disabled={!projectPath || !raw.trim()}
                >
                  Prompt verbessern
                </Button>
                <Button
                  variant="secondary"
                  icon={Zap}
                  className="w-full"
                  onClick={startRaw}
                  disabled={!projectPath || !raw.trim() || blocked}
                >
                  Ohne Verbesserung starten ({boxCount}×)
                </Button>
                <Button
                  variant="secondary"
                  icon={Sparkles}
                  className="w-full"
                  onClick={runSplit}
                  loading={splitting}
                  disabled={!projectPath || !raw.trim()}
                >
                  KI Modus: auf Sessions aufteilen
                </Button>
                <Button
                  variant="secondary"
                  icon={Split}
                  className="w-full"
                  onClick={openManual}
                  disabled={!projectPath}
                >
                  Ohne KI aufteilen
                </Button>
                <Button
                  variant="ghost"
                  icon={Play}
                  className="w-full"
                  onClick={startEmpty}
                  disabled={!projectPath || blocked}
                >
                  Ohne Prompt starten ({boxCount}×)
                </Button>
              </>
            )}

            {phase === "improved" && (
              <>
                <div className="text-xs font-medium uppercase tracking-wide text-faint">
                  Verbesserter Prompt (editierbar)
                </div>
                <Textarea
                  value={improved}
                  onChange={(e) => setImproved(e.target.value)}
                  rows={8}
                  className="font-mono text-[12.5px]"
                />
                <div className="flex gap-2">
                  <Button variant="ghost" icon={ArrowLeft} onClick={() => setPhase("idle")}>
                    Zurück
                  </Button>
                  <Button
                    variant="primary"
                    icon={Play}
                    className="flex-1"
                    onClick={start}
                    disabled={!improved.trim() || blocked}
                  >
                    {blocked ? "Limit erreicht" : "Claude Code starten"}
                  </Button>
                </div>
              </>
            )}

            {phase === "split" && (
              <>
                <div className="text-xs font-medium uppercase tracking-wide text-faint">
                  KI-Vorschlag · {splitSessions.length}{" "}
                  {splitSessions.length === 1 ? "Session" : "Sessions"} (editierbar)
                </div>
                <div className="max-h-[44vh] space-y-2 overflow-auto pr-1">
                  {splitSessions.map((s, i) => (
                    <div key={i} className="rounded-md border border-line bg-raised p-2">
                      <div className="mb-1 flex items-center gap-2 text-[11px] text-faint">
                        <span className="min-w-0 truncate font-medium text-muted">
                          #{i + 1}
                          {s.title ? ` · ${s.title}` : ""}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setSplitSessions((list) => list.filter((_, j) => j !== i))
                          }
                          title="Session entfernen"
                          aria-label="Session entfernen"
                          className="ml-auto inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-faint transition-colors hover:bg-surface hover:text-danger"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                      <Textarea
                        value={s.prompt}
                        onChange={(e) =>
                          setSplitSessions((list) =>
                            list.map((x, j) =>
                              j === i ? { ...x, prompt: e.target.value } : x,
                            ),
                          )
                        }
                        rows={3}
                        className="font-mono text-[12px]"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" icon={ArrowLeft} onClick={() => setPhase("idle")}>
                    Zurück
                  </Button>
                  <Button
                    variant="primary"
                    icon={Play}
                    className="flex-1"
                    onClick={startSplit}
                    disabled={
                      blocked || splitSessions.every((s) => !s.prompt.trim())
                    }
                  >
                    {blocked
                      ? "Limit erreicht"
                      : `Weiter · ${splitSessions.filter((s) => s.prompt.trim()).length} starten`}
                  </Button>
                </div>
              </>
            )}

            {phase === "manual" && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-xs font-medium uppercase tracking-wide text-faint">
                    Manuell aufteilen · {manualSessions.length}/6{" "}
                    {manualSessions.length === 1 ? "Session" : "Sessions"}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setManualSessions((list) =>
                        list.length >= 6 ? list : [...list, { prompt: "" }],
                      )
                    }
                    disabled={manualSessions.length >= 6}
                    title="Session hinzufügen"
                    aria-label="Session hinzufügen"
                    className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border border-line bg-raised text-muted transition-colors hover:border-line-strong hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus className="size-4" />
                  </button>
                </div>
                <div className="max-h-[44vh] space-y-2 overflow-auto pr-1">
                  {manualSessions.map((s, i) => (
                    <div key={i} className="rounded-md border border-line bg-raised p-2">
                      <div className="mb-1 flex items-center gap-2 text-[11px] text-faint">
                        <span className="min-w-0 truncate font-medium text-muted">
                          #{i + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setManualSessions((list) => list.filter((_, j) => j !== i))
                          }
                          title="Session entfernen"
                          aria-label="Session entfernen"
                          className="ml-auto inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-faint transition-colors hover:bg-surface hover:text-danger"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                      <Textarea
                        value={s.prompt}
                        onChange={(e) =>
                          setManualSessions((list) =>
                            list.map((x, j) =>
                              j === i ? { ...x, prompt: e.target.value } : x,
                            ),
                          )
                        }
                        rows={3}
                        placeholder={`Prompt für Session #${i + 1}…`}
                        className="font-mono text-[12px]"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" icon={ArrowLeft} onClick={() => setPhase("idle")}>
                    Zurück
                  </Button>
                  <Button
                    variant="primary"
                    icon={Play}
                    className="flex-1"
                    onClick={startManual}
                    disabled={
                      blocked || manualSessions.every((s) => !s.prompt.trim())
                    }
                  >
                    {blocked
                      ? "Limit erreicht"
                      : `${manualSessions.filter((s) => s.prompt.trim()).length} starten`}
                  </Button>
                </div>
              </>
            )}
          </div>

          <div className="space-y-1 border-b border-line px-4 py-3">
            <Button
              variant="secondary"
              icon={reviewing ? Loader2 : FileText}
              className="w-full"
              onClick={doReview}
              disabled={sessions.length === 0 || reviewing}
            >
              {reviewing ? "Sessions reviewen …" : "Sessions reviewen"}
            </Button>
            {reviewError && <p className="text-xs text-danger">{reviewError}</p>}
          </div>
          <div className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-faint">
            Sessions
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
            {sessions.length === 0 && (
              <p className="px-2 py-3 text-xs text-faint">Noch keine Sessions gestartet.</p>
            )}
            {sessions.map((s) => (
              <div
                key={s.id}
                className={cn(
                  "mb-1 flex items-start gap-1 rounded-md border pr-1 transition-colors",
                  s.id === selectedId
                    ? "border-line-strong bg-selected"
                    : "border-transparent hover:bg-raised",
                )}
              >
                <button
                  onClick={() => setSelectedId(s.id)}
                  className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 px-3 py-2 text-left"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <InstanceNumber n={numberById.get(s.id) ?? 0} active={s.id === selectedId} />
                      <span
                        dir="rtl"
                        title={s.projectPath || s.projectName}
                        className="truncate text-left text-sm text-ink"
                      >
                        {String.fromCharCode(0x200e) + (s.projectPath || s.projectName || "Projekt")}
                      </span>
                    </span>
                    <StatusPill status={s.status} />
                  </div>
                  <span className="truncate text-xs text-faint">{s.prompt}</span>
                </button>
                <button
                  onClick={() => closeSession(s.id)}
                  title="Session schließen"
                  aria-label="Session schließen"
                  className="mt-2 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-faint transition-colors hover:bg-raised hover:text-danger"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
        )}

        {/* Right: live terminals as a symmetric grid. Every pane stays mounted
            (non-active batches are display:none) so a PTY is never killed. */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {sessions.length > 0 ? (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b border-line bg-elevated px-3 py-2">
                <SidebarToggle open={sidebarOpen} onToggle={() => setSidebarOpen((v) => !v)} />
                <span className="text-xs text-faint">
                  {visibleCount} {visibleCount === 1 ? "Box" : "Boxen"}
                </span>
              </div>
              <div
                className="grid min-h-0 flex-1 gap-2 p-2"
                style={{
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
                }}
              >
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className={cn(
                      "relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-line",
                      s.batchId === activeBatchId ? "" : "hidden",
                    )}
                  >
                    <div className="absolute left-1.5 top-1.5 z-20">
                      <InstanceNumber n={numberById.get(s.id) ?? 0} active />
                    </div>
                    <button
                      onClick={() => closeSession(s.id)}
                      title="Box stoppen / schließen"
                      aria-label="Box schließen"
                      className="absolute right-1.5 top-1.5 z-20 inline-flex size-7 cursor-pointer items-center justify-center rounded-md border border-line bg-surface/80 text-faint backdrop-blur transition-colors hover:text-danger"
                    >
                      <X className="size-4" />
                    </button>
                    <ClaudeCmdPane
                      id={s.id}
                      cwd={s.cmd.cwd}
                      prompt={s.cmd.prompt}
                      model={s.cmd.model}
                      effort={s.cmd.effort}
                      origin={s.cmd.origin}
                      repoFullName={s.cmd.repoFullName}
                      projectName={s.projectName}
                      batchId={s.batchId}
                      onExit={(code) => {
                        setSessions((prev) =>
                          prev.map((x) =>
                            x.id === s.id
                              ? { ...x, status: code === 0 ? "done" : "error" }
                              : x,
                          ),
                        );
                        refreshUsage();
                      }}
                    />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="absolute left-3 top-3 z-10">
                <SidebarToggle open={sidebarOpen} onToggle={() => setSidebarOpen((v) => !v)} />
              </div>
              <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
                <div className="flex size-12 items-center justify-center rounded-xl border border-line bg-surface text-accent">
                  <Rocket className="size-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-medium text-ink">Claude Code Launcher</h3>
                  <p className="mx-auto max-w-sm text-sm text-muted">
                    Projekt wählen, Prompt schreiben, Anzahl der Boxen wählen, starten —
                    dann laufen die Sessions live als Terminal-Grid hier.
                  </p>
                </div>
              </div>
            </>
          )}
          {activeReview && (
            <div className="absolute inset-0 z-30 flex min-h-0 flex-col bg-canvas">
              <div className="flex shrink-0 items-center gap-2 border-b border-line bg-elevated px-3 py-2">
                <FileText className="size-4 text-accent" />
                <span className="text-sm font-medium text-ink">
                  Review {activeReview.title}
                </span>
                <button
                  onClick={() => setActiveReviewId(null)}
                  title="Review schließen"
                  aria-label="Review schließen"
                  className="ml-auto inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-faint transition-colors hover:bg-raised hover:text-danger"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-4">
                <Markdown>{activeReview.markdown}</Markdown>
              </div>
            </div>
          )}
        </div>

        {/* Right rail — batch pages (numbered) + review pages (doc icon). */}
        {(batchIds.length > 0 || reviews.length > 0) && (
          <div className="flex w-[52px] shrink-0 flex-col items-center gap-2 border-l border-line bg-elevated py-3">
            {batchIds.map((id, i) => (
              <button
                key={id}
                onClick={() => {
                  setActiveReviewId(null);
                  const first = sessions.find((s) => s.batchId === id);
                  if (first) setSelectedId(first.id);
                }}
                aria-label={`Seite ${i + 1}`}
                aria-current={!activeReviewId && id === activeBatchId}
                className={cn(
                  "flex size-9 cursor-pointer items-center justify-center rounded-md border text-sm font-medium transition-colors",
                  !activeReviewId && id === activeBatchId
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-line text-muted hover:border-accent/50 hover:text-ink",
                )}
              >
                {i + 1}
              </button>
            ))}
            {reviews.map((rev) => (
              <button
                key={rev.id}
                onClick={() => setActiveReviewId(rev.id)}
                title={`Review ${rev.title}`}
                aria-label={`Review ${rev.title}`}
                aria-current={activeReviewId === rev.id}
                className={cn(
                  "flex size-9 cursor-pointer items-center justify-center rounded-md border transition-colors",
                  activeReviewId === rev.id
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-line text-muted hover:border-accent/50 hover:text-ink",
                )}
              >
                <FileText className="size-4" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Small stable instance number badge ("#3") shared by the list and the grid. */
function InstanceNumber({ n, active }: { n: number; active?: boolean }) {
  if (n <= 0) return null;
  return (
    <span
      title={`Instanz #${n}`}
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 font-mono text-[11px] font-semibold tabular-nums",
        active
          ? "bg-accent/15 text-accent"
          : "bg-surface text-muted",
      )}
    >
      {n}
    </span>
  );
}

function SidebarToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const Icon = open ? PanelLeftClose : PanelLeftOpen;
  const label = open ? "Seitenleiste einklappen" : "Seitenleiste ausklappen";
  return (
    <button
      onClick={onToggle}
      title={label}
      aria-label={label}
      className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-faint transition-colors hover:bg-raised hover:text-accent"
    >
      <Icon className="size-4" />
    </button>
  );
}

function StatusPill({ status }: { status: Status }) {
  // "läuft" is the default state of every open session — showing a badge for it
  // just adds noise, so running sessions render no pill at all.
  if (status === "running") return null;
  if (status === "done")
    return (
      <Badge tone="running" dot>
        fertig
      </Badge>
    );
  if (status === "stopped") return <Badge tone="neutral">gestoppt</Badge>;
  return <Badge tone="danger">Fehler</Badge>;
}
