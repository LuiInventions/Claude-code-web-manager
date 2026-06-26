"use client";

/** Global synthesized sound-effects (no asset files). All calls are no-ops
 *  when muted or when Web Audio is unavailable (e.g. SSR / node tests). */

export type Sfx =
  | "tap"
  | "open"
  | "close"
  | "listenStart"
  | "listenStop"
  | "send"
  | "done"
  | "error";

const MUTE_KEY = "jarvis.sfx.muted";

let ctx: AudioContext | null = null;
let muted = readMuted();
let lastTap = 0;

function readMuted(): boolean {
  try {
    return globalThis.localStorage?.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    globalThis.localStorage?.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Resume/create the shared context on a user gesture. */
export function resume(): void {
  getCtx();
}

interface Tone {
  type: OscillatorType;
  from: number;
  to: number;
  dur: number;
  gain: number;
}

const TONES: Record<Sfx, Tone> = {
  tap: { type: "triangle", from: 660, to: 660, dur: 0.05, gain: 0.03 },
  open: { type: "sawtooth", from: 420, to: 880, dur: 0.22, gain: 0.055 },
  close: { type: "sawtooth", from: 700, to: 320, dur: 0.18, gain: 0.05 },
  listenStart: { type: "sine", from: 520, to: 880, dur: 0.16, gain: 0.06 },
  listenStop: { type: "sine", from: 700, to: 440, dur: 0.14, gain: 0.05 },
  send: { type: "triangle", from: 600, to: 1040, dur: 0.12, gain: 0.05 },
  done: { type: "sine", from: 880, to: 520, dur: 0.2, gain: 0.06 },
  error: { type: "square", from: 320, to: 180, dur: 0.26, gain: 0.05 },
};

function jitter(n: number, amt = 0.04): number {
  return n * (1 + (Math.random() * 2 - 1) * amt);
}

export function play(name: Sfx): void {
  if (muted) return;
  if (name === "tap") {
    const now = typeof performance !== "undefined" ? performance.now() : 0;
    if (now - lastTap < 60) return;
    lastTap = now;
  }
  const c = getCtx();
  if (!c) return;
  const tone = TONES[name];
  const t = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = tone.type;
  osc.frequency.setValueAtTime(jitter(tone.from), t);
  osc.frequency.exponentialRampToValueAtTime(jitter(tone.to), t + tone.dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(tone.gain, t + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + tone.dur);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(t);
  osc.stop(t + tone.dur + 0.02);
}
