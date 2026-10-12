"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Boxes, RefreshCw } from "lucide-react";
import { EmptyState } from "../ui";
import type { VisualSession } from "@/lib/sessions";

// The office renders to a <canvas> and uses browser-only APIs, so load it
// client-side only (no SSR) to avoid hydration of the canvas on the server.
const OfficeView = dynamic(() => import("../sessions/OfficeView"), { ssr: false });

/**
 * Sessions tab — a live pixel-office view of every code CLI session running
 * via the Launcher. Each session is an animated pixel character. Server login
 * stays on the Launcher.
 */
export default function SessionsSection({ active = true }: { active?: boolean }) {
  const [sessions, setSessions] = useState<VisualSession[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    fetch("/api/launcher/live-sessions")
      .then((r) => r.json())
      .then((d: { sessions?: VisualSession[] }) => {
        setSessions((d.sessions ?? []).filter((s) => s.status === "running"));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => {
    // The tab stays mounted after the first visit. The office canvas is a
    // requestAnimationFrame loop, and display:none does not stop it. Run it
    // only while this tab is the one on screen.
    if (!active) return;
    load();
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, [load, active]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-5 py-3">
        <div className="mr-auto min-w-0">
          <h2 className="text-sm font-semibold text-ink">Sessions</h2>
          <p className="text-[11px] text-faint">
            {sessions.length} live launcher session{sessions.length === 1 ? "" : "s"}
          </p>
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
        {active && loaded && sessions.length === 0 ? (
          <div className="grid h-full place-items-center">
            <EmptyState
              icon={Boxes}
              title="No live sessions yet"
              description="Start a session from the Launcher — it appears here instantly as a character in the office."
            />
          </div>
        ) : active ? (
          <OfficeView sessions={sessions} />
        ) : null}
      </div>

      <footer className="border-t border-line px-5 py-2 text-[11px] text-faint">
        Pixel office inspired by{" "}
        <a
          className="cursor-pointer text-accent hover:underline"
          href="https://github.com/pixel-agents-hq/pixel-agents"
          target="_blank"
          rel="noreferrer"
        >
          pixel-agents
        </a>
        .
      </footer>
    </div>
  );
}
