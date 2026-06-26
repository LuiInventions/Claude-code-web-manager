import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLevel,
  getVoiceState,
  setLevel,
  setVoiceState,
  subscribe,
} from "../voice-bus";

afterEach(() => setVoiceState("idle"));

describe("voice-bus", () => {
  it("clamps level into [0,1] and coerces non-finite to 0", () => {
    setLevel(0.42);
    expect(getLevel()).toBeCloseTo(0.42);
    setLevel(5);
    expect(getLevel()).toBe(1);
    setLevel(-3);
    expect(getLevel()).toBe(0);
    setLevel(Number.NaN);
    expect(getLevel()).toBe(0);
  });

  it("stores and reports state", () => {
    setVoiceState("listening");
    expect(getVoiceState()).toBe("listening");
  });

  it("notifies subscribers only on change and supports unsubscribe", () => {
    const fn = vi.fn();
    setVoiceState("idle");
    const off = subscribe(fn);
    setVoiceState("speaking");
    setVoiceState("speaking"); // unchanged → no emit
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("speaking");
    off();
    setVoiceState("idle");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
