"use client";

/**
 * OfficeOverlay — a thin HTML layer drawn over the office <canvas>.
 *
 * The vendored engine in `office/**` (rendering / sprites / pathfinding / FSM)
 * is left untouched; this overlay only *reads* OfficeState and positions DOM
 * labels using the exact same device-offset math the renderer uses, so labels
 * line up with the pixel characters. It re-renders every animation frame (rAF)
 * so labels track moving characters, mirroring the vendored `ToolOverlay`.
 *
 * Responsibilities:
 *   - Point 3: the live activity caption ("desk caption") above each active
 *     agent — the current file ("✎ App.tsx") or command ("$ npm run build").
 *   - Point 4: a permanent "#N" badge over every character, N = the same
 *     Launcher number as in the Launcher tab for that session.
 */

import { useEffect, useState } from "react";

import { CHARACTER_SITTING_OFFSET_PX, TOOL_OVERLAY_VERTICAL_OFFSET } from "./constants";
import type { OfficeState } from "./office/engine/officeState";
import { CharacterState, TILE_SIZE } from "./office/types";
import type { SubagentCharacter } from "./useSessionMessages";

interface OfficeOverlayProps {
  officeState: OfficeState;
  /** The element that wraps the canvas (same bounding box the canvas sizes to). */
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  /** Top-level office agent ids (one per live session). */
  agents: number[];
  subagentCharacters: SubagentCharacter[];
  /** office agent-id → live desk caption ("✎ App.tsx" / "$ npm run build"). */
  agentCaptions: Record<number, string>;
  /** office agent-id → Launcher number (#N). Sub-agents inherit their parent's. */
  agentNumbers: Record<number, number>;
}

export function OfficeOverlay({
  officeState,
  containerRef,
  zoom,
  panRef,
  agents,
  subagentCharacters,
  agentCaptions,
  agentNumbers,
}: OfficeOverlayProps) {
  // Re-render every frame so labels follow moving characters (same as ToolOverlay).
  const [, setTick] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setTick((n) => n + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const el = containerRef.current;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const canvasW = Math.round(rect.width * dpr);
  const canvasH = Math.round(rect.height * dpr);
  const layout = officeState.getLayout();
  const mapW = layout.cols * TILE_SIZE * zoom;
  const mapH = layout.rows * TILE_SIZE * zoom;
  const pan = panRef.current ?? { x: 0, y: 0 };
  // Same centering + pan math as renderer.renderFrame, so DOM tracks the canvas.
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(pan.x);
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(pan.y);

  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)];
  // Sub-agent character id → its parent agent id, so a sub-agent can inherit the
  // parent session's #N.
  const parentById = new Map(subagentCharacters.map((s) => [s.id, s.parentAgentId] as const));

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {allIds.map((id) => {
        const ch = officeState.characters.get(id);
        if (!ch || ch.matrixEffect === "despawn") return null;

        // Launcher number (#N): top-level agents map directly; sub-agents inherit
        // their parent session's number so they read as "part of #N".
        const num = ch.isSubagent
          ? agentNumbers[parentById.get(id) ?? -1]
          : agentNumbers[id];
        // Sub-agents have no session of their own, so no desk caption.
        const caption = ch.isSubagent ? undefined : agentCaptions[id];

        // Nothing to show for this character this frame.
        if (num === undefined && !caption) return null;

        const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr;
        const screenY =
          (deviceOffsetY + (ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET) * zoom) / dpr;

        return (
          <div
            key={id}
            className="absolute flex -translate-x-1/2 flex-col items-center gap-0.5"
            style={{ left: screenX, top: screenY, zIndex: 41 }}
            data-testid="agent-overlay"
            data-agent-id={id}
          >
            {num !== undefined && (
              <span
                data-testid="agent-number"
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 11,
                  fontWeight: 700,
                  lineHeight: 1.3,
                  color: "#ffffff",
                  background: "rgba(0,0,0,0.66)",
                  padding: "0px 5px",
                  borderRadius: 4,
                  whiteSpace: "nowrap",
                  opacity: ch.isSubagent ? 0.7 : 1,
                }}
              >
                #{num}
              </span>
            )}
            {caption && (
              <span
                data-testid="office-caption"
                style={{
                  maxWidth: 220,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 10,
                  lineHeight: 1.4,
                  color: "#eaeaea",
                  background: "rgba(0,0,0,0.6)",
                  padding: "1px 6px",
                  borderRadius: 4,
                }}
              >
                {caption}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
