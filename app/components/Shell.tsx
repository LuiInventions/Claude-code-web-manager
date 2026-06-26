"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Code,
  GitPullRequestArrow,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Rocket,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { cn, EmptyState } from "./ui";
import { play as playSfx, resume as resumeSfx } from "@/lib/sfx";
import {
  AppCommandsContext,
  type AppCommands,
  type SectionCommand,
  type SectionId,
} from "./app-commands";
import DashboardSection from "./sections/DashboardSection";
import LauncherSection from "./sections/LauncherSection";
import SettingsSection from "./sections/SettingsSection";
import GithubSection from "./sections/GithubSection";
import RepoPushSection from "./sections/RepoPushSection";

interface SectionDef {
  id: SectionId;
  label: string;
  desc: string;
  icon: LucideIcon;
}

const MAIN_SECTIONS: SectionDef[] = [
  { id: "dashboard", label: "Dashboard", desc: "All your projects at a glance", icon: LayoutDashboard },
  { id: "launcher", label: "Launcher", desc: "Improve prompt & launch Claude Code", icon: Rocket },
  { id: "github", label: "GitHub", desc: "Connect repos & edit with Claude", icon: Code },
  { id: "repoPush", label: "Repo Push", desc: "Push finished repos", icon: GitPullRequestArrow },
];

const SETTINGS_SECTION: SectionDef = {
  id: "settings",
  label: "Settings",
  desc: "Configuration",
  icon: SettingsIcon,
};

const ALL_SECTIONS = [...MAIN_SECTIONS, SETTINGS_SECTION];

export default function Shell() {
  const [active, setActive] = useState<SectionId>("dashboard");
  const [opened, setOpened] = useState<Set<SectionId>>(
    () => new Set<SectionId>(["dashboard"]),
  );
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [host, setHost] = useState("127.0.0.1:3000");
  const [command, setCommand] = useState<{
    target: SectionId;
    payload: unknown;
    nonce: number;
  } | null>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time window read on mount (SSR-safe)
  useEffect(() => setHost(window.location.host), []);

  // Global, app-wide subtle click feedback on any interactive element.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest("button, a, [role='button']")) {
        resumeSfx();
        playSfx("tap");
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  const go = useCallback((id: SectionId) => {
    setActive(id);
    setOpened((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const dispatch = useCallback(
    (target: SectionId, payload: unknown) => {
      setCommand({ target, payload, nonce: Math.random() });
      go(target);
    },
    [go],
  );

  const commands = useMemo<AppCommands>(
    () => ({
      navigate: go,
      launchClaude: (projectPath, projectName, prompt) =>
        dispatch("launcher", { projectPath, projectName, prompt }),
      launchClaudeInRepo: (projectPath, projectName, prompt) =>
        dispatch("launcher", { projectPath, projectName, prompt, origin: "github" }),
      requestPush: (repoPath, repoName) =>
        dispatch("repoPush", { requestPush: { repoPath, repoName } }),
    }),
    [go, dispatch],
  );

  const cmdFor = (id: SectionId): SectionCommand | null =>
    command && command.target === id
      ? { nonce: command.nonce, payload: command.payload }
      : null;

  return (
    <AppCommandsContext.Provider value={commands}>
      <div className="flex h-screen overflow-hidden">
        <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-elevated">
          <Brand />
          <nav className="flex-1 space-y-0.5 px-3 py-3">
            {MAIN_SECTIONS.map((s) => (
              <NavItem key={s.id} def={s} active={active === s.id} onClick={() => go(s.id)} />
            ))}
          </nav>
          <div className="space-y-2 border-t border-line px-3 py-3">
            <NavItem
              def={SETTINGS_SECTION}
              active={active === "settings"}
              onClick={() => go("settings")}
            />
            <ServerStatus host={host} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <main className="relative min-h-0 flex-1">
            {ALL_SECTIONS.filter((s) => opened.has(s.id)).map((s) => (
              <div
                key={s.id}
                className={cn(
                  "absolute inset-0",
                  active === s.id ? "flex flex-col" : "hidden",
                )}
              >
                {renderSection(s.id, cmdFor(s.id))}
              </div>
            ))}
          </main>
        </div>
      </div>
    </AppCommandsContext.Provider>
  );
}

function renderSection(id: SectionId, command: SectionCommand | null) {
  switch (id) {
    case "dashboard":
      return <DashboardSection />;
    case "launcher":
      return <LauncherSection command={command} />;
    case "github":
      return <GithubSection />;
    case "repoPush":
      return <RepoPushSection command={command} />;
    case "settings":
      return <SettingsSection />;
    default:
      return <PlaceholderSection id={id} />;
  }
}

function PlaceholderSection({ id }: { id: SectionId }) {
  const def = ALL_SECTIONS.find((s) => s.id === id)!;
  return (
    <EmptyState icon={def.icon} title={`${def.label} – coming soon`} description="This section is currently being built." />
  );
}

function NavItem({
  def,
  active,
  onClick,
}: {
  def: SectionDef;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = def.icon;
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active ? "bg-selected text-ink" : "text-muted hover:bg-raised hover:text-ink",
      )}
    >
      <Icon
        className={cn(
          "size-[18px] shrink-0 transition-colors",
          active ? "text-accent" : "text-faint group-hover:text-muted",
        )}
      />
      <span className="truncate">{def.label}</span>
      {active && <span className="ml-auto h-4 w-1 rounded-full bg-accent" />}
    </button>
  );
}

function Brand() {
  return (
    <div className="flex h-14 items-center gap-2.5 border-b border-line px-5">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 2 21 7v10l-9 5-9-5V7l9-5Z" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="3" fill="var(--accent)" />
      </svg>
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight text-ink">CLAUDE&nbsp;CODE</div>
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-faint">
          Control Center
        </div>
      </div>
    </div>
  );
}

function ServerStatus({ host }: { host: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-surface px-3 py-2">
      <span className="size-1.5 rounded-full bg-running dot-running" />
      <span className="font-mono text-[11px] text-muted">{host}</span>
      <span className="ml-auto text-[10px] uppercase tracking-wide text-faint">loopback</span>
    </div>
  );
}
