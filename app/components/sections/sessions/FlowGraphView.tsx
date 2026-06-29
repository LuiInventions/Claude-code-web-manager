"use client";

import { useMemo } from "react";
import { Rocket } from "lucide-react";
import { groupByBatch, sessionColor, statusActivity, type VisualSession } from "@/lib/sessions";

/**
 * Flow-graph view — a homage to agent-flow
 * (https://github.com/patoles/agent-flow). The launcher is the root node; every
 * live session branches off it as its own node, and KI-Modus splits (sessions
 * that share a batchId) fan out from a shared batch hub. New sessions appear
 * automatically as the Sessions tab polls. Layout is deterministic (computed
 * here), so no measuring or graph library is needed.
 */

const NODE_W = 196;
const NODE_H = 60;
const COL_GAP = 84;
const V_GAP = 16;
const BLOCK_GAP = 22;
const PAD = 24;

interface PositionedNode {
  key: string;
  x: number;
  y: number;
  kind: "root" | "batch" | "session";
  session?: VisualSession;
  index?: number;
  label: string;
  sub: string;
}
interface Edge {
  key: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export default function FlowGraphView({ sessions }: { sessions: VisualSession[] }) {
  const { nodes, edges, width, height } = useMemo(() => layout(sessions), [sessions]);

  return (
    <div className="min-h-full w-full p-6">
      <div className="relative" style={{ width, height }}>
        <svg className="absolute inset-0" width={width} height={height} aria-hidden="true">
          {edges.map((e) => (
            <path
              key={e.key}
              d={`M ${e.from.x} ${e.from.y} C ${e.from.x + COL_GAP * 0.5} ${e.from.y}, ${
                e.to.x - COL_GAP * 0.5
              } ${e.to.y}, ${e.to.x} ${e.to.y}`}
              fill="none"
              stroke="var(--line)"
              strokeWidth="1.5"
            />
          ))}
        </svg>
        {nodes.map((n) => (
          <Node key={n.key} node={n} />
        ))}
      </div>
    </div>
  );
}

function Node({ node }: { node: PositionedNode }) {
  const color = node.session ? sessionColor(node.session.id) : "var(--accent)";
  const activity = node.session ? statusActivity(node.session.status) : null;

  if (node.kind === "root") {
    return (
      <div
        className="absolute grid place-items-center rounded-lg border border-accent/50 bg-accent/10"
        style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
      >
        <div className="flex items-center gap-2">
          <Rocket className="size-4 text-accent" />
          <div className="leading-tight">
            <div className="text-sm font-semibold text-ink">{node.label}</div>
            <div className="text-[11px] text-faint">{node.sub}</div>
          </div>
        </div>
      </div>
    );
  }

  if (node.kind === "batch") {
    return (
      <div
        className="absolute flex flex-col justify-center rounded-lg border border-line bg-elevated px-3"
        style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
      >
        <div className="text-xs font-semibold text-ink">{node.label}</div>
        <div className="text-[11px] text-faint">{node.sub}</div>
      </div>
    );
  }

  return (
    <div
      className="absolute flex flex-col justify-center overflow-hidden rounded-lg border border-line bg-raised pl-3 pr-2"
      style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H, borderLeft: `3px solid ${color}` }}
      title={node.session?.prompt}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="grid size-4 shrink-0 place-items-center rounded text-[9px] font-bold text-black"
          style={{ background: color }}
        >
          {node.index}
        </span>
        <span className="truncate text-xs font-medium text-ink">{node.label}</span>
        <span
          className={
            "ml-auto inline-block size-1.5 shrink-0 rounded-full " +
            (activity === "working"
              ? "bg-running dot-running"
              : activity === "error"
                ? "bg-danger"
                : "bg-muted")
          }
        />
      </div>
      <div className="mt-0.5 truncate text-[11px] text-faint">{node.sub}</div>
    </div>
  );
}

/** Deterministic layered layout: root → (batch hubs | sessions) → batch children. */
function layout(sessions: VisualSession[]): {
  nodes: PositionedNode[];
  edges: Edge[];
  width: number;
  height: number;
} {
  const indexOf = new Map(sessions.map((s, i) => [s.id, i + 1]));
  const groups = groupByBatch(sessions);

  const x0 = PAD;
  const x1 = x0 + NODE_W + COL_GAP;
  const x2 = x1 + NODE_W + COL_GAP;

  const nodes: PositionedNode[] = [];
  const edges: Edge[] = [];
  const col1Centers: { x: number; y: number }[] = [];

  let cursor = PAD;
  for (const g of groups) {
    if (g.isBatch) {
      const childTop = cursor;
      const childCenters: { x: number; y: number }[] = [];
      for (const s of g.sessions) {
        const y = cursor;
        nodes.push(sessionNode(s, x2, y, indexOf.get(s.id) ?? 0));
        childCenters.push({ x: x2, y: y + NODE_H / 2 });
        cursor += NODE_H + V_GAP;
      }
      const blockBottom = cursor - V_GAP;
      const hubY = (childTop + blockBottom - NODE_H) / 2;
      const hub: PositionedNode = {
        key: g.key,
        x: x1,
        y: hubY,
        kind: "batch",
        label: "KI-Modus",
        sub: `${g.sessions.length} parallel sub-sessions`,
      };
      nodes.push(hub);
      col1Centers.push({ x: x1, y: hubY + NODE_H / 2 });
      // hub -> each child
      for (const c of childCenters) {
        edges.push({
          key: `${g.key}->${c.y}`,
          from: { x: x1 + NODE_W, y: hubY + NODE_H / 2 },
          to: { x: x2, y: c.y },
        });
      }
      cursor += BLOCK_GAP - V_GAP;
    } else {
      const s = g.sessions[0];
      const y = cursor;
      nodes.push(sessionNode(s, x1, y, indexOf.get(s.id) ?? 0));
      col1Centers.push({ x: x1, y: y + NODE_H / 2 });
      cursor += NODE_H + BLOCK_GAP;
    }
  }

  const contentBottom = Math.max(cursor - BLOCK_GAP, PAD + NODE_H);
  const height = contentBottom + PAD;
  const rootY = (height - NODE_H) / 2;
  nodes.push({
    key: "root",
    x: x0,
    y: rootY,
    kind: "root",
    label: "Launcher",
    sub: `${sessions.length} session${sessions.length === 1 ? "" : "s"}`,
  });
  // root -> each col1 node
  for (const c of col1Centers) {
    edges.push({
      key: `root->${c.y}`,
      from: { x: x0 + NODE_W, y: rootY + NODE_H / 2 },
      to: { x: x1, y: c.y },
    });
  }

  const hasCol2 = groups.some((g) => g.isBatch);
  const width = (hasCol2 ? x2 + NODE_W : x1 + NODE_W) + PAD;
  return { nodes, edges, width, height };
}

function sessionNode(s: VisualSession, x: number, y: number, index: number): PositionedNode {
  return {
    key: s.id,
    x,
    y,
    kind: "session",
    session: s,
    index,
    label: s.projectName?.trim() || "session",
    sub: s.prompt?.trim() || (s.model ? s.model : "Claude Code session"),
  };
}
