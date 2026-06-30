"use client";

import { useEffect, useRef, useState } from "react";
import {
  avatarVariant,
  groupByBatch,
  hashId,
  numberSessions,
  sessionActivity,
  sessionColor,
  type LiveActivity,
  type ToolKind,
  type VisualSession,
} from "@/lib/sessions";

/**
 * Pixel-office view — the single, native re-creation of pixel-agents
 * (https://github.com/pixel-agents-hq/pixel-agents). Every live launcher session
 * is a hand-drawn pixel character in a shared office that is split into rooms:
 *
 *   • Work Room    — active sessions (working / thinking / waiting / error) at
 *                    desks. The monitor + character animate by the *precise*
 *                    activity, and the desk caption shows what's being worked on
 *                    (✎ a file, ⌕ a search, $ a command, a host).
 *   • Meeting Room — KI-Modus batches (sessions that started together) seated
 *                    around a round table, one table per batch.
 *   • Break Room   — finished (done) sessions relaxing on couches.
 *
 * In-session subagents (Task tool) are drawn as their own little pixel people
 * beside their parent. Each character wears a #N name-plate whose number is
 * IDENTICAL to the Launcher's (oldest = #1, via numberSessions), so a session is
 * unambiguous across both tabs. Rendering is crisp pixel art on one DPR-aware
 * <canvas>; the rAF loop pauses when the tab is hidden and respects
 * prefers-reduced-motion (single static frame, redrawn when data changes).
 *
 * Layout (rooms + seat positions) is recomputed only when the session set or the
 * container size changes; the per-frame draw + hover look session DATA up fresh
 * by id, so live activity / subagents / captions stay current every poll.
 */

/* ------------------------------------------------------------------ */
/* Dimensions                                                         */
/* ------------------------------------------------------------------ */

const CELL_W = 188;
const CELL_H = 200;
const ROOM_PAD = 18;
const ROOM_HEADER = 30;
const ROOM_GAP = 14;
const CLUSTER_W = 248;
const CLUSTER_H = 224;

type RoomKind = "work" | "break" | "meeting";

/** One occupant's footprint (layout only — session data is looked up by id). */
interface Seat {
  id: string;
  number: number; // 1-based, matches the Launcher numbering
  cx: number; // character centre x (css px)
  top: number; // character sprite top y
  baseY: number; // furniture baseline (desk / couch / chair line)
  cellLeft: number;
  cellRight: number;
  room: RoomKind;
  hit: { x: number; y: number; w: number; h: number };
}

/** A KI-Modus batch round table in the Meeting Room. */
interface Cluster {
  label: string;
  cx: number;
  cy: number;
  r: number;
}

interface RoomBlock {
  kind: RoomKind;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  clusters?: Cluster[];
}

interface Hover {
  id: string;
  left: number;
  top: number;
}

