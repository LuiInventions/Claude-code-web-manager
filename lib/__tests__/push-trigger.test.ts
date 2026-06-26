import { describe, it, expect } from "vitest";
import { shouldEnqueuePush } from "../../lib/server/claude-runner";

describe("shouldEnqueuePush", () => {
  it("enqueues a github repo that is dirty", () => {
    expect(shouldEnqueuePush("github", { dirty: true, ahead: 0 })).toBe(true);
  });
  it("enqueues a github repo with unpushed commits", () => {
    expect(shouldEnqueuePush("github", { dirty: false, ahead: 2 })).toBe(true);
  });
  it("does not enqueue a clean github repo", () => {
    expect(shouldEnqueuePush("github", { dirty: false, ahead: 0 })).toBe(false);
  });
  it("never enqueues a non-github run", () => {
    expect(shouldEnqueuePush(undefined, { dirty: true, ahead: 9 })).toBe(false);
  });
});
