import { describe, it, expect } from "vitest";
import {
  parseGitLog,
  parseAheadBehind,
  buildAuthHeaderArg,
  parsePorcelainStatus,
  parseDiffNameStatus,
} from "../git";

const US = "\x1f"; // field separator used in the git pretty-format

describe("parseGitLog", () => {
  it("parses unit-separated commit lines", () => {
    const raw = [
      ["a1b2c3d", "fix: handle empty input", "2 hours ago", "Luis"].join(US),
      ["e4f5g6h", "feat: add scanner", "3 days ago", "Luis"].join(US),
    ].join("\n");
    const commits = parseGitLog(raw);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({
      hash: "a1b2c3d",
      subject: "fix: handle empty input",
      relTime: "2 hours ago",
      author: "Luis",
    });
  });
  it("handles subjects containing spaces and colons", () => {
    const commits = parseGitLog(["h", "fix: a: b c", "now", "X"].join(US));
    expect(commits[0].subject).toBe("fix: a: b c");
  });
  it("returns [] for empty input", () => {
    expect(parseGitLog("")).toEqual([]);
  });
});

describe("parseAheadBehind", () => {
  it("parses left-right counts", () => {
    expect(parseAheadBehind("2\t1")).toEqual({ ahead: 2, behind: 1 });
    expect(parseAheadBehind("0 0")).toEqual({ ahead: 0, behind: 0 });
  });
  it("defaults to zero on null", () => {
    expect(parseAheadBehind(null)).toEqual({ ahead: 0, behind: 0 });
  });
});

describe("parsePorcelainStatus", () => {
  it("parses status codes into normalized entries", () => {
    const raw = [" M src/a.ts", "A  src/b.ts", " D src/c.ts", "?? new.txt"].join("\n");
    expect(parsePorcelainStatus(raw)).toEqual([
      { path: "src/a.ts", status: "M" },
      { path: "src/b.ts", status: "A" },
      { path: "src/c.ts", status: "D" },
      { path: "new.txt", status: "?" },
    ]);
  });
  it("reports renames under their new path", () => {
    expect(parsePorcelainStatus("R  old/name.ts -> new/name.ts")).toEqual([
      { path: "new/name.ts", status: "R" },
    ]);
  });
  it("returns [] for empty input", () => {
    expect(parsePorcelainStatus("")).toEqual([]);
  });
});

describe("parseDiffNameStatus", () => {
  it("parses tab-separated name-status lines", () => {
    const raw = ["M\tsrc/a.ts", "A\tsrc/b.ts", "D\tsrc/c.ts"].join("\n");
    expect(parseDiffNameStatus(raw)).toEqual([
      { path: "src/a.ts", status: "M" },
      { path: "src/b.ts", status: "A" },
      { path: "src/c.ts", status: "D" },
    ]);
  });
  it("reports renames under the new path", () => {
    expect(parseDiffNameStatus("R100\told.ts\tnew.ts")).toEqual([
      { path: "new.ts", status: "R" },
    ]);
  });
  it("returns [] for empty input", () => {
    expect(parseDiffNameStatus("")).toEqual([]);
  });
});

describe("buildAuthHeaderArg", () => {
  it("base64-encodes x-access-token:<token> as a basic auth extraheader", () => {
    const args = buildAuthHeaderArg("ghp_secret");
    const expected = Buffer.from("x-access-token:ghp_secret").toString("base64");
    expect(args).toEqual(["-c", `http.extraheader=AUTHORIZATION: basic ${expected}`]);
  });
});
