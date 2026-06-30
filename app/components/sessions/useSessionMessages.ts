"use client";

/**
 * useSessionMessages — the Sessions-tab adapter for the vendored pixel-agents
 * office.
 *
 * This is the ONLY hand-written piece of office logic. It mirrors the message
 * types / return shape of pixel-agents' `useExtensionMessages.ts`, but the data
 * source is OUR live launcher session model (lib/sessions → VisualSession[],
 * polled from /api/launcher/live-sessions) instead of the VS Code postMessage /
 * WebSocket transport.
 *
 * It does NOT render, animate, colour, or simulate anything itself — all of that
 * stays in the vendored `office/**` engine. The adapter only:
 *   1. loads the decoded sprite/layout data (from /api/sessions/office-assets,
 *      which runs pixel-agents' own asset loaders) into the office's setter
 *      functions, then applies the default layout, and
 *   2. translates each VisualSession into the office's own OfficeState mutations
 *      (addAgent / setAgentActive / setAgentTool / bubbles / addSubagent …).
 */

import { useEffect, useRef, useState } from "react";

import { setFloorSprites } from "./office/floorTiles";
import { buildDynamicCatalog } from "./office/layout/furnitureCatalog";
import { migrateLayoutColors } from "./office/layout/layoutSerializer";
import { setPetTemplates } from "./office/sprites/petSpriteData";
import { setCharacterTemplates } from "./office/sprites/spriteData";
import { setProviderCapabilities } from "./office/toolUtils";
import type { OfficeLayout } from "./office/types";
import { setWallSprites } from "./office/wallTiles";
import type { OfficeState } from "./office/engine/officeState";
import { numberSessions, sessionActivity, type ToolKind, type VisualSession } from "@/lib/sessions";

/** Same shape as pixel-agents' SubagentCharacter (re-exported for ToolOverlay). */
export interface SubagentCharacter {
  id: number;
  parentAgentId: number;
  parentToolId: string;
  label: string;
}

export interface SessionMessagesState {
  /** Office agent ids currently in the scene (one per live session). */
  agents: number[];
  layoutReady: boolean;
  subagentCharacters: SubagentCharacter[];
  /**
   * Office agent-id → live desk caption for the tool the agent is running right
   * now, e.g. `"✎ App.tsx"` (edit) or `"$ npm run build"` (bash). Only present
   * while the agent is active; absent when idle. Mirrors the detail level of
   * upstream's per-tool status text.
   */
  agentCaptions: Record<number, string>;
  /**
   * Office agent-id → the session's stable Launcher number (the same `#N` shown
   * in the Launcher tab, oldest = #1). The overlay renders this permanently over
   * each character. Sub-agents inherit their parent session's number.
   */
  agentNumbers: Record<number, number>;
}

/**
 * Human-readable desk caption for the tool an agent is running, built from the
 * coarse {@link ToolKind} plus the short target (`detail`) the server already
 * parsed from the output tail (file basename / command / search pattern / host).
 * Edit/Bash use the glyph form the spec calls for ("✎ file", "$ command");
 * the rest keep upstream's verb form ("Reading x", "Searching y", …).
 */
function toolCaption(tool: ToolKind | undefined, detail: string | undefined): string | null {
  if (!tool) return null;
  const d = (detail ?? "").trim();
  switch (tool) {
    case "edit":
      return d ? `✎ ${d}` : "Editing";
    case "bash":
      return d ? `$ ${d}` : "Running";
    case "read":
      return d ? `Reading ${d}` : "Reading";
    case "search":
      return d ? `Searching ${d}` : "Searching";
    case "web":
      return d ? `Fetching ${d}` : "Fetching";
    case "task":
      return d ? `Task ${d}` : "Delegating";
    default:
      return null;
  }
}

/** Claude reading tools — drive the office's reading-vs-typing animation. */
const READING_TOOLS = ["Read", "Grep", "Glob", "WebFetch", "WebSearch"];
/** Tools that spawn sub-agents (kept for parity with upstream toolUtils). */
const SUBAGENT_TOOLS = ["Task", "Agent"];

