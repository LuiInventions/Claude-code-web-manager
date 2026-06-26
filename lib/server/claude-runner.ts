import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { WebSocket } from "ws";
import { getConfig } from "../config";
import { saveLauncherSession, type LauncherSession } from "../launcher-store";
import { normalizeModel, normalizeEffort } from "../launcher-config";
import { recordRateLimit, getUsage, isBlocked } from "../usage-store";

/**
 * Spawns Claude Code in print mode with streamable JSONL output and bridges it
 * to the /ws/claude WebSocket. One WebSocket can drive several parallel runs;
 * each run is identified by an id. Session metadata is persisted for history.
 */

let resolvedBin: string | null = null;
export function resolveClaudeBin(): string {
  if (resolvedBin) return resolvedBin;
  const configured = getConfig().claudeBin;
  if (configured && configured !== "claude") {
    resolvedBin = configured;
    return configured;
  }
  try {
    const out = execFileSync("where", ["claude"], {
      encoding: "utf8",
      windowsHide: true,
    });
    const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (first) {
      resolvedBin = first;
      return first;
    }
  } catch {
    /* fall back to PATH lookup by name */
  }
  resolvedBin = "claude";
  return "claude";
}

interface Live {
  child: ChildProcess;
  session: LauncherSession;
}
const LIVE = new Map<string, Live>();

type Emit = (ev: unknown) => void;

function startRun(
  opts: {
    projectPath: string;
    projectName: string;
    prompt: string;
    model?: string;
    effort?: string;
    origin?: "github";
    repoFullName?: string;
  },
  emit: Emit,
): string {
  const id = `j_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const session: LauncherSession = {
    id,
    projectPath: opts.projectPath,
    projectName: opts.projectName,
    prompt: opts.prompt,
    status: "running",
    startedAt: Date.now(),
    origin: opts.origin,
    repoFullName: opts.repoFullName,
  };

  const args = [
    "-p",
    opts.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
  ];
  const model = normalizeModel(opts.model);
  const effort = normalizeEffort(opts.effort);
  if (model) args.push("--model", model);
  if (effort) args.push("--effort", effort);

  let child: ChildProcess;
  try {
    child = spawn(resolveClaudeBin(), args, {
      cwd: opts.projectPath,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"], // ignore stdin -> no 3s wait
    });
  } catch (e) {
    session.status = "error";
    saveLauncherSession(session);
    emit({ type: "started", id, session });
    emit({ type: "error", id, message: (e as Error).message });
    emit({ type: "exit", id, code: -1 });
    return id;
  }

  LIVE.set(id, { child, session });
  saveLauncherSession(session);
  emit({ type: "started", id, session });

  let buf = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(line);
      } catch {
        /* non-JSON line */
      }
      if (parsed) {
        if (parsed.type === "rate_limit_event") {
          const usage = recordRateLimit(parsed.rate_limit_info);
          emit({ type: "rate_limit", id, usage });
          // 100% reached → this run is being rejected; mark it failed.
          if (usage.blockedUntil) session.status = "error";
        }
        absorbResult(session, parsed);
        emit({ type: "claude", id, data: parsed });
      } else {
        emit({ type: "raw", id, line });
      }
    }
  });
  child.stderr?.on("data", (chunk: Buffer) =>
    emit({ type: "stderr", id, text: chunk.toString() }),
  );
  child.on("error", (err) => {
    session.status = "error";
    session.endedAt = Date.now();
    saveLauncherSession(session);
    emit({ type: "error", id, message: err.message });
  });
  child.on("close", (code) => {
    if (session.status === "running")
      session.status = code === 0 ? "done" : "error";
    session.endedAt = Date.now();
    session.exitCode = code ?? undefined;
    saveLauncherSession(session);
    LIVE.delete(id);
    emit({ type: "exit", id, code });
  });

  return id;
}

function absorbResult(session: LauncherSession, o: Record<string, unknown>): void {
  if (o.type === "result") {
    if (typeof o.result === "string") session.result = o.result.slice(0, 4000);
    if (typeof o.total_cost_usd === "number") session.costUsd = o.total_cost_usd;
    if (typeof o.num_turns === "number") session.numTurns = o.num_turns;
    if (o.is_error) session.status = "error";
  }
}

function stopRun(id: string): void {
  const live = LIVE.get(id);
  if (live) {
    live.session.status = "stopped";
    try {
      live.child.kill();
    } catch {
      /* already gone */
    }
  }
}

export function handleClaude(ws: WebSocket): void {
  const owned = new Set<string>();
  const emit: Emit = (ev) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(ev));
  };
  ws.on("message", (raw) => {
    let m: {
      action?: string;
      id?: string;
      projectPath?: string;
      projectName?: string;
      prompt?: string;
      model?: string;
      effort?: string;
      origin?: "github";
      repoFullName?: string;
    };
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (m.action === "start" && m.projectPath && m.prompt) {
      const block = isBlocked(getUsage(), Date.now());
      if (block.blocked) {
        emit({
          type: "blocked",
          until: block.until,
          message: "Claude-Limit erreicht — Start blockiert bis zum Reset.",
        });
        return;
      }
      const id = startRun(
        {
          projectPath: m.projectPath,
          projectName: m.projectName ?? "",
          prompt: m.prompt,
          model: m.model,
          effort: m.effort,
          origin: m.origin,
          repoFullName: m.repoFullName,
        },
        emit,
      );
      owned.add(id);
    } else if (m.action === "stop" && m.id) {
      stopRun(m.id);
    }
  });
  ws.on("close", () => {
    for (const id of owned) stopRun(id);
  });
}
