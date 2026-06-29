"use client";

import { useCallback, useEffect, useState } from "react";
import { Boxes, Gamepad2, Network, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn, EmptyState } from "../ui";
import type { SessionView, VisualSession } from "@/lib/sessions";
import PixelOfficeView from "./sessions/PixelOfficeView";
import FlowGraphView from "./sessions/FlowGraphView";

/**
 * Sessions tab — a live, graphical view of every Claude Code session running via
 * the Launcher. The user picks one of two visualizations (persisted in
 * settings): a pixel-art office (homage to pixel-agents) where each session is
 * an animated character, or a flow graph (homage to agent-flow) where each
 * session is a node. The live-sessions endpoint is polled so a session started
 * in the Launcher shows up here within ~2s — a new character/node per session.
 */
export default function SessionsSection() {
  const [view, setView] = useState<SessionView>("pixel");
  const [sessions, setSessions] = useState<VisualSession[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Restore the saved visualization choice.
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((c: { sessionsView?: SessionView }) => {
        if (c.sessionsView === "pixel" || c.sessionsView === "flow") setView(c.sessionsView);
      })
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    fetch("/api/launcher/live-sessions")
      .then((r) => r.json())
      .then((d: { sessions?: VisualSession[] }) => {
        setSessions(d.sessions ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  // Poll so launcher starts/stops appear automatically.
  useEffect(() => {
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [load]);

  const changeView = (v: SessionView) => {
    setView(v);
    void fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionsView: v }),
    }).catch(() => {});
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-5 py-3">
        <div className="mr-auto min-w-0">
          <h2 className="text-sm font-semibold text-ink">Sessions</h2>
          <p className="text-[11px] text-faint">
            {sessions.length} live launcher session{sessions.length === 1 ? "" : "s"}
          </p>
        </div>

        <div className="flex rounded-md border border-line bg-raised p-0.5">
          <ToggleBtn
            active={view === "pixel"}
            icon={Gamepad2}
            label="Pixel office"
            onClick={() => changeView("pixel")}
          />
          <ToggleBtn
            active={view === "flow"}
            icon={Network}
            label="Flow graph"
            onClick={() => changeView("flow")}
          />
        </div>

        <button
          onClick={load}
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md border border-line text-faint transition-colors hover:text-ink"
          title="Refresh"
        >
          <RefreshCw className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {loaded && sessions.length === 0 ? (
          <div className="grid h-full place-items-center">
            <EmptyState
              icon={Boxes}
              title="No live sessions yet"
              description="Start a Claude Code session from the Launcher — it appears here instantly as a character (Pixel office) or a node (Flow graph)."
            />
          </div>
        ) : view === "pixel" ? (
          <PixelOfficeView sessions={sessions} />
        ) : (
          <FlowGraphView sessions={sessions} />
        )}
      </div>

      <footer className="border-t border-line px-5 py-2 text-[11px] text-faint">
        Visualizations inspired by{" "}
        <a
          className="cursor-pointer text-accent hover:underline"
          href="https://github.com/pixel-agents-hq/pixel-agents"
          target="_blank"
          rel="noreferrer"
        >
          pixel-agents
        </a>{" "}
        and{" "}
        <a
          className="cursor-pointer text-accent hover:underline"
          href="https://github.com/patoles/agent-flow"
          target="_blank"
          rel="noreferrer"
        >
          agent-flow
        </a>
        .
      </footer>
    </div>
  );
}

function ToggleBtn({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
        active ? "bg-selected text-ink" : "text-muted hover:text-ink",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}
