"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  FileText,
  FolderOpen,
  ImagePlus,
  ListTree,
  Loader2,
  Play,
  Plus,
  Sparkles,
  Split,
  Upload,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { Badge, Button, Textarea, cn } from "../ui";
import { commandPayloads, type SectionCommand } from "../app-commands";
import { MODEL_OPTIONS, EFFORT_OPTIONS } from "@/lib/launcher-config";
import ClaudeCmdPane from "./launcher/ClaudeCmdPane";
import LocalFiles from "./LocalFiles";
import RemoteImageUpload from "./RemoteImageUpload";
import RemoteUpload from "./RemoteUpload";
import FileWorkbench, { type OpenFile } from "./FileWorkbench";
import { ViewBar } from "./SessionBar";
import UsageBar from "./launcher/UsageBar";
import { useSpeak } from "../use-speak";
import Markdown from "../Markdown";
import type { UsageState } from "@/lib/usage-store";
import { numberInstances, type WindowInstance } from "@/lib/window-instances";

interface ProjectOpt {
  name: string;
  path: string;
  fullName?: string;
}

function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** True when `child` is `root` or a folder inside it. */
function sameOrInside(child: string, root: string): boolean {
  if (!child || !root) return false;
  const c = normPath(child);
  const r = normPath(root);
  return c === r || c.startsWith(`${r}/`);
}
type Status = "running" | "done" | "error" | "stopped";

