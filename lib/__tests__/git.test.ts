import { describe, it, expect } from "vitest";
import { parseGitLog, parseAheadBehind, buildAuthHeaderArg } from "../git";

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

describe("buildAuthHeaderArg", () => {
  it("base64-encodes x-access-token:<token> as a basic auth extraheader", () => {
    const args = buildAuthHeaderArg("ghp_secret");
    const expected = Buffer.from("x-access-token:ghp_secret").toString("base64");
    expect(args).toEqual(["-c", `http.extraheader=AUTHORIZATION: basic ${expected}`]);
  });
});
