"use client";

/**
 * Sessions-tab office view.
 *
 * A thin wrapper that renders the vendored pixel-agents `OfficeCanvas` unchanged,
 * fed by `useSessionMessages` (our live launcher sessions → OfficeState). All
 * rendering, sprites, pathfinding and the character FSM live in `office/**`; this
 * component only owns the OfficeState/EditorState instances and the read-only
 * canvas props. The office is view-only here — edit mode is off and the editor
 * callbacks are no-ops.
 */

import { useCallback, useRef, useState } from "react";

import { OfficeOverlay } from "./OfficeOverlay";
import { OfficeCanvas } from "./office/components/OfficeCanvas";
import { EditorState } from "./office/editor/editorState";
import { OfficeState } from "./office/engine/officeState";
import { useSessionMessages } from "./useSessionMessages";
import type { VisualSession } from "@/lib/sessions";

const noop = () => {};

export default function OfficeView({ sessions }: { sessions: VisualSession[] }) {
  // One OfficeState / EditorState per mount; the adapter drives the same instance.
  const officeRef = useRef<OfficeState | null>(null);
  const getOfficeState = useCallback((): OfficeState => {
    if (!officeRef.current) officeRef.current = new OfficeState();
    return officeRef.current;
  }, []);
  const editorRef = useRef<EditorState | null>(null);
  if (!editorRef.current) editorRef.current = new EditorState();

  const panRef = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(3);

  const { layoutReady, agents, subagentCharacters, agentCaptions, agentNumbers } =
    useSessionMessages(getOfficeState, sessions);

  if (!layoutReady) {
    return (
      <div className="grid h-full w-full place-items-center text-sm text-faint">Loading office…</div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-[#1b1712]">
      <OfficeCanvas
        officeState={getOfficeState()}
        onClick={noop}
        isEditMode={false}
        editorState={editorRef.current}
        onEditorTileAction={noop}
        onEditorEraseAction={noop}
        onEditorSelectionChange={noop}
        onDeleteSelected={noop}
        onRotateSelected={noop}
        onDragMove={noop}
        editorTick={0}
        zoom={zoom}
        onZoomChange={setZoom}
        panRef={panRef}
        followCameraOnSelect={false}
        fitToContent
      />
      <OfficeOverlay
        officeState={getOfficeState()}
        containerRef={containerRef}
        zoom={zoom}
        panRef={panRef}
        agents={agents}
        subagentCharacters={subagentCharacters}
        agentCaptions={agentCaptions}
        agentNumbers={agentNumbers}
      />
    </div>
  );
}