export default function PixelOfficeView({ sessions }: { sessions: VisualSession[] }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Live data the loop / hover read fresh, without restarting the rAF loop.
  const sessionsRef = useRef<VisualSession[]>(sessions);
  const mapRef = useRef<Map<string, VisualSession>>(new Map());
  const numberRef = useRef<Map<string, number>>(new Map());
  const roomsRef = useRef<RoomBlock[]>([]);
  const seatsRef = useRef<Seat[]>([]);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const reducedRef = useRef(false);
  const hoverIdRef = useRef<string | null>(null);
  const relayoutRef = useRef<(() => void) | null>(null);
  const redrawRef = useRef<(() => void) | null>(null);

  const [hover, setHover] = useState<Hover | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);

  // Keep the latest sessions visible to the loop + hover (set every render).
  sessionsRef.current = sessions;
  mapRef.current = new Map(sessions.map((s) => [s.id, s]));
  numberRef.current = numberSessions(sessions);
  const shownId = pinned && mapRef.current.has(pinned) ? pinned : hover?.id ?? null;
  hoverIdRef.current = shownId;
  const shownSession = shownId ? mapRef.current.get(shownId) : undefined;

  // Anything that changes which room a session lands in (its id, its batch, or
  // whether it's done) must trigger a relayout — not just the session count.
  const layoutSig = sessions
    .map((s) => `${s.id}|${s.batchId ?? ""}|${sessionActivity(s) === "done" ? "d" : "a"}`)
    .join(";");

  // One-time setup: context, media query, ResizeObserver, visibility, rAF loop.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedRef.current = mq.matches;

    /** Re-measure, size the canvas (DPR-aware) and recompute rooms + seats. */
    const relayout = () => {
      const list = sessionsRef.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = Math.max(wrap.clientWidth, CELL_W + ROOM_PAD * 2);
      const cols = Math.max(1, Math.floor((cssW - ROOM_PAD * 2) / CELL_W));
      const number = numberRef.current;

      // Partition: KI-Modus batches → Meeting; done singletons → Break; rest → Work.
      const groups = groupByBatch(list);
      const batches = groups.filter((g) => g.isBatch);
      const singles = groups.filter((g) => !g.isBatch).map((g) => g.sessions[0]);
      const doneSingles = singles.filter((s) => sessionActivity(s) === "done");
      const workSingles = singles.filter((s) => sessionActivity(s) !== "done");

      const rooms: RoomBlock[] = [];
      const seats: Seat[] = [];
      let y = ROOM_PAD;

      const gridRoom = (kind: RoomKind, title: string, members: VisualSession[]) => {
        if (!members.length) return;
        const rows = Math.ceil(members.length / cols);
        const gridW = Math.min(cols, members.length) * CELL_W;
        const offX = Math.round((cssW - gridW) / 2);
        const roomH = ROOM_HEADER + rows * CELL_H + ROOM_PAD;
        rooms.push({ kind, title, x: ROOM_PAD, y, w: cssW - ROOM_PAD * 2, h: roomH });
        members.forEach((s, i) => {
          const c = i % cols;
          const r = Math.floor(i / cols);
          const cellLeft = offX + c * CELL_W;
          const cellTop = y + ROOM_HEADER + r * CELL_H;
          const cx = Math.round(cellLeft + CELL_W / 2);
          const top = cellTop + 36;
          const baseY = top + 56;
          seats.push({
            id: s.id,
            number: number.get(s.id) ?? 0,
            cx,
            top,
            baseY,
            cellLeft,
            cellRight: cellLeft + CELL_W,
            room: kind,
            hit: { x: cellLeft + 6, y: cellTop + 4, w: CELL_W - 12, h: CELL_H - 8 },
          });
        });
        y += roomH + ROOM_GAP;
      };

      gridRoom("work", "Work Room", workSingles);

      if (batches.length) {
        const ccols = Math.max(1, Math.floor((cssW - ROOM_PAD * 2) / CLUSTER_W));
        const crows = Math.ceil(batches.length / ccols);
        const gridW = Math.min(ccols, batches.length) * CLUSTER_W;
        const offX = Math.round((cssW - gridW) / 2);
        const roomH = ROOM_HEADER + crows * CLUSTER_H + ROOM_PAD;
        const clusters: Cluster[] = [];
        batches.forEach((g, i) => {
          const c = i % ccols;
          const r = Math.floor(i / ccols);
          const cxc = offX + c * CLUSTER_W + CLUSTER_W / 2;
          const cyc = y + ROOM_HEADER + r * CLUSTER_H + CLUSTER_H / 2;
          const n = g.sessions.length;
          const ring = Math.max(60, 30 + n * 7);
          g.sessions.forEach((s, k) => {
            const a = -Math.PI / 2 + (k / n) * Math.PI * 2;
            const sx = Math.round(cxc + Math.cos(a) * ring);
            const sy = Math.round(cyc + Math.sin(a) * ring);
            seats.push({
              id: s.id,
              number: number.get(s.id) ?? 0,
              cx: sx,
              top: sy - 30,
              baseY: sy + 8,
              cellLeft: sx - 30,
              cellRight: sx + 30,
              room: "meeting",
              hit: { x: sx - 28, y: sy - 42, w: 56, h: 70 },
            });
          });
          clusters.push({ label: `KI-Modus · ${n}`, cx: cxc, cy: cyc, r: ring });
        });
        rooms.push({
          kind: "meeting",
          title: "Meeting Room",
          x: ROOM_PAD,
          y,
          w: cssW - ROOM_PAD * 2,
          h: roomH,
          clusters,
        });
        y += roomH + ROOM_GAP;
      }

      gridRoom("break", "Break Room", doneSingles);

      const cssH = Math.max(wrap.clientHeight, y + ROOM_PAD);
      sizeRef.current = { w: cssW, h: cssH, dpr };
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      roomsRef.current = rooms;
      seatsRef.current = seats;
    };

    /** Draw the whole office for the given timestamp, reading data fresh. */
    const draw = (now: number) => {
      const { w, h, dpr } = sizeRef.current;
      const animate = !reducedRef.current;
      const t = animate ? now / 1000 : 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, w, h);

      for (const room of roomsRef.current) drawRoom(ctx, room, t);

      for (const seat of seatsRef.current) {
        const s = mapRef.current.get(seat.id);
        if (!s) continue;
        const hovered = hoverIdRef.current === seat.id;
        if (seat.room === "meeting") drawMeetingSeat(ctx, seat, s, t, animate, hovered);
        else drawDeskOrCouch(ctx, seat, s, t, animate, hovered);
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
      if (!document.hidden) draw(performance.now());
      raf = requestAnimationFrame(tick);
    };
    const startLoop = () => {
      if (!raf && !reducedRef.current) raf = requestAnimationFrame(tick);
    };
    const stopLoop = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    // React to a live prefers-reduced-motion change: stop the loop + draw a
    // single static frame when motion is disabled, resume it when re-enabled.
    const onMq = () => {
      reducedRef.current = mq.matches;
      if (mq.matches) {
        stopLoop();
        draw(performance.now());
      } else {
        startLoop();
      }
    };
    mq.addEventListener?.("change", onMq);

    startLoop();

    return () => {
      stopLoop();
      ro.disconnect();
      mq.removeEventListener?.("change", onMq);
      relayoutRef.current = null;
      redrawRef.current = null;
    };
  }, []);

  // Room assignment changed (count, ids, batches, or done-state) → recompute
  // rooms + canvas size, then redraw so sessions move between rooms live.
  useEffect(() => {
    relayoutRef.current?.();
    redrawRef.current?.();
  }, [layoutSig]);

  // Session DATA changed → for reduced-motion (no rAF loop) redraw so activity /
  // subagent / caption indicators stay current. Animated mode redraws anyway.
  useEffect(() => {
    if (reducedRef.current) redrawRef.current?.();
  }, [sessions]);

  // Hit-test the seat under the pointer (accounts for scroll).
  const seatAt = (e: React.MouseEvent<HTMLDivElement>): Seat | null => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const px = e.clientX - rect.left + wrap.scrollLeft;
    const py = e.clientY - rect.top + wrap.scrollTop;
    return (
      seatsRef.current.find(
        (d) => px >= d.hit.x && px <= d.hit.x + d.hit.w && py >= d.hit.y && py <= d.hit.y + d.hit.h,
      ) ?? null
    );
  };

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const hit = seatAt(e);
    if (!hit) {
      if (hover) setHover(null);
      return;
    }
    if (hover?.id === hit.id) return;
    setHover({ id: hit.id, left: hit.cx, top: hit.hit.y });
  };

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const hit = seatAt(e);
    if (!hit) {
      setPinned(null);
      return;
    }
    setPinned((p) => (p === hit.id ? null : hit.id));
    setHover({ id: hit.id, left: hit.cx, top: hit.hit.y });
  };

  // Position the tooltip at the shown seat (pinned wins over hover).
  const shownSeat = shownId ? seatsRef.current.find((s) => s.id === shownId) : undefined;
  const tip =
    shownId && shownSeat
      ? { left: hover?.id === shownId ? hover.left : shownSeat.cx, top: hover?.id === shownId ? hover.top : shownSeat.hit.y }
      : null;

  return (
    <div
      ref={wrapRef}
      className="pixel-office relative min-h-full w-full cursor-pointer overflow-auto"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
      onClick={onClick}
    >
      <canvas ref={canvasRef} className="block" />
      {tip && shownSession && (
        <Tooltip
          session={shownSession}
          index={numberRef.current.get(shownSession.id) ?? 0}
          left={tip.left}
          top={tip.top}
          pinned={pinned === shownSession.id}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Palette + activity mapping                                         */
/* ------------------------------------------------------------------ */

const C = {
  bg: "#1b1712",
  workA: "#241f1a",
  workB: "#2a241c",
  breakA: "#2a211a",
  breakB: "#31281a",
  meetA: "#1e222a",
  meetB: "#242a35",
  wall: "#2b2620",
  wallTrim: "#39312a",
  sign: "#0f1216",
  desk: "#6b4f32",
  deskEdge: "#7d5c3a",
  deskFront: "#46341f",
  monitor: "#0e1218",
  monitorFrame: "#0a0c10",
  keyboard: "#26211b",
  couch: "#3b4358",
  couchArm: "#2f3648",
  table: "#5b4630",
  tableEdge: "#6e5538",
  plant: "#3f7d4f",
  plantDark: "#2f5e3b",
  pot: "#7a4a2e",
  mug: "#d8d2c8",
  shadow: "rgba(0,0,0,0.28)",
  ink: "#e8e3da",
  faint: "#9a948c",
} as const;

const ACTIVITY_COLOR: Record<LiveActivity, string> = {
  working: "#7ad98f",
  thinking: "#6aa6ff",
  waiting: "#ffd166",
  done: "#7ad98f",
  error: "#fca5a5",
};

const TOOL_GLYPH: Record<ToolKind, string> = {
  edit: "✎",
  read: "≣",
  search: "⌕",
  bash: "$",
  web: "◍",
  task: "⚑",
  other: "•",
};

const TOOL_WORD: Record<ToolKind, string> = {
  edit: "editing",
  read: "reading",
  search: "searching",
  bash: "running",
  web: "fetching",
  task: "delegating",
  other: "working on",
};

/** Distinct character looks (hair/skin), combined with the per-session shirt. */
const HAIR = ["#3a2a22", "#1f1a17", "#6b4a2a", "#8a8f98", "#caa45a", "#52307c"];
const SKIN = ["#f0c8a0", "#e8b58a", "#d49a6a", "#c8855a", "#f3d0ac", "#a86b43"];

type Pose = "typing" | "reading" | "running" | "idle" | "wave" | "shake";

function poseFor(activity: LiveActivity, tool: ToolKind | undefined): Pose {
  if (activity === "error") return "shake";
  if (activity === "waiting") return "wave";
  if (activity === "thinking" || activity === "done") return "idle";
  if (tool === "read" || tool === "search") return "reading";
  if (tool === "bash") return "running";
  return "typing";
}

/** Glyph + short text shown under a desk for the session's current activity. */
function caption(s: VisualSession): { glyph: string; text: string } {
  const a = sessionActivity(s);
  if (a === "waiting") return { glyph: "!", text: "needs approval" };
  if (a === "thinking") return { glyph: "", text: "thinking…" };
  if (a === "done") return { glyph: "✓", text: "done" };
  if (a === "error")
    return { glyph: "!", text: s.exitCode != null ? `error (${s.exitCode})` : "error" };
  if (s.tool) return { glyph: TOOL_GLYPH[s.tool], text: s.detail || s.tool };
  return { glyph: "", text: "working" };
}

/* ------------------------------------------------------------------ */
/* Room backdrops                                                     */
/* ------------------------------------------------------------------ */

function drawRoom(ctx: CanvasRenderingContext2D, room: RoomBlock, t: number) {
  const { x, y, w, h, kind, title } = room;
  const [fa, fb] =
    kind === "break"
      ? [C.breakA, C.breakB]
      : kind === "meeting"
        ? [C.meetA, C.meetB]
        : [C.workA, C.workB];

  // floor (checker), clipped to the room
  ctx.save();
  roundRect(ctx, x, y, w, h, 10);
  ctx.clip();
  const tile = 30;
  for (let ty = y; ty < y + h; ty += tile) {
    for (let tx = x; tx < x + w; tx += tile) {
      const even = (((tx - x) / tile) | 0) % 2 === (((ty - y) / tile) | 0) % 2;
      ctx.fillStyle = even ? fa : fb;
      ctx.fillRect(tx, ty, tile, tile);
    }
  }
  // back wall band
  ctx.fillStyle = C.wall;
  ctx.fillRect(x, y, w, ROOM_HEADER);
  ctx.fillStyle = C.wallTrim;
  ctx.fillRect(x, y + ROOM_HEADER - 3, w, 3);

  // wall decoration on the right of the header
  if (kind === "work") drawClock(ctx, x + w - 26, y + 15, t);
  else if (kind === "meeting") drawWindow(ctx, x + w - 52, y + 6);
  else drawPlantSmall(ctx, x + w - 30, y + 4);

  ctx.restore();

  // room outline + name sign
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 10);
  ctx.stroke();

  ctx.fillStyle = C.sign;
  roundRect(ctx, x + 12, y + 7, 8 + title.length * 7.5, 17, 5);
  ctx.fill();
  ctx.fillStyle = C.ink;
  ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(title, x + 18, y + 16);

  // meeting room tables sit under the characters
  if (room.clusters) for (const cl of room.clusters) drawRoundTable(ctx, cl);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawRoundTable(ctx: CanvasRenderingContext2D, cl: Cluster) {
  const rr = Math.max(26, cl.r - 30);
  ctx.fillStyle = C.shadow;
  ellipse(ctx, cl.cx, cl.cy + 6, rr + 4, (rr + 4) * 0.5);
  ctx.fillStyle = C.table;
  ellipse(ctx, cl.cx, cl.cy, rr, rr * 0.52);
  ctx.fillStyle = C.tableEdge;
  ellipse(ctx, cl.cx, cl.cy - 2, rr, rr * 0.5);
  ctx.fillStyle = C.table;
  ellipse(ctx, cl.cx, cl.cy - 3, rr - 5, rr * 0.42);
  ctx.fillStyle = C.faint;
  ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(cl.label, cl.cx, cl.cy + cl.r + 16);
  ctx.textAlign = "left";
}

/* ------------------------------------------------------------------ */
/* Seats — desks, couches, meeting chairs                             */
/* ------------------------------------------------------------------ */

function drawDeskOrCouch(
  ctx: CanvasRenderingContext2D,
  seat: Seat,
  s: VisualSession,
  t: number,
  animate: boolean,
  hovered: boolean,
) {
  const activity = sessionActivity(s);
  const shirt = sessionColor(s.id);
  const variant = avatarVariant(s.id);
  const glow = ACTIVITY_COLOR[activity];
  const phase = (hashId(s.id) % 628) / 100;
  const tt = animate ? t : 0;
  const { cx, top, baseY } = seat;

  if (hovered) {
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    roundRect(ctx, seat.hit.x, seat.hit.y, seat.hit.w, seat.hit.h, 8);
    ctx.fill();
  }

  ctx.fillStyle = C.shadow;
  ellipse(ctx, cx, baseY + 28, 44, 8);

  const pose = poseFor(activity, s.tool);
  const bob =
    pose === "idle"
      ? Math.round(Math.sin(tt * 2 + phase) * 2)
      : pose === "typing"
        ? Math.round(Math.sin(tt * 6 + phase) * 1)
        : 0;
  const shake = pose === "shake" ? Math.round(Math.sin(tt * 22) * 1.5) : 0;

  drawPerson(ctx, cx, top + bob, 1.55, { variant, shirt, pose, t: tt, phase, shakeX: shake });

  if (seat.room === "break") {
    drawCouch(ctx, cx, baseY);
    drawMug(ctx, cx + 50, baseY + 4);
  } else {
    drawDeskTop(ctx, cx, baseY);
    ctx.fillStyle = C.keyboard;
    ctx.fillRect(cx - 18, baseY - 5, 36, 6);
    drawMonitor(ctx, cx + 20, baseY - 30, activity, s.tool, glow, tt);
  }

  drawBubble(ctx, cx + 20, top - 4, activity, tt);
  drawSubagents(ctx, seat, s, tt, animate, 0.82);
  drawNamePlate(ctx, seat, s, glow);
}

function drawMeetingSeat(
  ctx: CanvasRenderingContext2D,
  seat: Seat,
  s: VisualSession,
  t: number,
  animate: boolean,
  hovered: boolean,
) {
  const activity = sessionActivity(s);
  const shirt = sessionColor(s.id);
  const variant = avatarVariant(s.id);
  const glow = ACTIVITY_COLOR[activity];
  const phase = (hashId(s.id) % 628) / 100;
  const tt = animate ? t : 0;
  const { cx, top } = seat;

  if (hovered) {
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    roundRect(ctx, seat.hit.x, seat.hit.y, seat.hit.w, seat.hit.h, 8);
    ctx.fill();
  }

  ctx.fillStyle = C.shadow;
  ellipse(ctx, cx, seat.baseY + 6, 18, 5);

  const pose = poseFor(activity, s.tool);
  const bob = pose === "idle" ? Math.round(Math.sin(tt * 2 + phase) * 1.5) : 0;
  const shake = pose === "shake" ? Math.round(Math.sin(tt * 22) * 1.2) : 0;
  drawPerson(ctx, cx, top + bob, 1.05, { variant, shirt, pose, t: tt, phase, shakeX: shake });
  drawBubble(ctx, cx + 13, top - 2, activity, tt);

  drawSubagents(ctx, seat, s, tt, animate, 0.55, 2);

  const plateY = seat.baseY + 12;
  ctx.fillStyle = shirt;
  roundRect(ctx, cx - 9, plateY, 18, 14, 4);
  ctx.fill();
  ctx.fillStyle = "#000";
  ctx.font = "bold 10px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(seat.number), cx, plateY + 7);
  ctx.fillStyle = glow;
  ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(truncate(ctx, s.projectName?.trim() || "session", 70), cx, plateY + 24);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawSubagents(
  ctx: CanvasRenderingContext2D,
  seat: Seat,
  s: VisualSession,
  t: number,
  animate: boolean,
  scale: number,
  max = 3,
) {
  const subs = s.subagents ?? [];
  if (!subs.length) return;
  const shown = subs.slice(0, max);
  const step = 22 * scale;
  shown.forEach((sub, i) => {
    const sx = Math.round(seat.cellRight - 18 - i * step);
    const sy = Math.round(seat.baseY - 2 + (animate ? Math.sin(t * 3 + i) * 1.4 : 0));
    const variant = avatarVariant(sub.id + s.id);
    drawPerson(ctx, sx, sy - Math.round(44 * scale), scale, {
      variant,
      shirt: "#c792ea",
      pose: sub.activity === "working" ? "typing" : "idle",
      t,
      phase: i,
      shakeX: 0,
    });
    ctx.fillStyle = ACTIVITY_COLOR[sub.activity];
    ctx.beginPath();
    ctx.arc(sx, sy - Math.round(48 * scale), 2.4, 0, Math.PI * 2);
    ctx.fill();
  });
  if (subs.length > shown.length) {
    ctx.fillStyle = C.faint;
    ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      `+${subs.length - shown.length}`,
      seat.cellRight - 18 - shown.length * step,
      seat.baseY - 6,
    );
    ctx.textAlign = "left";
  }
}

function drawNamePlate(ctx: CanvasRenderingContext2D, seat: Seat, s: VisualSession, glow: string) {
  const { cx } = seat;
  const plateY = seat.hit.y + seat.hit.h - 52;
  ctx.fillStyle = sessionColor(s.id);
  roundRect(ctx, cx - 10, plateY, 20, 16, 4);
  ctx.fill();
  ctx.fillStyle = "#000";
  ctx.font = "bold 11px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(seat.number), cx, plateY + 8);

  ctx.fillStyle = C.ink;
  ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(truncate(ctx, s.projectName?.trim() || "session", CELL_W - 30), cx, plateY + 28);

  const cap = caption(s);
  ctx.fillStyle = glow;
  ctx.font = "11px ui-monospace, monospace";
  const label = cap.glyph ? `${cap.glyph} ${cap.text}` : cap.text;
  ctx.fillText(truncate(ctx, label, CELL_W - 24), cx, plateY + 43);

  const subs = s.subagents?.length ?? 0;
  if (subs) {
    ctx.fillStyle = C.faint;
    ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(`${subs} subagent${subs === 1 ? "" : "s"}`, cx, plateY + 57);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/* ------------------------------------------------------------------ */
/* Furniture                                                          */
/* ------------------------------------------------------------------ */

function drawDeskTop(ctx: CanvasRenderingContext2D, cx: number, baseY: number) {
  const deskW = Math.round(CELL_W * 0.6);
  const deskX = cx - deskW / 2;
  ctx.fillStyle = C.deskFront;
  ctx.fillRect(deskX, baseY + 6, deskW, 18);
  ctx.fillStyle = C.desk;
  ctx.fillRect(deskX - 4, baseY, deskW + 8, 8);
  ctx.fillStyle = C.deskEdge;
  ctx.fillRect(deskX - 4, baseY, deskW + 8, 2);
}

function drawMonitor(
  ctx: CanvasRenderingContext2D,
  mx: number,
  my: number,
  activity: LiveActivity,
  tool: ToolKind | undefined,
  glow: string,
  t: number,
) {
  ctx.fillStyle = C.monitorFrame;
  ctx.fillRect(mx, my, 30, 22);
  const on = activity === "working" || activity === "thinking";
  ctx.fillStyle = on ? C.monitor : "#14181e";
  ctx.fillRect(mx + 2, my + 2, 26, 16);

  ctx.save();
  ctx.beginPath();
  ctx.rect(mx + 3, my + 3, 24, 14);
  ctx.clip();
  if (activity === "working") {
    const rows = tool === "bash" ? 3 : 4;
    for (let i = 0; i < rows; i++) {
      const yy = my + 5 + ((i * 4 + Math.floor(t * 8)) % 14);
      const base = tool === "bash" ? 4 : tool === "read" || tool === "search" ? 6 : 3;
      const lw = base + (Math.sin(t * 7 + i) + 1) * 7;
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = glow;
      ctx.fillRect(mx + 4, yy, Math.min(lw, 22), 2);
    }
    if (tool === "bash") {
      ctx.globalAlpha = 1;
      ctx.fillStyle = glow;
      ctx.fillRect(mx + 4, my + 13, 3, 3);
    }
  } else if (activity === "thinking") {
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = 0.3 + 0.6 * (0.5 + 0.5 * Math.sin(t * 5 - i * 0.9));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(mx + 9 + i * 6, my + 10, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (activity === "waiting") {
    ctx.globalAlpha = 0.4 + 0.4 * (0.5 + 0.5 * Math.sin(t * 3));
    ctx.fillStyle = glow;
    ctx.fillRect(mx + 5, my + 9, 6, 2);
  } else {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = glow;
    ctx.fillRect(mx + 5, my + 9, 12, 2);
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  ctx.fillStyle = C.monitorFrame;
  ctx.fillRect(mx + 13, my + 22, 4, 4);
}

function drawCouch(ctx: CanvasRenderingContext2D, cx: number, baseY: number) {
  const w = 78;
  const x = cx - w / 2;
  ctx.fillStyle = C.couchArm;
  ctx.fillRect(x - 6, baseY - 14, 10, 30);
  ctx.fillRect(x + w - 4, baseY - 14, 10, 30);
  ctx.fillStyle = C.couch;
  roundRect(ctx, x, baseY - 18, w, 14, 4);
  ctx.fill();
  ctx.fillStyle = C.couch;
  ctx.fillRect(x, baseY, w, 14);
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(x + 4, baseY + 2, w - 8, 3);
}

function drawMug(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = C.mug;
  ctx.fillRect(x, y, 8, 9);
  ctx.fillRect(x + 8, y + 2, 3, 4);
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.fillRect(x + 1, y - 3, 1, 3);
  ctx.fillRect(x + 4, y - 4, 1, 3);
}

function drawClock(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  ctx.fillStyle = "#d9d3c8";
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#3a332b";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.stroke();
  const a = (t % 60) * (Math.PI / 30);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(a - Math.PI / 2) * 4, y + Math.sin(a - Math.PI / 2) * 4);
  ctx.stroke();
}

function drawWindow(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#2a3340";
  ctx.fillRect(x, y, 44, 18);
  ctx.fillStyle = "#3a4a5e";
  ctx.fillRect(x + 2, y + 2, 40, 14);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(x + 2, y + 2, 40, 5);
  ctx.fillStyle = "#1f2630";
  ctx.fillRect(x + 21, y, 2, 18);
  ctx.fillRect(x, y + 8, 44, 2);
}

function drawPlantSmall(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = C.pot;
  ctx.fillRect(x, y + 14, 12, 8);
  ctx.fillStyle = C.plantDark;
  ctx.fillRect(x + 1, y + 6, 4, 9);
  ctx.fillRect(x + 7, y + 6, 4, 9);
  ctx.fillStyle = C.plant;
  ctx.fillRect(x + 3, y, 6, 9);
}

/* ------------------------------------------------------------------ */
/* Character                                                          */
/* ------------------------------------------------------------------ */

function drawPerson(
  ctx: CanvasRenderingContext2D,
  cx: number,
  top: number,
  s: number,
  o: { variant: number; shirt: string; pose: Pose; t: number; phase: number; shakeX: number },
) {
  const hair = HAIR[o.variant % HAIR.length];
  const skin = SKIN[o.variant % SKIN.length];
  const shirt = o.shirt;
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

  px(10, 2, 20, 8, hair); // hair
  px(11, 6, 18, 13, skin); // head
  const eyeY = o.pose === "reading" ? 12 : 11;
  px(15, eyeY, 3, 3, "#1a1410");
  px(22, eyeY, 3, 3, "#1a1410");
  px(9, 19, 22, 15, shirt); // body
  ctx.globalAlpha = 0.5;
  px(18, 19, 4, 4, "#ffffff"); // collar
  ctx.globalAlpha = 1;

  if (o.pose === "wave") {
    px(5, 21, 4, 11, shirt);
    px(5, 31, 4, 4, skin);
    px(31, 13, 4, 9, shirt);
    const wy = Math.round(Math.sin(o.t * 6 + o.phase) * 2);
    px(31, 9 + wy, 4, 4, skin);
  } else if (o.pose === "reading") {
    px(6, 22, 4, 9, shirt);
    px(30, 22, 4, 9, shirt);
    px(9, 29, 4, 4, skin);
    px(27, 29, 4, 4, skin);
    px(12, 27, 16, 9, "#10141a"); // tablet
    ctx.globalAlpha = 0.7;
    px(13, 29, 14, 2, "#7fd4ff");
    ctx.globalAlpha = 1;
  } else if (o.pose === "running") {
    px(5, 20, 4, 9, shirt);
    px(31, 20, 4, 9, shirt);
    px(5, 27, 4, 4, skin);
    px(31, 27, 4, 4, skin);
  } else {
    // typing / idle
    px(5, 21, 4, 11, shirt);
    px(31, 21, 4, 11, shirt);
    const drop = o.pose === "typing" && Math.sin(o.t * 14 + o.phase) > 0 ? 2 : 0;
    const rest = o.pose === "idle" ? 2 : 0;
    px(5, 31 + drop + rest, 4, 4, skin);
    px(31, 31 + drop + rest, 4, 4, skin);
  }
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
    ctx.fillStyle = "#1b1f26";
    roundRect(ctx, x, y - 14, 26, 16, 5);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    roundRect(ctx, x, y - 14, 26, 16, 5);
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 5 - i * 0.9));
      ctx.fillStyle = ACTIVITY_COLOR[activity];
      ctx.beginPath();
      ctx.arc(x + 7 + i * 6, y - 6, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return;
  }
  const glyph = activity === "done" ? "✓" : "!";
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
  let str = text;
  while (str.length > 1 && ctx.measureText(str + "…").width > maxW) str = str.slice(0, -1);
  return str + "…";
}

/* ------------------------------------------------------------------ */
/* Hover / pinned tooltip (DOM overlay)                               */
/* ------------------------------------------------------------------ */

function Tooltip({
  session,
  index,
  left,
  top,
  pinned,
}: {
  session: VisualSession;
  index: number;
  left: number;
  top: number;
  pinned: boolean;
}) {
  const activity = sessionActivity(session);
  const action =
    activity === "working" && session.tool
      ? `${TOOL_WORD[session.tool]}${session.detail ? " " + session.detail : ""}`
      : null;
  return (
    <div
      className="pointer-events-none absolute z-10 w-64 -translate-x-1/2 rounded-lg border border-line bg-elevated p-3 text-xs shadow-lg"
      style={{ left, top: Math.max(top + 6, 4) }}
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
      {action && (
        <p
          className="mb-1 truncate font-mono text-[11px]"
          style={{ color: ACTIVITY_COLOR[activity] }}
        >
          ▸ {action}
        </p>
      )}
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
      {pinned && <p className="mt-1.5 text-[10px] text-faint">Click again to unpin</p>}
    </div>
  );
}
