"use client";

import { useEffect, useRef, useState } from "react";
import {
  sessionActivity,
  sessionColor,
  type LiveActivity,
  type VisualSession,
} from "@/lib/sessions";

/**
 * Pixel-office view — a native re-creation of pixel-agents
 * (https://github.com/pixel-agents-hq/pixel-agents): a single shared office room
 * rendered on a canvas. Every live launcher session is a pixel character seated
 * at its own desk; in-session subagents (Task tool) appear as smaller companions
 * beside their parent. Characters animate by live activity — typing while
 * working, bobbing with thought-dots while thinking, flagging an amber "!" when
 * waiting for the user (needs-approval), a green "✓" when done, a red shake on
 * error. The Sessions tab polls, so desks appear/clear as sessions come and go.
 *
 * Layout (desk positions) is recomputed only when the session COUNT or the
 * container size changes; the per-frame draw and the hover handler look the
 * session DATA up fresh by id, so live activity/subagents/labels stay current
 * every poll without re-laying-out. Rendering is hand-drawn pixel art (crisp
 * rects, DPR-aware). Respects prefers-reduced-motion by drawing a single static
 * frame and redrawing it whenever the session data changes.
 */

const CELL_W = 176;
const CELL_H = 168;
const ROOM_PAD = 24;

/** A desk's footprint in the room (layout only — session data is looked up by id). */
interface Desk {
  id: string;
  index: number; // 1-based, matches the launcher numbering
  x: number; // cell top-left (CSS px)
  y: number;
  w: number;
  h: number;
}

interface Hover {
  id: string;
  index: number;
  left: number;
  top: number;
}

