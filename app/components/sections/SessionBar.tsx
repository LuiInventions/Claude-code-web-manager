"use client";

import { PanelLeftClose, PanelLeftOpen, XCircle } from "lucide-react";

/** Collapse control for the folder rail, shared by Local, GitHub, and Remote. */
export function SidebarToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const Icon = open ? PanelLeftClose : PanelLeftOpen;
  const label = open ? "Collapse sidebar" : "Expand sidebar";
  return (
    <button
      type="button"
      onClick={onToggle}
      title={label}
      aria-label={label}
      className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-faint transition-colors hover:bg-raised hover:text-ink"
    >
      <Icon className="size-4" />
    </button>
  );
}

/** Bar above the work area. With sessions running, it switches Dateien and Sessions. */
export function ViewBar({
  sidebarOpen,
  onToggleSidebar,
  pane,
  onPane,
  count,
  onCloseAll,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  pane: "files" | "sessions";
  onPane: (pane: "files" | "sessions") => void;
  count: number;
  onCloseAll: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-glass-border bg-elevated/80 px-3 py-2 backdrop-blur-md">
      <SidebarToggle open={sidebarOpen} onToggle={onToggleSidebar} />
      {count > 0 && (
        <>
          <div className="flex items-center gap-0.5 rounded-lg bg-raised/80 p-0.5">
            <PaneTab on={pane === "files"} onClick={() => onPane("files")}>
              Dateien
            </PaneTab>
            <PaneTab on={pane === "sessions"} onClick={() => onPane("sessions")}>
              Sessions
            </PaneTab>
          </div>
          <span className="text-xs text-faint">
            {count} {count === 1 ? "box" : "boxes"}
          </span>
          <button
            type="button"
            onClick={onCloseAll}
            title="Stop every running session"
            aria-label="Close all sessions"
            className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-faint transition-colors hover:bg-white/5 hover:text-danger"
          >
            <XCircle className="size-3.5" />
            Close all sessions
          </button>
        </>
      )}
    </div>
  );
}

function PaneTab({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={
        "cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
        (on ? "bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-ink" : "text-faint hover:text-ink")
      }
    >
      {children}
    </button>
  );
}

/** Bar above the CLI boxes: collapse, how many boxes are open, and close all. */
export function SessionBar({
  sidebarOpen,
  onToggleSidebar,
  count,
  onCloseAll,
}: {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  count: number;
  onCloseAll: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-glass-border bg-elevated/80 px-3 py-2 backdrop-blur-md">
      <SidebarToggle open={sidebarOpen} onToggle={onToggleSidebar} />
      <span className="text-xs text-faint">
        {count} {count === 1 ? "box" : "boxes"}
      </span>
      <button
        type="button"
        onClick={onCloseAll}
        title="Stop every running session"
        aria-label="Close all sessions"
        className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-faint transition-colors hover:bg-white/5 hover:text-danger"
      >
        <XCircle className="size-3.5" />
        Close all sessions
      </button>
    </div>
  );
}
