import { describe, it, expect } from "vitest";
import {
  upsertEntry,
  removeEntry,
  setEntryStatus,
  reconcileQueue,
  pushSignature,
  filterDismissed,
  pruneDismissed,
  type PushEntry,
  type Dismissal,
} from "../repo-push-store";

const entry = (repoPath: string, over: Partial<PushEntry> = {}): PushEntry => ({
  repoPath,
  repoName: repoPath.split(/[\\/]/).pop() ?? "",
  reason: "claude-run",
  changedFiles: ["a.ts"],
  ahead: 0,
  status: "pending",
  addedAt: 1000,
  ...over,
});

describe("upsertEntry", () => {
  it("appends a new repoPath", () => {
    const list = upsertEntry([], entry("/x/a"));
    expect(list).toHaveLength(1);
  });
  it("dedups by repoPath, refreshing data but keeping original addedAt", () => {
    const list = upsertEntry([entry("/x/a", { addedAt: 1000 })], entry("/x/a", { addedAt: 2000, changedFiles: ["b.ts"] }));
    expect(list).toHaveLength(1);
    expect(list[0].addedAt).toBe(1000);
    expect(list[0].changedFiles).toEqual(["b.ts"]);
  });
});

describe("setEntryStatus", () => {
  it("changes status and message of the matching entry", () => {
    const list = setEntryStatus([entry("/x/a")], "/x/a", "error", "boom");
    expect(list[0].status).toBe("error");
    expect(list[0].message).toBe("boom");
  });
});

describe("removeEntry", () => {
  it("drops the matching repoPath", () => {
    expect(removeEntry([entry("/x/a"), entry("/x/b")], "/x/a")).toHaveLength(1);
  });
});

describe("reconcileQueue", () => {
  // Presence is driven by `scanned` (the live git truth); `persisted` only
  // overlays transient status (pushing/error) and the original addedAt.
  it("surfaces a scanned repo that is not yet persisted", () => {
    const out = reconcileQueue([], [entry("/x/a", { reason: "scan" })]);
    expect(out).toHaveLength(1);
    expect(out[0].repoPath).toBe("/x/a");
  });

  it("drops a persisted repo that is no longer dirty/ahead (not scanned)", () => {
    const out = reconcileQueue([entry("/x/a")], []);
    expect(out).toHaveLength(0);
  });

  it("preserves the original addedAt for a repo present in both", () => {
    const out = reconcileQueue(
      [entry("/x/a", { addedAt: 1000 })],
      [entry("/x/a", { addedAt: 9999 })],
    );
    expect(out[0].addedAt).toBe(1000);
  });

  it("refreshes changedFiles/ahead from the scan when persisted status is pending", () => {
    const out = reconcileQueue(
      [entry("/x/a", { changedFiles: ["old.ts"], ahead: 0 })],
      [entry("/x/a", { changedFiles: ["new.ts"], ahead: 2 })],
    );
    expect(out[0].changedFiles).toEqual(["new.ts"]);
    expect(out[0].ahead).toBe(2);
    expect(out[0].status).toBe("pending");
  });

  it("keeps a transient pushing/error status (and message) over a fresh pending", () => {
    const out = reconcileQueue(
      [entry("/x/a", { status: "error", message: "boom" })],
      [entry("/x/a", { status: "pending" })],
    );
    expect(out[0].status).toBe("error");
    expect(out[0].message).toBe("boom");
  });
});

describe("pushSignature", () => {
  it("is stable regardless of changedFiles order", () => {
    const a = pushSignature({ changedFiles: ["a.ts", "b.ts"], ahead: 1 });
    const b = pushSignature({ changedFiles: ["b.ts", "a.ts"], ahead: 1 });
    expect(a).toBe(b);
  });
  it("changes when the change-set changes", () => {
    const a = pushSignature({ changedFiles: ["a.ts"], ahead: 0 });
    const b = pushSignature({ changedFiles: ["a.ts", "c.ts"], ahead: 0 });
    const c = pushSignature({ changedFiles: ["a.ts"], ahead: 2 });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("filterDismissed", () => {
  const sig = (e: PushEntry) => pushSignature(e);
  it("hides an entry whose repoPath + signature was dismissed", () => {
    const e = entry("/x/a", { changedFiles: ["a.ts"], ahead: 0 });
    const dismissed: Dismissal[] = [{ repoPath: "/x/a", signature: sig(e) }];
    expect(filterDismissed([e], dismissed)).toHaveLength(0);
  });
  it("shows the repo again once its change-set differs from the dismissal", () => {
    const dismissedEntry = entry("/x/a", { changedFiles: ["a.ts"], ahead: 0 });
    const dismissed: Dismissal[] = [
      { repoPath: "/x/a", signature: sig(dismissedEntry) },
    ];
    const changedAgain = entry("/x/a", { changedFiles: ["a.ts", "new.ts"], ahead: 0 });
    expect(filterDismissed([changedAgain], dismissed)).toHaveLength(1);
  });
  it("leaves non-dismissed entries untouched", () => {
    const e = entry("/x/b");
    expect(filterDismissed([e], [{ repoPath: "/x/a", signature: "zzz" }])).toHaveLength(1);
  });
});

describe("pruneDismissed", () => {
  it("keeps a dismissal that still matches a current entry", () => {
    const e = entry("/x/a", { changedFiles: ["a.ts"], ahead: 0 });
    const dismissed: Dismissal[] = [{ repoPath: "/x/a", signature: pushSignature(e) }];
    expect(pruneDismissed(dismissed, [e])).toHaveLength(1);
  });
  it("drops a stale dismissal whose repo is clean or changed", () => {
    const dismissed: Dismissal[] = [{ repoPath: "/x/a", signature: "old-sig" }];
    expect(pruneDismissed(dismissed, [])).toHaveLength(0);
  });
});
