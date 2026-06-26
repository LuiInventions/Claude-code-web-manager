import { describe, it, expect } from "vitest";
import {
  numberInstances,
  instanceNumber,
  type WindowInstance,
} from "../window-instances";

function inst(
  id: string,
  createdAt: number,
  extra: Partial<WindowInstance> = {},
): WindowInstance {
  return { id, kind: "claude", label: id, createdAt, ...extra };
}

describe("numberInstances", () => {
  it("numbers by age (oldest = 1) regardless of array order", () => {
    // Passed newest-first, as the launcher keeps its session list.
    const list = [inst("c", 300), inst("b", 200), inst("a", 100)];
    const numbered = numberInstances(list);
    const byId = Object.fromEntries(numbered.map((n) => [n.instance.id, n.number]));
    expect(byId).toEqual({ a: 1, b: 2, c: 3 });
  });

  it("preserves the input order in the result", () => {
    const list = [inst("c", 300), inst("a", 100), inst("b", 200)];
    expect(numberInstances(list).map((n) => n.instance.id)).toEqual(["c", "a", "b"]);
  });

  it("keeps existing numbers stable when a newer instance is prepended", () => {
    const before = numberInstances([inst("b", 200), inst("a", 100)]);
    const after = numberInstances([inst("c", 300), inst("b", 200), inst("a", 100)]);
    const numFor = (set: typeof before, id: string) =>
      set.find((n) => n.instance.id === id)!.number;
    expect(numFor(before, "a")).toBe(numFor(after, "a")); // 1 → 1
    expect(numFor(before, "b")).toBe(numFor(after, "b")); // 2 → 2
    expect(numFor(after, "c")).toBe(3);
  });

  it("breaks createdAt ties deterministically by id", () => {
    const numbered = numberInstances([inst("y", 100), inst("x", 100)]);
    const byId = Object.fromEntries(numbered.map((n) => [n.instance.id, n.number]));
    expect(byId).toEqual({ x: 1, y: 2 });
  });

  it("assigns unique numbers across the whole set", () => {
    const list = [inst("a", 1), inst("b", 2), inst("c", 3), inst("d", 4)];
    const nums = numberInstances(list).map((n) => n.number).sort();
    expect(nums).toEqual([1, 2, 3, 4]);
  });

  it("returns an empty array for no instances", () => {
    expect(numberInstances([])).toEqual([]);
  });
});

describe("instanceNumber", () => {
  const list = [inst("c", 300), inst("b", 200), inst("a", 100)];

  it("returns the stable number for a known id", () => {
    expect(instanceNumber(list, "a")).toBe(1);
    expect(instanceNumber(list, "c")).toBe(3);
  });

  it("returns 0 for an unknown id", () => {
    expect(instanceNumber(list, "missing")).toBe(0);
  });
});
