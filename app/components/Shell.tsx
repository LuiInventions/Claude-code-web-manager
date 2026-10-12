"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Code,
  FolderGit2,
  FolderOpen,
  Gamepad2,
  Monitor,
  Server,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { Button, cn, EmptyState } from "./ui";
import { play as playSfx, resume as resumeSfx } from "@/lib/sfx";
import {
  AppCommandsContext,
  type AppCommands,
  type SectionCommand,
  type SectionId,
} from "./app-commands";
import LauncherSection from "./sections/LauncherSection";
import SessionsSection from "./sections/SessionsSection";
import SettingsSection from "./sections/SettingsSection";
import GithubSection from "./sections/GithubSection";
import RemoteCodiumSection from "./sections/RemoteCodiumSection";
import RemoteSection from "./sections/RemoteSection";

interface SectionDef {
  id: SectionId;
  label: string;
  desc: string;
  icon: LucideIcon;
}

const MAIN_SECTIONS: SectionDef[] = [
  { id: "remote", label: "Remote", desc: "SSH to your server and start a code CLI", icon: Server },
  { id: "github-launch", label: "GitHub", desc: "Launch a code CLI in a connected repo", icon: FolderGit2 },
  { id: "launcher", label: "Local", desc: "Launch a code CLI in a local folder", icon: FolderOpen },
  { id: "github", label: "Repos", desc: "Connect a GitHub token and clone repos", icon: Code },
  { id: "codium", label: "VS Codium", desc: "Editor in the local project folder", icon: Monitor },
  { id: "sessions", label: "Sessions", desc: "Live code-CLI sessions, visualized", icon: Gamepad2 },
];

const SETTINGS_SECTION: SectionDef = {
  id: "settings",
  label: "Settings",
  desc: "Configuration",
  icon: SettingsIcon,
};

const ALL_SECTIONS = [...MAIN_SECTIONS, SETTINGS_SECTION];

export default function Shell() {
  const [active, setActive] = useState<SectionId>("launcher");
  const [opened, setOpened] = useState<Set<SectionId>>(
    () => new Set<SectionId>(["launcher", "codium"]),
  );
  const [command, setCommand] = useState<{
    target: SectionId;
    payload: unknown;
    nonce: number;
  } | null>(null);

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
        dispatch("github-launch", { projectPath, projectName, prompt, origin: "github" }),
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
        <aside className="glass-pane flex w-56 shrink-0 flex-col border-r">
          <nav className="flex-1 space-y-1 px-2.5 py-2.5">
            {MAIN_SECTIONS.map((s) => (
              <NavItem key={s.id} def={s} active={active === s.id} onClick={() => go(s.id)} />
            ))}
          </nav>
          <div className="border-t border-line px-3 py-3">
            <Button
              variant={active === "settings" ? "primary" : "secondary"}
              icon={SettingsIcon}
              className="w-full"
              onClick={() => go("settings")}
            >
              Settings
            </Button>
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
                {renderSection(s.id, cmdFor(s.id), active === s.id)}
              </div>
            ))}
          </main>
        </div>
      </div>
    </AppCommandsContext.Provider>
  );
}

function renderSection(id: SectionId, command: SectionCommand | null, active: boolean) {
  switch (id) {
    case "launcher":
      return <LauncherSection command={command} sourceLock="local" />;
    case "github-launch":
      return <LauncherSection command={command} sourceLock="github" />;
    case "sessions":
      return <SessionsSection active={active} />;
    case "remote":
      return <RemoteSection />;
    case "codium":
      return <RemoteCodiumSection />;
    case "github":
      return <GithubSection />;
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
        "group flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 text-[13px] font-medium transition-colors",
        active
          ? "bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] text-ink"
          : "text-muted hover:bg-white/5 hover:text-ink",
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0 transition-colors",
          active ? "text-accent" : "text-faint group-hover:text-muted",
        )}
      />
      <span className="truncate">{def.label}</span>
    </button>
  );
}


