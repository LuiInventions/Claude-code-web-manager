"use client";

import { sessionColor, statusActivity, type Activity, type VisualSession } from "@/lib/sessions";

/**
 * Pixel-office view — a homage to pixel-agents
 * (https://github.com/pixel-agents-hq/pixel-agents). Every live launcher
 * session becomes its own animated pixel character at a desk: the character
 * types while the session is running, sits calmly when done, and flags red on
 * error. New sessions appear automatically as the Sessions tab polls.
 */
export default function PixelOfficeView({ sessions }: { sessions: VisualSession[] }) {
  return (
    <div className="pixel-office min-h-full w-full p-6">
      <style>{KEYFRAMES}</style>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-5">
        {sessions.map((s, i) => (
          <Workstation key={s.id} session={s} index={i + 1} />
        ))}
      </div>
    </div>
  );
}

function Workstation({ session, index }: { session: VisualSession; index: number }) {
  const color = sessionColor(session.id);
  const activity = statusActivity(session.status);
  const title = session.projectName?.trim() || "session";

  return (
    <div
      className="group relative flex flex-col items-center rounded-lg border border-line bg-raised/60 px-3 pb-3 pt-4"
      title={`${title}\n${session.prompt}`}
    >
      <StatusBubble activity={activity} />
      <Character color={color} activity={activity} />
      {/* desk */}
      <div className="mt-1 h-2 w-[88%] rounded-sm bg-[#3a3326]" />
      <div className="h-1 w-[70%] rounded-b-sm bg-[#2a2622]" />

      <div className="mt-2 flex w-full items-center gap-1.5">
        <span
          className="grid size-5 shrink-0 place-items-center rounded text-[10px] font-bold text-black"
          style={{ background: color }}
        >
          {index}
        </span>
        <span className="truncate text-xs font-medium text-ink">{title}</span>
      </div>
      <div className="mt-0.5 flex w-full items-center gap-1.5">
        <span
          className={
            "inline-block size-1.5 rounded-full " +
            (activity === "working"
              ? "bg-running dot-running"
              : activity === "error"
                ? "bg-danger"
                : "bg-muted")
          }
        />
        <span className="truncate text-[11px] capitalize text-faint">
          {activity}
          {session.model ? ` · ${session.model}` : ""}
        </span>
      </div>
    </div>
  );
}

function StatusBubble({ activity }: { activity: Activity }) {
  if (activity === "working") {
    return (
      <div className="absolute -top-1 right-2 flex items-center gap-0.5 rounded-md border border-line bg-elevated px-1.5 py-1">
        {[0, 1, 2].map((d) => (
          <span
            key={d}
            className="size-1 rounded-full bg-running"
            style={{ animation: `ccc-dot 1s ${d * 0.18}s infinite` }}
          />
        ))}
      </div>
    );
  }
  const label = activity === "error" ? "!" : "✓";
  const tone =
    activity === "error" ? "text-danger border-danger/50" : "text-running border-running/50";
  return (
    <div
      className={`absolute -top-1 right-2 grid size-5 place-items-center rounded-md border bg-elevated text-xs font-bold ${tone}`}
    >
      {label}
    </div>
  );
}

/** A small front-facing pixel character built from crisp rects. */
function Character({ color, activity }: { color: string; activity: Activity }) {
  const skin = "#f0c8a0";
  const hair = "#3a2a22";
  const anim =
    activity === "working"
      ? "ccc-bob 0.9s ease-in-out infinite"
      : activity === "error"
        ? "ccc-shake 0.4s ease-in-out infinite"
        : "ccc-idle 3s ease-in-out infinite";
  const handAnim = activity === "working" ? "ccc-type 0.32s steps(2) infinite" : "none";

  return (
    <svg
      width="76"
      height="76"
      viewBox="0 0 40 44"
      style={{ imageRendering: "pixelated", shapeRendering: "crispEdges", animation: anim }}
      aria-hidden="true"
    >
      {/* hair */}
      <rect x="10" y="2" width="20" height="8" fill={hair} />
      {/* head */}
      <rect x="11" y="6" width="18" height="13" fill={skin} />
      {/* eyes */}
      <rect x="15" y="11" width="3" height="3" fill="#1a1410" />
      <rect x="22" y="11" width="3" height="3" fill="#1a1410" />
      {/* body / shirt */}
      <rect x="9" y="19" width="22" height="15" fill={color} />
      {/* collar accent */}
      <rect x="18" y="19" width="4" height="4" fill="#ffffff" opacity="0.5" />
      {/* arms */}
      <rect x="5" y="21" width="4" height="11" fill={color} />
      <rect x="31" y="21" width="4" height="11" fill={color} />
      {/* hands (type) */}
      <g style={{ animation: handAnim, transformOrigin: "center" }}>
        <rect x="5" y="31" width="4" height="4" fill={skin} />
        <rect x="31" y="31" width="4" height="4" fill={skin} />
      </g>
      {/* keyboard */}
      <rect x="7" y="35" width="26" height="4" fill="#26211b" />
      <rect x="9" y="36" width="22" height="1" fill="#4a4036" />
    </svg>
  );
}

const KEYFRAMES = `
@keyframes ccc-bob { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-2px)} }
@keyframes ccc-idle { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-1px)} }
@keyframes ccc-shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-1.5px)} 75%{transform:translateX(1.5px)} }
@keyframes ccc-type { 0%{transform:translateY(0)} 100%{transform:translateY(2px)} }
@keyframes ccc-dot { 0%,100%{opacity:0.25} 50%{opacity:1} }
`;