interface CmdInfo {
  cwd: string;
  prompt: string;
  model: string;
  effort: string;
  origin?: "github";
  repoFullName?: string;
  where?: "remote";
  cli?: string;
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

/** Selectable number of CLI boxes opened per Start. */
const BOX_COUNTS = [1, 2, 3, 4, 5, 6] as const;

interface CodeCliOpt {
  id: string;
  label: string;
  shortLabel: string;
  models: { label: string; value: string }[];
  efforts: { label: string; value: string }[];
}

/** Symmetric grid geometry for a number of visible boxes (≤2 → 1 column). */
function gridShape(n: number): { cols: number; rows: number } {
  const cols = n <= 2 ? 1 : 2;
  return { cols, rows: Math.max(1, Math.ceil(n / cols)) };
}

export default function LauncherSection({
  command,
  sourceLock,
}: {
  command?: SectionCommand | null;
  sourceLock: "local" | "github";
}) {
  const source = sourceLock;
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [githubProjects, setGithubProjects] = useState<ProjectOpt[]>([]);
  const [githubConnected, setGithubConnected] = useState(false);
  const [githubRestoring, setGithubRestoring] = useState(false);
  const [projectPath, setProjectPath] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [filesNonce, setFilesNonce] = useState(0);
  const localPathRef = useRef("");
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
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [pane, setPane] = useState<"files" | "sessions">("files");
  const [reviews, setReviews] = useState<ReviewPage[]>([]);
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [hasAiKey, setHasAiKey] = useState(false);
  const [codeCli, setCodeCli] = useState<CodeCliOpt | null>(null);
  const { speak } = useSpeak();

  const cliName = codeCli?.shortLabel ?? "Claude Code";
  const modelOptions = codeCli?.models ?? MODEL_OPTIONS;
  const effortOptions = codeCli?.efforts ?? EFFORT_OPTIONS;
  // The usage bar and its block are Claude Code's rate limit. Grok and Codex
  // keep starting when that limit is hit.
  const blocked =
    (codeCli?.id ?? "claude") === "claude" &&
    !!(usage?.blockedUntil && usage.blockedUntil > nowTs);
  const canStart = Boolean(projectPath);
  const startBlocked = blocked;

  // Drop a model/effort that belongs to the previously selected CLI.
  useEffect(() => {
    if (!codeCli) return;
    setModel((m) => (codeCli.models.some((o) => o.value === m) ? m : ""));
    setEffort((e) => (codeCli.efforts.some((o) => o.value === e) ? e : ""));
  }, [codeCli]);

  // origin/repoFullName carried from a Jarvis/GitHub prefill into the next start.
  const pendingOriginRef = useRef<{ origin: "github"; repoFullName?: string } | null>(null);

  // Load the Local Projects list for the dropdown.
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => setProjects(d.projects ?? []))
      .catch(() => {});
  }, []);

  // xterm is imported when a box mounts. Start that download as soon as the
  // launcher is open so the first session does not wait on the chunk.
  useEffect(() => {
    void import("@xterm/xterm");
    void import("@xterm/addon-fit");
  }, []);

  // Whether an AI provider key is configured — gates the prompt-improver and
  // session-review actions (they need an AI provider). Also tracks the coding
  // CLI chosen in setup/settings, polled so a change there shows up here
  // without a reload (sections stay mounted when you switch tabs).
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/settings")
        .then((r) => r.json())
        .then(
          (c: {
            hasAiKey?: boolean;
            codeCli?: string;
            codeClis?: CodeCliOpt[];
            launcherLocalPath?: string;
            projectsDir?: string;
          }) => {
            if (cancelled) return;
            setHasAiKey(Boolean(c.hasAiKey));
            if (c.launcherLocalPath) localPathRef.current = c.launcherLocalPath;
            // Local starts in the projects folder from Settings. A folder the
            // user already picked in this visit stays put.
            const folder = (c.projectsDir || "").trim();
            if (source === "local" && folder) {
              setProjectPath((prev) => prev || folder);
            }
            const list = c.codeClis ?? [];
            const next = list.find((x) => x.id === c.codeCli) ?? list[0] ?? null;
            setCodeCli((prev) => (prev?.id === next?.id ? prev : next));
          },
        )
        .catch(() => {});
    load();
    const id = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [source]);

  useEffect(() => {
    if (source !== "github") return;
    if (!githubConnected) {
      setProjectPath("");
      return;
    }
    setProjectPath((prev) => {
      if (githubProjects.some((p) => sameOrInside(prev, p.path))) return prev;
      return githubProjects[0]?.path ?? "";
    });
  }, [source, githubConnected, githubProjects]);

  // VS Codium opens this same local folder. Remember it when Local is selected.
  useEffect(() => {
    if (source !== "local" || !projectPath) return;
    localPathRef.current = projectPath;
    const t = setTimeout(() => {
      void fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ launcherLocalPath: projectPath }),
      });
    }, 400);
    return () => clearTimeout(t);
  }, [source, projectPath]);

  // Also offer the connected GitHub repos (cloned ones) in the same dropdown.
  // Poll instead of fetching once: on first app start the repos are still
  // cloning in the background (status "pending"/"cloning") and would be filtered
  // out, leaving the dropdown empty until a manual page reload. Polling picks up
  // each repo the moment its clone finishes — no refresh needed.
  useEffect(() => {
    let cancelled = false;
    const loadGithub = () =>
      fetch("/api/github?lite=1")
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          setGithubConnected(Boolean(d?.connected));
          const repos = (d?.repos ?? []) as Array<{
            name: string;
            fullName?: string;
            localPath: string;
            cloneStatus: string;
          }>;
          const next = repos
            .filter((r) => r.cloneStatus === "cloned" && r.localPath)
            .map((r) => ({
              name: r.name,
              path: r.localPath,
              fullName: r.fullName || r.name,
            }));
          setGithubRestoring(
            next.length === 0 &&
              repos.some((r) => r.cloneStatus === "pending" || r.cloneStatus === "cloning"),
          );
          // A new array every poll re-rendered the terminals. Keep the old
          // one when the clone list did not change.
          setGithubProjects((prev) =>
            prev.length === next.length &&
            prev.every(
              (p, i) =>
                p.path === next[i].path &&
                p.name === next[i].name &&
                p.fullName === next[i].fullName,
            )
              ? prev
              : next,
          );
        })
        .catch(() => {});
    loadGithub();
    const id = setInterval(loadGithub, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
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
          where?: "remote";
          status: "running" | "done" | "error";
        }>;
        const mine = live.filter((s) => {
          if (s.where === "remote") return false;
          return sourceLock === "github" ? s.origin === "github" : s.origin !== "github";
        });
        if (!mine.length) return;
        // Server lists newest-first; assign descending creation keys so the
        // oldest restored session still becomes #1 under stable numbering.
        const restoreBase = Date.now();
        const rebuilt: LiveSession[] = mine.map((s, i) => ({
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
  }, [sourceLock]);

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
    if (prompts.length === 0 || !projectPath || blocked) return;
    const cwd = projectPath;
    const pn = nameForPath(projectPath);
    const po = pendingOriginRef.current;
    const repo =
      source === "github"
        ? githubProjects.find((p) => sameOrInside(cwd, p.path))
        : undefined;
    const stamp = Date.now().toString(36);
    const batchId = `b_${stamp}${Math.random().toString(36).slice(2, 5)}`;
    const startedAt = Date.now();
    const batch: LiveSession[] = prompts.map((pr, i) => ({
      id: `c_${stamp}${Math.random().toString(36).slice(2, 6)}_${i}`,
      batchId,
      createdAt: startedAt + i,
      projectName: pn,
      projectPath: cwd,
      prompt: pr,
      status: "running" as Status,
      cmd: {
        cwd,
        prompt: pr,
        model,
        effort,
        origin: source === "github" ? "github" : po?.origin,
        repoFullName: source === "github" ? repo?.fullName ?? po?.repoFullName : po?.repoFullName,
      },
    }));
    setSessions((prev) => [...batch, ...prev]);
    setSelectedId(batch[0].id);
    refreshUsage();
    setPane("sessions");
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
    const ids: string[] = [];
    for (const payload of commandPayloads(command.payload)) {
      const p = payload as {
        projectPath?: string;
        projectName?: string;
        prompt?: string;
        origin?: "github";
        repoFullName?: string;
        sessionId?: string;
        kind?: string;
        sessions?: { sessionId?: string }[];
      };
      if (p?.kind === "reload-files") {
        setFilesNonce((n) => n + 1);
        continue;
      }
      if (p?.kind === "attach-sessions" && Array.isArray(p.sessions)) {
        for (const row of p.sessions) {
          if (row.sessionId) ids.push(row.sessionId);
        }
        continue;
      }
      if (p?.kind === "attach-session" && p.sessionId) ids.push(p.sessionId);
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
    }
    if (ids.length === 0) return;
    void fetch("/api/launcher/live-sessions")
      .then((r) => r.json())
      .then((d: { sessions?: Array<{
        id: string;
        batchId?: string;
        projectName?: string;
        cwd: string;
        prompt: string;
        model: string;
        effort: string;
        origin?: "github";
        repoFullName?: string;
        where?: "remote";
        status: "running" | "done" | "error";
        startedAt?: number;
      }> }) => {
        const added: LiveSession[] = [];
        for (const id of ids) {
          const s = (d.sessions ?? []).find((row) => row.id === id);
          if (!s || s.where === "remote") continue;
          if (sourceLock === "github" ? s.origin !== "github" : s.origin === "github") continue;
          added.push({
            id: s.id,
            batchId: s.batchId || s.id,
            createdAt: s.startedAt || Date.now(),
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
          });
        }
        if (added.length === 0) return;
        setSessions((prev) => {
          const known = new Set(prev.map((row) => row.id));
          const fresh = added.filter((row) => !known.has(row.id));
          return fresh.length ? [...fresh, ...prev] : prev;
        });
        setSelectedId(added[0].id);
        setSidebarOpen(false);
        setPane("sessions");
        if (added[0].projectPath) setProjectPath(added[0].projectPath);
      })
      .catch(() => {});
  }, [command?.nonce]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  // Stop a session for real. Sessions otherwise keep running server-side until
  // the PC is shut down — refreshing the page never kills them — so closing is
  // the one destructive action and is confirmed first.
  const closeSession = (id: string) => {
    const ok = window.confirm(
      `Really stop this ${cliName} session?\n\n` +
        "It continues running in the background (even after page reload) " +
        "until the PC is shut down. Stopping ends it permanently.",
    );
    if (!ok) return;
    void fetch(`/api/launcher/live-sessions?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => {});
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  };

  // Stop every live session at once (the "Close all sessions" button). Confirmed
  // first because, like closeSession, this is permanent — the PTYs are gone.
  const closeAllSessions = () => {
    if (sessions.length === 0) return;
    const ok = window.confirm(
      `Really stop all ${sessions.length} ${cliName} session${sessions.length === 1 ? "" : "s"}?\n\n` +
        "They keep running in the background (even after page reload) until the " +
        "PC is shut down. Stopping ends them all permanently.",
    );
    if (!ok) return;
    const ids = sessions.map((s) => s.id);
    void Promise.all(
      ids.map((id) =>
        fetch(`/api/launcher/live-sessions?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
        }).catch(() => {}),
      ),
    );
    setSessions([]);
    setSelectedId(null);
  };

  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  // The active batch (the boxes shown in the grid) follows the selected session.
  const activeBatchId = selected?.batchId ?? sessions[0]?.batchId ?? null;
  const visibleCount = sessions.filter((s) => s.batchId === activeBatchId).length;
  const { cols, rows } = gridShape(visibleCount);
  // Distinct batches oldest-first — one rail button per batch/page. Building in
  // chronological order keeps existing pages' numbers stable and places each new
  // session on the next page instead of bumping it to page 1.
  const batchIds: string[] = [];
  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i];
    if (!batchIds.includes(s.batchId)) batchIds.push(s.batchId);
  }
  // A value that changes whenever the terminal panes' available width changes —
  // the sidebar collapsing/expanding or the visible batch switching. Passed to
  // each ClaudeCmdPane so it re-fits its xterm once the layout settles, fixing
  // the "panes shifted until the sidebar is toggled" bug at start.
  const layoutNonce =
    (sidebarOpen ? 1 : 0) + 2 * batchIds.indexOf(activeBatchId ?? "") + (pane === "sessions" ? 8 : 0);

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
      if (!r.ok || !r.body) throw new Error(`Review fehlgeschlagen (${r.status})`);

      const pageId = `rev_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      const pageTitle = new Date().toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
      });
      let pageCreated = false;

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line) as { type: string; text: string };
            if (chunk.type === "speech") {
              // Start TTS immediately — before the markdown page is ready.
              void speak(chunk.text).catch(() => {});
            } else if (chunk.type === "markdown") {
              const page: ReviewPage = {
                id: pageId,
                markdown: chunk.text,
                createdAt: Date.now(),
                title: pageTitle,
              };
              setReviews((prev) => [page, ...prev]);
              setActiveReviewId(page.id);
              pageCreated = true;
            }
          } catch {
            /* skip malformed lines */
          }
        }
      }

      if (!pageCreated) {
        const page: ReviewPage = {
          id: pageId,
          markdown: "_Kein Ergebnis._",
          createdAt: Date.now(),
          title: pageTitle,
        };
        setReviews((prev) => [page, ...prev]);
        setActiveReviewId(page.id);
      }
    } catch (e) {
      setReviewError((e as Error).message);
    } finally {
      setReviewing(false);
    }
  };

  const openListedFile = (path: string, name: string) => {
    setOpenFiles((prev) => (prev.some((file) => file.path === path) ? prev : [...prev, { path, name }]));
    setActiveFile(path);
    setPane("files");
  };

  const closeListedFile = (path: string) => {
    const rest = openFiles.filter((file) => file.path !== path);
    setOpenFiles(rest);
    setActiveFile((cur) => (cur === path ? (rest[rest.length - 1]?.path ?? null) : cur));
  };

  const openFolder = async () => {
    let target = "";
    try {
      const r = await fetch("/api/folders");
      const c = (await r.json()) as { projectsDir?: string; clonesDir?: string | null };
      target = (source === "github" ? c.clonesDir : c.projectsDir) || "";
    } catch {
      return;
    }
    if (!target) return;
    const desktop = window.cccDesktop;
    if (desktop?.openPath) {
      const err = await desktop.openPath(target);
      if (!err) return;
    }
    await fetch("/api/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: target }),
    }).catch(() => {});
  };

  const selectedGithub =
    source === "github"
      ? githubProjects.find((p) => sameOrInside(projectPath, p.path))
      : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {(codeCli?.id ?? "claude") === "claude" && (
        <UsageBar usage={usage} now={nowTs} />
      )}
      <div className="flex min-h-0 flex-1">
        {/* Left: form + sessions — collapsible to maximize the terminal */}
        {sidebarOpen && (
          <aside className="glass-pane flex w-72 shrink-0 flex-col border-r">
            <div className="flex flex-col gap-3 px-3 py-3">
              <div>
                <div className="mb-1.5 text-xs text-muted">Session count</div>
                <div className="grid grid-cols-6 gap-1.5">
                {BOX_COUNTS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={boxCount === n}
                    onClick={() => setBoxCount(n)}
                    className="rail-count"
                  >
                    {n}
                  </button>
                ))}
                </div>
              </div>
              {source === "github" ? (
                githubConnected ? (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted">Repo</span>
                    <select
                      value={selectedGithub?.path ?? ""}
                      onChange={(e) => setProjectPath(e.target.value)}
                      aria-label="Geklontes Repo"
                      disabled={githubProjects.length === 0}
                      className="h-9 w-full cursor-pointer rounded-lg border border-transparent bg-raised/80 px-2.5 text-[12.5px] text-ink outline-none disabled:cursor-default disabled:text-faint"
                    >
                      {githubProjects.length === 0 ? (
                        <option value="">
                          {githubRestoring ? "Repos werden neu geklont …" : "Keine geklonten Repos"}
                        </option>
                      ) : (
                        githubProjects.map((p) => (
                          <option key={p.path} value={p.path}>
                            {p.name}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                ) : (
                  <p className="rounded-lg bg-raised/80 px-2.5 py-2 text-xs leading-snug text-warn">
                    Dieser Tab geht nur mit einem verbundenen Repo. Verbinde GitHub im Tab Repos.
                  </p>
                )
              ) : (
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted">Ordner</span>
                  <input
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    placeholder="Lokaler Ordner"
                    spellCheck={false}
                    aria-label="Startordner"
                    className="h-9 w-full rounded-lg border border-transparent bg-raised/80 px-2.5 font-mono text-[12.5px] text-ink outline-none"
                  />
                </label>
              )}
              <Button
                variant="primary"
                icon={Play}
                className="w-full"
                onClick={startEmpty}
                disabled={!canStart || startBlocked}
              >
                Starten
              </Button>
              {(source !== "github" || githubConnected) && (
                <>
                  <Button
                    variant="secondary"
                    icon={Upload}
                    className="w-full"
                    disabled={!projectPath.trim()}
                    onClick={() => {
                      setImageOpen(false);
                      setUploadOpen(true);
                    }}
                  >
                    Dateien hochladen
                  </Button>
                  <Button
                    variant="secondary"
                    icon={ImagePlus}
                    className="w-full"
                    disabled={!projectPath.trim()}
                    onClick={() => {
                      setUploadOpen(false);
                      setImageOpen(true);
                    }}
                  >
                    Bild hochladen
                  </Button>
                </>
              )}
            </div>
            {(source !== "github" || githubConnected) && (
              <LocalFiles
                path={projectPath}
                reloadToken={filesNonce}
                floor={selectedGithub?.path}
                onOpenFile={openListedFile}
                onPathChange={(next) => {
                  if (source === "github" && selectedGithub && !sameOrInside(next, selectedGithub.path)) return;
                  setProjectPath(next);
                }}
              />
            )}
            <div className="border-t border-glass-border px-3 py-3">
              <Button variant="secondary" icon={FolderOpen} className="w-full" onClick={() => void openFolder()}>
                Ordner öffnen
              </Button>
            </div>
          </aside>
        )}

        {/* Right: live terminals as a symmetric grid. Every pane stays mounted
            (non-active batches are display:none) so a PTY is never killed. */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <ViewBar
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
            pane={pane}
            onPane={setPane}
            count={sessions.length > 0 ? visibleCount : 0}
            onCloseAll={closeAllSessions}
          />
          <div className={sessions.length > 0 && pane !== "files" ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
            <FileWorkbench
              source="local"
              files={openFiles}
              activePath={activeFile}
              onActivate={setActiveFile}
              onClose={closeListedFile}
            />
          </div>
          {sessions.length > 0 && (
            <div
              className={
                pane === "sessions" ? "grid min-h-0 flex-1 gap-2 p-2" : "hidden"
              }
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
                      title="Stop / close box"
                      aria-label="Close box"
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
                      where={s.cmd.where}
                      cli={s.cmd.cli}
                      projectName={s.projectName}
                      batchId={s.batchId}
                      createdAt={s.createdAt}
                      layoutNonce={layoutNonce}
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
          )}
          {activeReview && (
            <div className="absolute inset-0 z-30 flex min-h-0 flex-col bg-canvas">
              <div className="flex shrink-0 items-center gap-2 border-b border-line bg-elevated px-3 py-2">
                <FileText className="size-4 text-accent" />
                <span className="text-sm font-medium text-ink">
                  Review {activeReview.title}
                </span>
                <button
                  onClick={() => {
                    // Close the review for good: drop its page from the rail too,
                    // not just hide the overlay (which only switched back to the
                    // first window and left the page sitting in the rail).
                    const id = activeReview.id;
                    setReviews((prev) => prev.filter((r) => r.id !== id));
                    setActiveReviewId(null);
                  }}
                  title="Close review"
                  aria-label="Close review"
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
                aria-label={`Page ${i + 1}`}
                aria-pressed={!activeReviewId && id === activeBatchId}
                className="rail-count flex size-9 items-center justify-center text-sm"
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
                aria-pressed={activeReviewId === rev.id}
                className="rail-count flex size-9 items-center justify-center"
              >
                <FileText className="size-4" />
              </button>
            ))}
          </div>
        )}
      </div>
      {uploadOpen && projectPath.trim() && (
        <RemoteUpload
          kind="local"
          dir={projectPath.trim()}
          onClose={() => setUploadOpen(false)}
          onRefresh={() => setFilesNonce((n) => n + 1)}
        />
      )}
      {imageOpen && projectPath.trim() && (
        <RemoteImageUpload
          kind="local"
          dir={projectPath.trim()}
          onClose={() => setImageOpen(false)}
          onRefresh={() => setFilesNonce((n) => n + 1)}
        />
      )}
    </div>
  );
}

/** Small stable instance number badge ("#3") shared by the list and the grid. */
function InstanceNumber({ n, active }: { n: number; active?: boolean }) {
  if (n <= 0) return null;
  return (
    <span
      title={`Instance #${n}`}
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

function StatusPill({ status }: { status: Status }) {
  // "läuft" is the default state of every open session — showing a badge for it
  // just adds noise, so running sessions render no pill at all.
  if (status === "running") return null;
  if (status === "done")
    return (
      <Badge tone="running" dot>
        done
      </Badge>
    );
  if (status === "stopped") return <Badge tone="neutral">stopped</Badge>;
  return <Badge tone="danger">Error</Badge>;
}
