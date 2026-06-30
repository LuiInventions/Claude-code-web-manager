"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import {
  groupByBatch,
  sessionActivity,
  sessionColor,
  type LiveActivity,
  type VisualSession,
} from "@/lib/sessions";

/**
 * Flow-graph view — a native re-creation of agent-flow
 * (https://github.com/patoles/agent-flow): a force-directed graph rendered on a
 * canvas. The Launcher is the root hex; every live session is a hex node wired
 * to it (KI-Modus splits fan out from a shared batch hub), and each in-session
 * subagent (Task tool) is a smaller hex linked to its parent. Nodes settle via a
 * d3-force simulation, can be dragged, and pulse with their live activity
 * colour. Hovering a node shows its details. The Sessions tab polls, so nodes
 * appear/clear as sessions come and go — existing nodes keep their position.
 *
 * Respects prefers-reduced-motion: the layout is settled synchronously and then
 * drawn once, with no ongoing animation.
 */

type NodeKind = "root" | "batch" | "session" | "subagent";

interface GNode extends SimulationNodeDatum {
  id: string;
  kind: NodeKind;
  label: string;
  sub?: string;
  /** For session nodes: the owning session id (look up live data at draw time). */
  sessionId?: string;
  /** For subagent nodes: parent session id + the subagent id. */
  parentId?: string;
  subId?: string;
  index?: number;
  r: number;
}
type GLink = SimulationLinkDatum<GNode>;

const R = { root: 34, batch: 26, session: 24, subagent: 15 } as const;

const ACTIVITY_COLOR: Record<LiveActivity, string> = {
  working: "#7ad98f",
  thinking: "#6aa6ff",
  waiting: "#ffd166",
  done: "#7ad98f",
  error: "#fca5a5",
};

interface Hover {
  session?: VisualSession;
  label: string;
  sub?: string;
  activity?: LiveActivity;
  index?: number;
  left: number;
  top: number;
}

