"use client";

import { useEffect, useRef } from "react";
import {
  getLevel,
  getVoiceState,
  subscribe,
  type VoiceState,
} from "@/lib/voice-bus";
import { cn } from "./ui";

const BARS = 32;

/** Blue audio beam that reacts to voice-bus level while listening/speaking. */
export function VoiceBeam({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const phaseRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const isActive = (s: VoiceState) => s === "listening" || s === "speaking";

    const render = (animate: boolean) => {
      const w = canvas.width;
      const h = canvas.height;
      const mid = h / 2;
      ctx.clearRect(0, 0, w, h);

      const lvl = getLevel();
      const speaking = getVoiceState() === "speaking";
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, "rgba(56,189,248,0.10)");
      grad.addColorStop(0.5, speaking ? "#38bdf8" : "#60a5fa");
      grad.addColorStop(1, "rgba(56,189,248,0.10)");
      ctx.fillStyle = grad;

      if (animate) phaseRef.current += 0.3;
      const gap = w / BARS;
      for (let i = 0; i < BARS; i++) {
        const env = Math.sin((i / (BARS - 1)) * Math.PI); // taper edges
        const wave = animate
          ? 0.5 + 0.5 * Math.sin(phaseRef.current * 0.4 + i * 0.6)
          : 1;
        const amp = Math.max(1.5, env * (3 + lvl * (mid - 3) * 1.8 * wave));
        const x = i * gap + gap * 0.3;
        ctx.fillRect(x, mid - amp, gap * 0.4, amp * 2);
      }
    };

    const loop = () => {
      render(true);
      rafRef.current = requestAnimationFrame(loop);
    };

    const stop = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };

    const sync = (s: VoiceState) => {
      if (!isActive(s)) {
        stop();
        return;
      }
      if (reduced) {
        render(false); // static, level-driven only — no rAF
        return;
      }
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(loop);
    };

    sync(getVoiceState());
    const unsub = subscribe(sync);
    return () => {
      unsub();
      stop();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={240}
      height={36}
      className={cn("h-9 w-[240px]", className)}
      aria-hidden="true"
    />
  );
}
