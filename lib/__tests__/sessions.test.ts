import { describe, expect, it } from "vitest";
import {
  avatarIndex,
  CHARACTER_COLORS,
  groupByBatch,
  hashId,
  sessionColor,
  statusActivity,
  type VisualSession,
} from "../sessions";

function s(partial: Partial<VisualSession> & { id: string }): VisualSession {
  return {
    projectName: "proj",
    prompt: "do a thing",
    status: "running",
    startedAt: 0,
    ...partial,
  };
}

describe("sessions visual helpers", () => {
  it("hashId is deterministic and non-negative", () => {
    expect(hashId("abc")).toBe(hashId("abc"));
    expect(hashId("abc")).toBeGreaterThanOrEqual(0);
    expect(hashId("abc")).not.toBe(hashId("abd"));
  });

  it("avatarIndex is stable and within range", () => {
    for (const id of ["c_a1", "c_zz9", "session-x", ""]) {
      const i = avatarIndex(id, CHARACTER_COLORS.length);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(CHARACTER_COLORS.length);
      expect(avatarIndex(id, CHARACTER_COLORS.length)).toBe(i); // stable
    }
    expect(avatarIndex("x", 0)).toBe(0); // guards count<=0
  });

  it("sessionColor returns a palette colour", () => {
    expect(CHARACTER_COLORS).toContain(sessionColor("c_123"));
  });

  it("statusActivity maps status to activity", () => {
    expect(statusActivity("running")).toBe("working");
    expect(statusActivity("done")).toBe("done");
    expect(statusActivity("error")).toBe("error");
  });

  it("groupByBatch groups KI-Modus batches and keeps singletons separate", () => {
    const groups = groupByBatch([
      s({ id: "a", batchId: "b1" }),
      s({ id: "b", batchId: "b1" }),
      s({ id: "c" }), // no batch -> singleton
      s({ id: "d", batchId: "b2" }), // lone batch member -> not a batch hub
    ]);
    expect(groups).toHaveLength(3);
    const batch = groups.find((g) => g.key === "b:b1")!;
    expect(batch.isBatch).toBe(true);
    expect(batch.sessions.map((x) => x.id)).toEqual(["a", "b"]);
    const single = groups.find((g) => g.key === "s:c")!;
    expect(single.isBatch).toBe(false);
    const lone = groups.find((g) => g.key === "b:b2")!;
    expect(lone.isBatch).toBe(false); // a batch with one member is not a hub
  });

  it("groupByBatch preserves first-seen order", () => {
    const groups = groupByBatch([s({ id: "z" }), s({ id: "y" }), s({ id: "x" })]);
    expect(groups.map((g) => g.key)).toEqual(["s:z", "s:y", "s:x"]);
  });
});
