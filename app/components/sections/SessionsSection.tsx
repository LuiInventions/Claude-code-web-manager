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
 * Sessions tab — a live pixel-office view of every Claude Code session running
 * via the Launcher (homage to pixel-agents). Each session is an animated pixel
 * character in the office, seated by what it's doing; in-session subagents
 * appear as their own little people. The live-sessions endpoint is polled (~1s)
 * so a session started in the Launcher shows up here within ~1s.
 */
export default function SessionsSection() {
  const [sessions, setSessions] = useState<VisualSession[]>([]);
  const [loaded, setLoaded] = useState(false);

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
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, [load]);

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
        {loaded && sessions.length === 0 ? (
          <div className="grid h-full place-items-center">
            <EmptyState
              icon={Boxes}
              title="No live sessions yet"
              description="Start a Claude Code session from the Launcher — it appears here instantly as a character in the office."
            />
          </div>
        ) : (
          <OfficeView sessions={sessions} />
        )}
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
