import { describe, it, expect } from "vitest";
import {
  setRepoStatus,
  setRepoPrivate,
  addOrReplaceRepo,
  findRepoPath,
  type StoredRepo,
} from "../github-store";

const repo = (fullName: string): StoredRepo => ({
  name: fullName.split("/")[1],
  fullName,
  cloneUrl: `https://github.com/${fullName}.git`,
  private: false,
  description: null,
  defaultBranch: "main",
  updatedAt: "",
  cloneStatus: "pending",
  localPath: "",
});

describe("setRepoStatus", () => {
  it("updates only the matching repo's cloneStatus", () => {
    const repos = [repo("u/a"), repo("u/b")];
    const next = setRepoStatus(repos, "u/b", "cloned");
    expect(next.find((r) => r.fullName === "u/b")?.cloneStatus).toBe("cloned");
    expect(next.find((r) => r.fullName === "u/a")?.cloneStatus).toBe("pending");
  });
  it("returns a new array (no mutation)", () => {
    const repos = [repo("u/a")];
    const next = setRepoStatus(repos, "u/a", "error");
    expect(next).not.toBe(repos);
    expect(repos[0].cloneStatus).toBe("pending");
  });
});

describe("setRepoPrivate", () => {
  it("flips only the matching repo's private flag", () => {
    const repos = [repo("u/a"), repo("u/b")];
    const next = setRepoPrivate(repos, "u/b", true);
    expect(next.find((r) => r.fullName === "u/b")?.private).toBe(true);
    expect(next.find((r) => r.fullName === "u/a")?.private).toBe(false);
  });
  it("does not mutate the input", () => {
    const repos = [repo("u/a")];
    setRepoPrivate(repos, "u/a", true);
    expect(repos[0].private).toBe(false);
  });
});

describe("addOrReplaceRepo", () => {
  it("prepends a brand-new repo (newest first)", () => {
    const repos = [repo("u/a")];
    const next = addOrReplaceRepo(repos, repo("u/new"));
    expect(next.map((r) => r.fullName)).toEqual(["u/new", "u/a"]);
  });
  it("replaces an existing repo in place without growing the list", () => {
    const repos = [repo("u/a"), repo("u/b")];
    const updated = { ...repo("u/b"), private: true };
    const next = addOrReplaceRepo(repos, updated);
    expect(next).toHaveLength(2);
    expect(next.find((r) => r.fullName === "u/b")?.private).toBe(true);
  });
});

describe("findRepoPath", () => {
  const repos = [
    { ...repo("octo/a"), localPath: "C:/repos/a" },
    { ...repo("octo/b"), localPath: "C:/repos/b" },
  ];
  it("returns the localPath for a known fullName", () => {
    expect(findRepoPath(repos, "octo/b")).toBe("C:/repos/b");
  });
  it("returns null for an unknown fullName", () => {
    expect(findRepoPath(repos, "octo/zzz")).toBeNull();
  });
});