export default function FlowGraphView({ sessions }: { sessions: VisualSession[] }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const sessionsMapRef = useRef<Map<string, VisualSession>>(new Map());
  sessionsMapRef.current = new Map(sessions.map((s) => [s.id, s]));

  const reducedRef = useRef(false);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const simRef = useRef<Simulation<GNode, GLink> | null>(null);
  const nodesRef = useRef<GNode[]>([]);
  const linksRef = useRef<GLink[]>([]);
  const posRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const dragRef = useRef<GNode | null>(null);
  const hoverIdRef = useRef<string | null>(null);

  const [hover, setHover] = useState<Hover | null>(null);
  hoverIdRef.current = hover ? `${hover.index ?? ""}:${hover.label}` : null;

  // Rebuild the graph structure only when the set of nodes changes (not on every
  // activity poll) so a live session keeps its settled position.
  const signature = useMemo(
    () =>
      sessions
        .map((s) => `${s.batchId ?? ""}/${s.id}[${(s.subagents ?? []).map((a) => a.id).join(",")}]`)
        .join("|"),
    [sessions],
  );

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedRef.current = mq.matches;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(wrap.clientWidth, 320);
      const h = Math.max(wrap.clientHeight, 320);
      sizeRef.current = { w, h, dpr };
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const sim = simRef.current;
      if (sim) {
        sim.force("center", forceCenter(w / 2, h / 2));
        sim.force("x", forceX(w / 2).strength(0.04));
        sim.force("y", forceY(h / 2).strength(0.06));
        sim.alpha(0.3).restart();
      }
    };

    resize();
    const { w, h } = sizeRef.current;

    const { nodes, links } = buildGraph(sessions);
    // Seed positions from the previous layout so existing nodes don't jump.
    const cx = w / 2;
    const cy = h / 2;
    for (const n of nodes) {
      const prev = posRef.current.get(n.id);
      if (prev) {
        n.x = prev.x;
        n.y = prev.y;
      } else if (n.kind === "root") {
        n.x = cx;
        n.y = cy;
      } else {
        // spawn near centre with a little spread so the sim untangles them
        n.x = cx + Math.cos(hashAngle(n.id)) * 60;
        n.y = cy + Math.sin(hashAngle(n.id)) * 60;
      }
    }
    nodesRef.current = nodes;
    linksRef.current = links;

    const sim = forceSimulation<GNode>(nodes)
      .force(
        "link",
        forceLink<GNode, GLink>(links)
          .id((d) => d.id)
          .distance((l) => {
            const t = l.target as GNode;
            return t.kind === "subagent" ? 56 : 120;
          })
          .strength(0.5),
      )
      .force("charge", forceManyBody<GNode>().strength((n) => (n.kind === "subagent" ? -180 : -520)))
      .force("collide", forceCollide<GNode>((n) => n.r + 10))
      .force("center", forceCenter(cx, cy))
      .force("x", forceX(cx).strength(0.04))
      .force("y", forceY(cy).strength(0.06))
      .stop();
    simRef.current = sim;

    let raf = 0;

    if (reducedRef.current) {
      // Settle synchronously, then a single static draw.
      sim.alpha(1);
      for (let i = 0; i < 300 && sim.alpha() > sim.alphaMin(); i++) sim.tick();
      drawGraph(ctx, 0);
    } else {
      sim.alpha(0.9);
      const loop = (now: number) => {
        if (sim.alpha() > sim.alphaMin()) sim.tick();
        drawGraph(ctx, now);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      // Persist positions so the next rebuild reuses them.
      for (const n of nodesRef.current) {
        if (typeof n.x === "number" && typeof n.y === "number")
          posRef.current.set(n.id, { x: n.x, y: n.y });
      }
      sim.stop();
      simRef.current = null;
    };

    /** Draw links + hex nodes for the current simulation state. */
    function drawGraph(ctx: CanvasRenderingContext2D, now: number) {
      const { w, h, dpr } = sizeRef.current;
      const t = reducedRef.current ? 0 : now / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#1c1812";
      ctx.fillRect(0, 0, w, h);

      // edges
      ctx.lineWidth = 1.5;
      for (const l of linksRef.current) {
        const s = l.source as GNode;
        const tg = l.target as GNode;
        if (s.x == null || tg.x == null) continue;
        const live = liveActivity(tg);
        ctx.strokeStyle = live ? `${ACTIVITY_COLOR[live]}55` : "rgba(255,255,255,0.10)";
        ctx.beginPath();
        ctx.moveTo(s.x, s.y!);
        ctx.lineTo(tg.x, tg.y!);
        ctx.stroke();
      }

      // nodes
      for (const n of nodesRef.current) {
        if (n.x == null || n.y == null) continue;
        drawNode(ctx, n, t);
      }
    }

    /** The live LiveActivity for a node, or undefined for structural nodes. */
    function liveActivity(n: GNode): LiveActivity | undefined {
      if (n.kind === "session" && n.sessionId) {
        const s = sessionsMapRef.current.get(n.sessionId);
        return s ? sessionActivity(s) : undefined;
      }
      if (n.kind === "subagent" && n.parentId && n.subId) {
        const s = sessionsMapRef.current.get(n.parentId);
        return s?.subagents?.find((a) => a.id === n.subId)?.activity;
      }
      return undefined;
    }

    function drawNode(ctx: CanvasRenderingContext2D, n: GNode, t: number) {
      const x = n.x!;
      const y = n.y!;
      const live = liveActivity(n);
      const accent =
        n.kind === "root"
          ? "#6aa6ff"
          : n.kind === "batch"
            ? "#c792ea"
            : n.sessionId
              ? sessionColor(n.sessionId)
              : live
                ? ACTIVITY_COLOR[live]
                : "#9aa0a6";
      const busy = live === "working" || live === "thinking";
      const pulse = busy ? 1 + 0.06 * (0.5 + 0.5 * Math.sin(t * 4 + hashAngle(n.id))) : 1;
      const r = n.r * pulse;
      const hovered = hoverIdRef.current === `${n.index ?? ""}:${n.label}`;

      // glow ring for live activity / hover
      if (live || hovered) {
        ctx.fillStyle = `${live ? ACTIVITY_COLOR[live] : accent}22`;
        hex(ctx, x, y, r + 7);
        ctx.fill();
      }

      // body
      ctx.fillStyle = "#231e18";
      hex(ctx, x, y, r);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = accent;
      hex(ctx, x, y, r);
      ctx.stroke();

      // centre glyph
      ctx.fillStyle = "#eceae5";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (n.kind === "root") {
        ctx.font = "16px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText("🚀", x, y + 1);
      } else if (n.kind === "session" && n.index != null) {
        ctx.fillStyle = accent;
        ctx.font = "bold 14px ui-monospace, monospace";
        ctx.fillText(String(n.index), x, y + 1);
      } else if (n.kind === "batch") {
        ctx.font = "bold 11px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText("KI", x, y + 1);
      } else if (live) {
        // subagent: a small activity dot in the centre
        ctx.fillStyle = ACTIVITY_COLOR[live];
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // label under the node
      const labelColor = n.kind === "subagent" ? "#9a948c" : "#cfcbc4";
      ctx.fillStyle = labelColor;
      ctx.font = `${n.kind === "subagent" ? "10" : "11"}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillText(clip(ctx, n.label, 120), x, y + r + 11);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  /* ---- pointer interaction: drag + hover ---- */

  const nodeAt = (clientX: number, clientY: number): GNode | null => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    let best: GNode | null = null;
    for (const n of nodesRef.current) {
      if (n.x == null || n.y == null) continue;
      const d = Math.hypot(n.x - px, n.y - py);
      if (d <= n.r + 4 && (!best || d < Math.hypot(best.x! - px, best.y! - py))) best = n;
    }
    return best;
  };

  const onDown = (e: React.MouseEvent) => {
    const n = nodeAt(e.clientX, e.clientY);
    if (!n) return;
    dragRef.current = n;
    n.fx = n.x;
    n.fy = n.y;
    simRef.current?.alphaTarget(0.3).restart();
  };

  const onMove = (e: React.MouseEvent) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const drag = dragRef.current;
    if (drag) {
      drag.fx = e.clientX - rect.left;
      drag.fy = e.clientY - rect.top;
      return;
    }
    const n = nodeAt(e.clientX, e.clientY);
    if (!n || n.x == null || n.y == null) {
      if (hover) setHover(null);
      return;
    }
    const sess = n.sessionId ? sessionsMapRef.current.get(n.sessionId) : undefined;
    setHover({
      session: sess,
      label: n.label,
      sub: n.sub,
      activity: sess ? sessionActivity(sess) : undefined,
      index: n.index,
      left: n.x,
      top: n.y - n.r - 6,
    });
  };

  const endDrag = () => {
    const drag = dragRef.current;
    if (drag) {
      drag.fx = null;
      drag.fy = null;
      dragRef.current = null;
      simRef.current?.alphaTarget(0);
    }
  };

  return (
    <div
      ref={wrapRef}
      className="relative h-full min-h-[420px] w-full cursor-grab overflow-hidden active:cursor-grabbing"
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={endDrag}
      onMouseLeave={() => {
        endDrag();
        setHover(null);
      }}
    >
      <canvas ref={canvasRef} className="block" />
      {hover && <Tooltip hover={hover} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Graph construction                                                 */
/* ------------------------------------------------------------------ */

function buildGraph(sessions: VisualSession[]): { nodes: GNode[]; links: GLink[] } {
  const nodes: GNode[] = [];
  const links: GLink[] = [];
  const indexOf = new Map(sessions.map((s, i) => [s.id, i + 1]));

  const root: GNode = {
    id: "root",
    kind: "root",
    label: `Launcher · ${sessions.length} session${sessions.length === 1 ? "" : "s"}`,
    r: R.root,
  };
  nodes.push(root);

  const addSession = (s: VisualSession, parentId: string) => {
    const sn: GNode = {
      id: `s:${s.id}`,
      kind: "session",
      sessionId: s.id,
      label: s.projectName?.trim() || "session",
      sub: s.prompt?.trim() || s.model || "Claude Code session",
      index: indexOf.get(s.id),
      r: R.session,
    };
    nodes.push(sn);
    links.push({ source: parentId, target: sn.id });
    for (const sub of s.subagents ?? []) {
      const an: GNode = {
        id: `a:${s.id}:${sub.id}`,
        kind: "subagent",
        parentId: s.id,
        subId: sub.id,
        label: sub.label,
        r: R.subagent,
      };
      nodes.push(an);
      links.push({ source: sn.id, target: an.id });
    }
  };

  for (const g of groupByBatch(sessions)) {
    if (g.isBatch) {
      const hub: GNode = {
        id: g.key,
        kind: "batch",
        label: "KI-Modus",
        sub: `${g.sessions.length} parallel sub-sessions`,
        r: R.batch,
      };
      nodes.push(hub);
      links.push({ source: "root", target: hub.id });
      for (const s of g.sessions) addSession(s, hub.id);
    } else {
      addSession(g.sessions[0], "root");
    }
  }

  return { nodes, links };
}

/* ------------------------------------------------------------------ */
/* Canvas helpers                                                     */
/* ------------------------------------------------------------------ */

function hex(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

/** Stable pseudo-angle from an id, for spawn spread + per-node pulse phase. */
function hashAngle(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 360) * (Math.PI / 180);
}

function clip(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}

/* ------------------------------------------------------------------ */
/* Hover tooltip (DOM overlay)                                        */
/* ------------------------------------------------------------------ */

function Tooltip({ hover }: { hover: Hover }) {
  const { session, activity, index } = hover;
  const tone = activity ? ACTIVITY_COLOR[activity] : "#9aa0a6";
  return (
    <div
      className="pointer-events-none absolute z-10 w-60 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-elevated p-3 text-xs shadow-lg"
      style={{ left: hover.left, top: hover.top }}
    >
      <div className="mb-1 flex items-center gap-1.5">
        {index != null && session && (
          <span
            className="grid size-4 place-items-center rounded text-[9px] font-bold text-black"
            style={{ background: sessionColor(session.id) }}
          >
            {index}
          </span>
        )}
        <span className="truncate font-semibold text-ink">{hover.label}</span>
        {activity && (
          <span
            className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: `${tone}22`, color: tone }}
          >
            {activity === "waiting" ? "needs approval" : activity}
          </span>
        )}
      </div>
      {session?.prompt?.trim() ? (
        <p className="mb-1 line-clamp-3 text-faint">{session.prompt.trim()}</p>
      ) : hover.sub ? (
        <p className="mb-1 line-clamp-2 text-faint">{hover.sub}</p>
      ) : null}
      {session && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
          {session.model && <span>model: {session.model}</span>}
          {session.effort && <span>effort: {session.effort}</span>}
          {session.repoFullName && <span>{session.repoFullName}</span>}
        </div>
      )}
    </div>
  );
}
