import { beforeEach, describe, expect, it } from "vitest";
import { isMuted, play, setMuted } from "../sfx";

class FakeStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: FakeStorage }).localStorage =
    new FakeStorage();
  setMuted(false);
});

describe("sfx", () => {
  it("persists mute state to localStorage", () => {
    setMuted(true);
    expect(isMuted()).toBe(true);
    expect(globalThis.localStorage.getItem("jarvis.sfx.muted")).toBe("1");
    setMuted(false);
    expect(isMuted()).toBe(false);
    expect(globalThis.localStorage.getItem("jarvis.sfx.muted")).toBe("0");
  });

  it("play() is a safe no-op without an AudioContext (node)", () => {
    expect(() => play("tap")).not.toThrow();
    setMuted(true);
    expect(() => play("open")).not.toThrow();
  });
});
