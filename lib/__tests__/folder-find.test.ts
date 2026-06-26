import { describe, it, expect } from "vitest";
import { scoreFolder, tokenize, type FindOpts } from "../folder-find";

const NAME_ONLY: FindOpts = { matchPath: false, requireAll: true };
const PATH_ANY: FindOpts = { matchPath: true, requireAll: false };

describe("tokenize", () => {
  it("lowercases, splits on whitespace, strips punctuation", () => {
    expect(tokenize("Fake Check!")).toEqual(["fake", "check"]);
    expect(tokenize("  tiktok-insta  ")).toEqual(["tiktok-insta"]);
  });
  it("returns [] for empty input", () => {
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("scoreFolder", () => {
  it("scores a name match higher than a path-only match", () => {
    const nameHit = scoreFolder("tiktok", "c:\\users\\x\\tiktok", ["tiktok"], PATH_ANY);
    const pathHit = scoreFolder("downloads", "c:\\users\\tiktok\\downloads", ["tiktok"], PATH_ANY);
    expect(nameHit).toBeGreaterThan(pathHit);
  });
  it("gives an exact single-token name match a strong bonus", () => {
    const exact = scoreFolder("fake", "c:\\fake", ["fake"], NAME_ONLY);
    const partial = scoreFolder("fakecheck", "c:\\fakecheck", ["fake"], NAME_ONLY);
    expect(exact).toBeGreaterThan(partial);
  });
  it("requireAll rejects folders matching only some tokens", () => {
    expect(scoreFolder("fake", "c:\\fake", ["fake", "check"], NAME_ONLY)).toBe(0);
    expect(scoreFolder("fakecheck", "c:\\fakecheck", ["fake", "check"], NAME_ONLY)).toBeGreaterThan(0);
  });
  it("OR mode accepts a folder matching any token", () => {
    expect(scoreFolder("fake", "c:\\fake", ["fake", "check"], PATH_ANY)).toBeGreaterThan(0);
  });
  it("returns 0 when nothing matches", () => {
    expect(scoreFolder("docs", "c:\\docs", ["tiktok"], PATH_ANY)).toBe(0);
  });
  it("does not match the path in name-only mode", () => {
    expect(scoreFolder("downloads", "c:\\tiktok\\downloads", ["tiktok"], NAME_ONLY)).toBe(0);
  });
});
