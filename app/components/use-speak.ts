"use client";

import { useCallback, useRef, useState } from "react";
import { isMuted, play } from "@/lib/sfx";

/**
 * Minimal TTS playback for the Session-Review readout. Extracted from the old
 * JarvisSection.speak(): POST text to /api/voice/tts, decode the returned audio
 * and play it through a shared AudioContext. No level visualization. Honors the
 * global mute. `speak` resolves once playback has STARTED (not ended); it throws
 * on network/synthesis errors so the caller can surface them.
 */
export function useSpeak() {
  const ctxRef = useRef<AudioContext | null>(null);
  const srcRef = useRef<AudioBufferSourceNode | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const stop = useCallback(() => {
    try {
      srcRef.current?.stop();
    } catch {
      /* already stopped */
    }
    srcRef.current = null;
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t || isMuted()) return;
      const r = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: t }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!ctxRef.current) ctxRef.current = new Ctor();
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") await ctx.resume();
      const buf = await ctx.decodeAudioData(await r.arrayBuffer());
      stop();
      const node = ctx.createBufferSource();
      node.buffer = buf;
      node.connect(ctx.destination);
      srcRef.current = node;
      node.onended = () => {
        srcRef.current = null;
        setSpeaking(false);
        play("done");
      };
      setSpeaking(true);
      node.start();
    },
    [stop],
  );

  return { speak, stop, speaking };
}