export default function PixelOfficeView({ sessions }: { sessions: VisualSession[] }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Live data the animation loop / hover handler read fresh, without restarting.
  const sessionsRef = useRef<VisualSession[]>(sessions);
  const mapRef = useRef<Map<string, VisualSession>>(new Map());
  const desksRef = useRef<Desk[]>([]);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const reducedRef = useRef(false);
  const hoverIdRef = useRef<string | null>(null);
  // Stable handles so the count/data effects can relayout / redraw the same
  // canvas without tearing down the rAF loop.
  const relayoutRef = useRef<(() => void) | null>(null);
  const redrawRef = useRef<(() => void) | null>(null);

  const [hover, setHover] = useState<Hover | null>(null);

  // Keep the latest sessions visible to the loop + hover (set every render).
  sessionsRef.current = sessions;
  mapRef.current = new Map(sessions.map((s) => [s.id, s]));
  hoverIdRef.current = hover?.id ?? null;
  const hoveredSession = hover ? mapRef.current.get(hover.id) : undefined;

  // One-time setup: context, media query, ResizeObserver, the rAF loop.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedRef.current = mq.matches;
    const onMq = () => {
      reducedRef.current = mq.matches;
    };
    mq.addEventListener?.("change", onMq);

    /** Re-measure, size the canvas (DPR-aware) and recompute desk positions. */
    const relayout = () => {
      const list = sessionsRef.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = Math.max(wrap.clientWidth, CELL_W + ROOM_PAD * 2);
      const cols = Math.max(1, Math.floor((cssW - ROOM_PAD * 2) / CELL_W));
      const rows = Math.max(1, Math.ceil(Math.max(list.length, 1) / cols));
      const gridW = cols * CELL_W;
      const offX = Math.round((cssW - gridW) / 2);
      const cssH = Math.max(wrap.clientHeight, rows * CELL_H + ROOM_PAD * 2);

      sizeRef.current = { w: cssW, h: cssH, dpr };
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);

      desksRef.current = list.map((s, i) => ({
        id: s.id,
        index: i + 1,
        x: offX + (i % cols) * CELL_W,
        y: ROOM_PAD + Math.floor(i / cols) * CELL_H,
        w: CELL_W,
        h: CELL_H,
      }));
    };

    /** Draw the whole room for the given timestamp, reading session data fresh. */
    const draw = (now: number) => {
      const { w, h, dpr } = sizeRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawRoom(ctx, w, h);
      const animate = !reducedRef.current;
      for (const desk of desksRef.current) {
        const session = mapRef.current.get(desk.id);
        if (!session) continue;
        drawDesk(ctx, desk, session, now, animate, hoverIdRef.current === desk.id);
      }
    };

    relayoutRef.current = relayout;
    redrawRef.current = () => draw(performance.now());

    relayout();
    draw(performance.now());

    const ro = new ResizeObserver(() => {
      relayout();
      if (reducedRef.current) draw(performance.now());
    });
    ro.observe(wrap);

    let raf = 0;
    const tick = () => {
      draw(performance.now());
      raf = requestAnimationFrame(tick);
    };
    if (!reducedRef.current) raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mq.removeEventListener?.("change", onMq);
      relayoutRef.current = null;
      redrawRef.current = null;
    };
  }, []);

  // Session COUNT changed → recompute desk positions + canvas size, then redraw.
  useEffect(() => {
    relayoutRef.current?.();
    redrawRef.current?.();
  }, [sessions.length]);

  // Session DATA changed (every poll) → for reduced-motion (no rAF loop), redraw
  // so activity/subagent indicators stay current. Animated mode redraws anyway.
  useEffect(() => {
    if (reducedRef.current) redrawRef.current?.();
  }, [sessions]);

  // Hover hit-testing → DOM tooltip overlay (session resolved fresh in render).
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const px = e.clientX - rect.left + wrap.scrollLeft;
    const py = e.clientY - rect.top + wrap.scrollTop;
    const hit = desksRef.current.find(
      (d) => px >= d.x && px <= d.x + d.w && py >= d.y && py <= d.y + d.h,
    );
    if (!hit) {
      if (hover) setHover(null);
      return;
    }
    if (hover?.id === hit.id) return;
    setHover({ id: hit.id, index: hit.index, left: hit.x + hit.w / 2, top: hit.y + 8 });
  };

  return (
    <div
      ref={wrapRef}
      className="pixel-office relative min-h-full w-full cursor-pointer overflow-auto"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <canvas ref={canvasRef} className="block" />
      {hover && hoveredSession && (
        <Tooltip session={hoveredSession} index={hover.index} left={hover.left} top={hover.top} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Room + desk rendering                                              */
/* ------------------------------------------------------------------ */

const C = {
  wall: "#2b2620",
  wallTrim: "#39312a",
  floorA: "#241f1a",
  floorB: "#282219",
  deskTop: "#6b4f32",
  deskEdge: "#7d5c3a",
  deskFront: "#46341f",
  monitor: "#1b1f26",
  monitorFrame: "#0f1216",
  skin: "#f0c8a0",
  hair: "#3a2a22",
  keyboard: "#26211b",
  shadow: "rgba(0,0,0,0.28)",
} as const;

const ACTIVITY_COLOR: Record<LiveActivity, string> = {
  working: "#7ad98f",
  thinking: "#6aa6ff",
  waiting: "#ffd166",
  done: "#7ad98f",
  error: "#fca5a5",
};

function drawRoom(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const wallH = 64;
  ctx.fillStyle = C.wall;
  ctx.fillRect(0, 0, w, wallH);
  ctx.fillStyle = C.wallTrim;
  ctx.fillRect(0, wallH - 4, w, 4);
  // checker floor
  const tile = 32;
  for (let y = wallH; y < h; y += tile) {
    for (let x = 0; x < w; x += tile) {
      const even = ((x / tile) | 0) % 2 === ((y / tile) | 0) % 2;
      ctx.fillStyle = even ? C.floorA : C.floorB;
      ctx.fillRect(x, y, tile, tile);
    }
  }
}

function drawDesk(
  ctx: CanvasRenderingContext2D,
  desk: Desk,
  session: VisualSession,
  now: number,
  animate: boolean,
  hovered: boolean,
) {
  const { index, x, y, w } = desk;
  const activity = sessionActivity(session);
  const color = sessionColor(session.id);
  const glow = ACTIVITY_COLOR[activity];
  // Per-character phase so neighbours don't move in lockstep.
  const phase = (index * 0.7) % (Math.PI * 2);
  const t = animate ? now / 1000 : 0;

  const cx = Math.round(x + w / 2);
  const sScale = 1.6;
  const spriteTop = y + 30;
  const deskLineY = spriteTop + Math.round(33 * sScale);

  if (hovered) {
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fillRect(x + 4, y + 4, w - 8, CELL_H - 8);
  }

  // floor shadow under the desk
  ctx.fillStyle = C.shadow;
  ellipse(ctx, cx, deskLineY + 30, 46, 9);

  // --- character (drawn behind the desk) ---
  const bob =
    activity === "working"
      ? Math.round(Math.sin(t * 6 + phase) * 1) // small typing bounce
      : activity === "thinking"
        ? Math.round(Math.sin(t * 2 + phase) * 2)
        : activity === "done" || activity === "waiting"
          ? Math.round(Math.sin(t * 1.4 + phase) * 1)
          : 0;
  const shake = activity === "error" ? Math.round(Math.sin(t * 22) * 1.5) : 0;
  const handDrop = activity === "working" && Math.sin(t * 14 + phase) > 0 ? 2 : 0;

  drawPerson(ctx, cx, spriteTop + bob, sScale, {
    color,
    handDrop,
    shakeX: shake,
  });

  // --- desk slab in front of the character ---
  const deskW = Math.round(w * 0.62);
  const deskX = cx - deskW / 2;
  ctx.fillStyle = C.deskFront;
  ctx.fillRect(deskX, deskLineY + 6, deskW, 18);
  ctx.fillStyle = C.deskTop;
  ctx.fillRect(deskX - 4, deskLineY, deskW + 8, 8);
  ctx.fillStyle = C.deskEdge;
  ctx.fillRect(deskX - 4, deskLineY, deskW + 8, 2);

  // keyboard on the desk
  ctx.fillStyle = C.keyboard;
  ctx.fillRect(cx - 18, deskLineY - 5, 36, 6);

  // monitor on the desk corner, screen glowing with the activity colour
  const mx = deskX + deskW - 30;
  const my = deskLineY - 26;
  ctx.fillStyle = C.monitorFrame;
  ctx.fillRect(mx, my, 26, 20);
  ctx.fillStyle = activity === "thinking" || activity === "working" ? C.monitor : "#15191f";
  ctx.fillRect(mx + 2, my + 2, 22, 14);
  // scanline glow
  ctx.globalAlpha = activity === "waiting" ? 0.35 : 0.65;
  ctx.fillStyle = glow;
  const lines = activity === "working" ? 3 : activity === "thinking" ? 2 : 1;
  for (let i = 0; i < lines; i++) {
    const lw = activity === "working" ? 6 + (Math.sin(t * 7 + i) + 1) * 7 : 12;
    ctx.fillRect(mx + 4, my + 4 + i * 4, Math.min(lw, 18), 2);
  }
  ctx.globalAlpha = 1;
  // monitor stand
  ctx.fillStyle = C.monitorFrame;
  ctx.fillRect(mx + 11, my + 20, 4, 4);

  // --- status bubble above the head ---
  drawBubble(ctx, cx + 22, spriteTop - 6, activity, t);

  // --- subagent companions ---
  const subs = session.subagents ?? [];
  const shown = subs.slice(0, 3);
  shown.forEach((sub, i) => {
    const sx = x + w - 26 - i * 22;
    const sy = spriteTop + 18 + (animate ? Math.round(Math.sin(t * 3 + i) * 1.5) : 0);
    drawPerson(ctx, sx, sy, 0.85, {
      color: "#c792ea",
      handDrop: sub.activity === "working" && Math.sin(t * 12 + i) > 0 ? 2 : 0,
      shakeX: 0,
    });
    // tiny activity dot
    ctx.fillStyle = ACTIVITY_COLOR[sub.activity];
    ctx.beginPath();
    ctx.arc(sx, sy - 4, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // --- name plate ---
  const plateY = y + CELL_H - 30;
  const title = session.projectName?.trim() || "session";
  ctx.fillStyle = color;
  roundRect(ctx, cx - 9, plateY, 18, 16, 4);
  ctx.fill();
  ctx.fillStyle = "#000";
  ctx.font = "bold 11px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(index), cx, plateY + 8);

  ctx.fillStyle = "#e8e3da";
  ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(truncate(ctx, title, w - 36), cx, plateY + 26);

  // activity caption
  ctx.fillStyle = glow;
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  const caption =
    activity === "waiting"
      ? "needs approval"
      : subs.length
        ? `${activity} · ${subs.length} subagent${subs.length === 1 ? "" : "s"}`
        : activity;
  ctx.fillText(truncate(ctx, caption, w - 24), cx, plateY + 40);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** A small front-facing pixel character (40×44 grid), scaled and offset. */
function drawPerson(
  ctx: CanvasRenderingContext2D,
  cx: number,
  top: number,
  s: number,
  o: { color: string; handDrop: number; shakeX: number },
) {
  const left = Math.round(cx - 20 * s + o.shakeX);
  const px = (gx: number, gy: number, gw: number, gh: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.fillRect(
      Math.round(left + gx * s),
      Math.round(top + gy * s),
      Math.ceil(gw * s),
      Math.ceil(gh * s),
    );
  };
  px(10, 2, 20, 8, C.hair); // hair
  px(11, 6, 18, 13, C.skin); // head
  px(15, 11, 3, 3, "#1a1410"); // eyes
  px(22, 11, 3, 3, "#1a1410");
  px(9, 19, 22, 15, o.color); // body
  ctx.globalAlpha = 0.5;
  px(18, 19, 4, 4, "#ffffff"); // collar
  ctx.globalAlpha = 1;
  px(5, 21, 4, 11, o.color); // arms
  px(31, 21, 4, 11, o.color);
  px(5, 31 + o.handDrop, 4, 4, C.skin); // hands
  px(31, 31 + o.handDrop, 4, 4, C.skin);
}

/** Status bubble: animated dots while busy, a glyph for waiting/done/error. */
function drawBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  activity: LiveActivity,
  t: number,
) {
  if (activity === "working" || activity === "thinking") {
    const wBub = 26;
    ctx.fillStyle = "#1b1f26";
    roundRect(ctx, x, y - 14, wBub, 16, 5);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    roundRect(ctx, x, y - 14, wBub, 16, 5);
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const a = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 5 - i * 0.9));
      ctx.globalAlpha = a;
      ctx.fillStyle = ACTIVITY_COLOR[activity];
      ctx.beginPath();
      ctx.arc(x + 7 + i * 6, y - 6, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return;
  }
  const glyph = activity === "error" ? "!" : activity === "waiting" ? "!" : "✓";
  const tone = ACTIVITY_COLOR[activity];
  ctx.fillStyle = "#1b1f26";
  roundRect(ctx, x, y - 16, 18, 18, 5);
  ctx.fill();
  ctx.strokeStyle = tone;
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y - 16, 18, 18, 5);
  ctx.stroke();
  ctx.fillStyle = tone;
  ctx.font = "bold 12px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(glyph, x + 9, y - 6);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/* ------------------------------------------------------------------ */
/* Small canvas helpers                                               */
/* ------------------------------------------------------------------ */

function ellipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}

/* ------------------------------------------------------------------ */
/* Hover tooltip (DOM overlay)                                        */
/* ------------------------------------------------------------------ */

function Tooltip({
  session,
  index,
  left,
  top,
}: {
  session: VisualSession;
  index: number;
  left: number;
  top: number;
}) {
  const activity = sessionActivity(session);
  return (
    <div
      className="pointer-events-none absolute z-10 w-60 -translate-x-1/2 translate-y-2 rounded-lg border border-line bg-elevated p-3 text-xs shadow-lg"
      style={{ left, top }}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span
          className="grid size-4 place-items-center rounded text-[9px] font-bold text-black"
          style={{ background: sessionColor(session.id) }}
        >
          {index}
        </span>
        <span className="truncate font-semibold text-ink">
          {session.projectName?.trim() || "session"}
        </span>
        <span
          className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium"
          style={{ background: `${ACTIVITY_COLOR[activity]}22`, color: ACTIVITY_COLOR[activity] }}
        >
          {activity === "waiting" ? "needs approval" : activity}
        </span>
      </div>
      {session.prompt?.trim() && (
        <p className="mb-1 line-clamp-3 text-faint">{session.prompt.trim()}</p>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
        {session.model && <span>model: {session.model}</span>}
        {session.effort && <span>effort: {session.effort}</span>}
        {session.repoFullName && <span>{session.repoFullName}</span>}
      </div>
      {(session.subagents?.length ?? 0) > 0 && (
        <div className="mt-2 border-t border-line pt-1.5">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-faint">Subagents</p>
          <ul className="space-y-0.5">
            {session.subagents!.slice(0, 5).map((sub) => (
              <li key={sub.id} className="flex items-center gap-1.5">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: ACTIVITY_COLOR[sub.activity] }}
                />
                <span className="truncate text-faint">{sub.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