/** Map our coarse ToolKind to a representative tool name the office understands. */
const TOOL_NAME: Record<ToolKind, string | null> = {
  edit: "Edit",
  read: "Read",
  search: "Grep",
  bash: "Bash",
  web: "WebFetch",
  task: "Task",
  other: null,
};

interface AgentSnapshot {
  active: boolean;
  tool: string | null;
  activity: string;
}

/**
 * Drive the office from our live session list. `sessions` is supplied by the
 * Sessions tab (which already polls /api/launcher/live-sessions), so there is no
 * second poll here.
 */
export function useSessionMessages(
  getOfficeState: () => OfficeState,
  sessions: VisualSession[],
): SessionMessagesState {
  const [layoutReady, setLayoutReady] = useState(false);
  const [agents, setAgents] = useState<number[]>([]);
  const [subagentCharacters, setSubagentCharacters] = useState<SubagentCharacter[]>([]);
  const [agentCaptions, setAgentCaptions] = useState<Record<number, string>>({});
  const [agentNumbers, setAgentNumbers] = useState<Record<number, number>>({});

  // Stable session-id → office agent-id assignment (first-seen order).
  const agentIdBySession = useRef<Map<string, number>>(new Map());
  const nextAgentId = useRef(1);
  // Last applied per-agent snapshot, so we only re-apply on change.
  const lastSnapshot = useRef<Map<number, AgentSnapshot>>(new Map());
  // Per agent: set of subagent parentToolIds currently spawned.
  const subToolIds = useRef<Map<number, Set<string>>>(new Map());

  // ── 1. Load sprites + layout once, then mark ready ───────────────────────
  useEffect(() => {
    let cancelled = false;
    setProviderCapabilities({ readingTools: READING_TOOLS, subagentToolNames: SUBAGENT_TOOLS });

    (async () => {
      try {
        const res = await fetch("/api/sessions/office-assets");
        if (!res.ok) throw new Error(`office-assets ${res.status}`);
        const data = (await res.json()) as {
          characters: Parameters<typeof setCharacterTemplates>[0];
          pets: Parameters<typeof setPetTemplates>[0];
          petNames: string[];
          floors: Parameters<typeof setFloorSprites>[0];
          walls: Parameters<typeof setWallSprites>[0];
          furniture: {
            catalog: Parameters<typeof buildDynamicCatalog>[0]["catalog"];
            sprites: Record<string, string[][]>;
          };
          layout: OfficeLayout | null;
        };
        if (cancelled) return;

        // Furniture catalog MUST be built before the layout is applied so
        // getCatalogEntry() resolves the layout's furniture types.
        buildDynamicCatalog({ catalog: data.furniture.catalog, sprites: data.furniture.sprites });
        setCharacterTemplates(data.characters);
        setPetTemplates(data.pets, data.petNames);
        setFloorSprites(data.floors);
        setWallSprites(data.walls);

        const os = getOfficeState();
        if (data.layout && data.layout.version === 1) {
          os.rebuildFromLayout(migrateLayoutColors(data.layout));
        }
        setLayoutReady(true);
      } catch (err) {
        console.error("[Sessions] Failed to load office assets:", err);
        // Even without assets, show the (empty) office rather than hang on "Loading…".
        setLayoutReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 2. Reconcile sessions → OfficeState on every poll (after ready) ──────
  useEffect(() => {
    if (!layoutReady) return;
    const os = getOfficeState();
    const map = agentIdBySession.current;
    const present = new Set<string>();
    // Rebuilt each poll: office agent-id → live desk caption (active agents only).
    const caps: Record<number, string> = {};
    // Rebuilt each poll: office agent-id → stable Launcher number (#N). The
    // numbering is keyed on the session's spawn time (oldest = #1), identical to
    // the Launcher tab, so a session shows the SAME number in both places.
    const nums: Record<number, number> = {};
    const numberBySession = numberSessions(sessions);

    // Add / update agents for every live session.
    for (const s of sessions) {
      present.add(s.id);
      let agentId = map.get(s.id);
      if (agentId === undefined) {
        agentId = nextAgentId.current++;
        map.set(s.id, agentId);
        os.addAgent(agentId);
        setAgents((prev) => (prev.includes(agentId!) ? prev : [...prev, agentId!]));
      }

      const activity = sessionActivity(s);
      const active = activity === "working" || activity === "thinking";
      const tool = active && s.tool ? TOOL_NAME[s.tool] : null;
      // Desk caption (file/command) for the active tool — same detail level as
      // the original; drives the live "✎ file" / "$ command" label.
      const caption = active ? toolCaption(s.tool, s.detail) : null;
      if (caption) caps[agentId] = caption;
      const launcherNumber = numberBySession.get(s.id);
      if (launcherNumber) nums[agentId] = launcherNumber;
      const prev = lastSnapshot.current.get(agentId);

      if (!prev || prev.active !== active) os.setAgentActive(agentId, active);
      if (!prev || prev.tool !== tool) os.setAgentTool(agentId, tool);

      // Bubbles fire on transitions (so they fade as upstream does).
      if (!prev || prev.activity !== activity) {
        if (activity === "waiting") os.showWaitingBubble(agentId, true);
        else if (activity === "done") os.showWaitingBubble(agentId, false);
        else os.clearPermissionBubble(agentId);
      }
      lastSnapshot.current.set(agentId, { active, tool, activity });

      reconcileSubagents(os, agentId, s, subToolIds, setSubagentCharacters);
    }

    // Remove agents whose session vanished.
    for (const [sessionId, agentId] of [...map.entries()]) {
      if (present.has(sessionId)) continue;
      os.removeAllSubagents(agentId);
      os.removeAgent(agentId);
      map.delete(sessionId);
      lastSnapshot.current.delete(agentId);
      subToolIds.current.delete(agentId);
      setAgents((prev) => prev.filter((a) => a !== agentId));
      setSubagentCharacters((prev) => prev.filter((sc) => sc.parentAgentId !== agentId));
    }

    setAgentCaptions(caps);
    setAgentNumbers(nums);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, layoutReady]);

  return { agents, layoutReady, subagentCharacters, agentCaptions, agentNumbers };
}

/** Spawn / update / despawn this session's detected subagents as office characters. */
function reconcileSubagents(
  os: OfficeState,
  parentAgentId: number,
  s: VisualSession,
  subToolIds: React.MutableRefObject<Map<number, Set<string>>>,
  setSubagentCharacters: React.Dispatch<React.SetStateAction<SubagentCharacter[]>>,
): void {
  const subs = s.subagents ?? [];
  const wanted = new Set(subs.map((sub) => sub.id));
  const have = subToolIds.current.get(parentAgentId) ?? new Set<string>();

  // Add new subagents + keep their active/tool state current.
  for (const sub of subs) {
    if (!have.has(sub.id)) {
      const subId = os.addSubagent(parentAgentId, sub.id);
      have.add(sub.id);
      setSubagentCharacters((prev) =>
        prev.some((sc) => sc.id === subId)
          ? prev
          : [...prev, { id: subId, parentAgentId, parentToolId: sub.id, label: sub.label }],
      );
    }
    const subId = os.getSubagentId(parentAgentId, sub.id);
    if (subId !== null) {
      const working = sub.activity === "working" || sub.activity === "thinking";
      os.setAgentActive(subId, working);
      os.setAgentTool(subId, working ? "Edit" : null);
    }
  }

  // Despawn subagents no longer present.
  for (const toolId of [...have]) {
    if (wanted.has(toolId)) continue;
    os.removeSubagent(parentAgentId, toolId);
    have.delete(toolId);
    setSubagentCharacters((prev) =>
      prev.filter((sc) => !(sc.parentAgentId === parentAgentId && sc.parentToolId === toolId)),
    );
  }

  subToolIds.current.set(parentAgentId, have);
}
