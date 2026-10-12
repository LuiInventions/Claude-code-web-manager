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
 *   - A name over every character, with GitHub / Lokal / Server above it.
 *     Clicking the name opens that tab.
 */

import { useEffect, useState } from "react";

import { CHARACTER_SITTING_OFFSET_PX, TOOL_OVERLAY_VERTICAL_OFFSET } from "./constants";
import type { OfficeState } from "./office/engine/officeState";
import { CharacterState, TILE_SIZE } from "./office/types";
import type { SubagentCharacter } from "./useSessionMessages";
import { placeLabel, type SessionPlace } from "@/lib/session-names";

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
  /** office agent-id → session name. Sub-agents inherit their parent's. */
  agentNames: Record<number, string>;
  /** office agent-id → where the session was started. */
  agentPlaces: Record<number, SessionPlace>;
  onOpen?: (place: SessionPlace) => void;
}

export function OfficeOverlay({
  officeState,
  containerRef,
  zoom,
  panRef,
  agents,
  subagentCharacters,
  agentCaptions,
  agentNames,
  agentPlaces,
  onOpen,
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
  const parentById = new Map(subagentCharacters.map((s) => [s.id, s.parentAgentId] as const));

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {allIds.map((id) => {
        const ch = officeState.characters.get(id);
        if (!ch || ch.matrixEffect === "despawn") return null;

        const owner = ch.isSubagent ? (parentById.get(id) ?? -1) : id;
        const name = agentNames[owner];
        const place = agentPlaces[owner];
        const caption = ch.isSubagent ? undefined : agentCaptions[id];

        if (!name && !caption) return null;

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
            {name && (
              <button
                type="button"
                data-testid="agent-name"
                onClick={() => place && onOpen?.(place)}
                className="pointer-events-auto cursor-pointer border-0"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  fontFamily: "ui-sans-serif, system-ui, sans-serif",
                  lineHeight: 1.15,
                  color: "#f4f4f5",
                  background: "rgba(0,0,0,0.55)",
                  backdropFilter: "blur(8px)",
                  padding: "3px 7px 4px",
                  borderRadius: 8,
                  whiteSpace: "nowrap",
                  opacity: ch.isSubagent ? 0.75 : 1,
                }}
              >
                {place && (
                  <span style={{ fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.72 }}>
                    {placeLabel(place)}
                  </span>
                )}
                <span style={{ fontSize: 12, fontWeight: 600 }}>{name}</span>
              </button>
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
