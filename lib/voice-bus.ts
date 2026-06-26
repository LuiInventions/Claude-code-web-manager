"use client";

/**
 * Imperative singleton for live voice activity. `level` is updated every
 * animation frame and read by the mic button and header beam WITHOUT going
 * through React state (avoids re-render storms). `state` changes are rare and
 * fan out to subscribers.
 */

export type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "error";

type Listener = (state: VoiceState) => void;

let level = 0;
let state: VoiceState = "idle";
const listeners = new Set<Listener>();

export function setLevel(n: number): void {
  level = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

export function getLevel(): number {
  return level;
}

export function setVoiceState(next: VoiceState): void {
  if (next === state) return;
  state = next;
  for (const fn of listeners) fn(state);
}

export function getVoiceState(): VoiceState {
  return state;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
