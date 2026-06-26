import { describe, it, expect } from "vitest";
import {
  detectLanguage,
  isProbablyBinary,
  formatBytes,
  sortEntries,
  type FsEntry,
} from "../fs-explorer";

describe("detectLanguage", () => {
  it("maps known extensions", () => {
    expect(detectLanguage("index.ts")).toBe("typescript");
    expect(detectLanguage("app.tsx")).toBe("typescript");
    expect(detectLanguage("script.py")).toBe("python");
    expect(detectLanguage("main.go")).toBe("go");
    expect(detectLanguage("build.ps1")).toBe("powershell");
  });
  it("recognises Dockerfile by name", () => {
    expect(detectLanguage("Dockerfile")).toBe("dockerfile");
  });
  it("falls back to plaintext", () => {
    expect(detectLanguage("notes.unknownext")).toBe("plaintext");
    expect(detectLanguage("noextension")).toBe("plaintext");
  });
});

describe("isProbablyBinary", () => {
  it("flags a null byte as binary", () => {
    expect(isProbablyBinary(Buffer.from([65, 0, 66]))).toBe(true);
  });
  it("treats UTF-8 source as text", () => {
    expect(
      isProbablyBinary(Buffer.from("const x = 1;\nconsole.log(x);\n", "utf8")),
    ).toBe(false);
  });
  it("treats empty buffer as text", () => {
    expect(isProbablyBinary(Buffer.alloc(0))).toBe(false);
  });
});

describe("formatBytes", () => {
  it("formats sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });
  it("returns empty for null", () => {
    expect(formatBytes(null)).toBe("");
  });
});

describe("sortEntries", () => {
  const mk = (type: "dir" | "file", name: string): FsEntry => ({
    name,
    path: name,
    type,
    size: null,
    mtimeMs: null,
    hidden: false,
  });
  it("orders directories before files", () => {
    expect(sortEntries(mk("file", "a"), mk("dir", "z"))).toBeGreaterThan(0);
    expect(sortEntries(mk("dir", "z"), mk("file", "a"))).toBeLessThan(0);
  });
  it("orders same-type entries alphabetically (numeric-aware)", () => {
    expect(sortEntries(mk("file", "a2.txt"), mk("file", "a10.txt"))).toBeLessThan(0);
  });
});
