import { describe, expect, it } from "vitest";
import { assignSessionNames, SESSION_NAMES, sessionPlace } from "../session-names";

describe("session names", () => {
  it("gives every live session its own name", () => {
    const ids = Array.from({ length: 24 }, (_, i) => `session-${i}`);
    const names = [...assignSessionNames(ids).values()];
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(SESSION_NAMES).toContain(name);
  });

  it("keeps the same name for the same id", () => {
    const once = assignSessionNames(["a", "b"]);
    const twice = assignSessionNames(["a", "b"]);
    expect(twice.get("a")).toBe(once.get("a"));
    expect(twice.get("b")).toBe(once.get("b"));
  });

  it("reads github, local, and server from the session", () => {
    expect(sessionPlace({ origin: "github" })).toBe("github");
    expect(sessionPlace({ where: "remote", origin: "github" })).toBe("server");
    expect(sessionPlace({})).toBe("local");
  });
});
