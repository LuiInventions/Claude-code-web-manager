import { describe, it, expect } from "vitest";
import { detectStackFromFiles, frameworksFromPackageJson } from "../stack-detect";

describe("detectStackFromFiles", () => {
  it("detects Node.js from package.json", () => {
    const r = detectStackFromFiles(["package.json", "tsconfig.json", "README.md"]);
    expect(r.primary).toBe("Node.js");
    expect(r.tags).toContain("Node");
  });
  it("detects Python", () => {
    expect(detectStackFromFiles(["requirements.txt"]).primary).toBe("Python");
    expect(detectStackFromFiles(["pyproject.toml"]).primary).toBe("Python");
  });
  it("detects Go and Rust", () => {
    expect(detectStackFromFiles(["go.mod", "main.go"]).primary).toBe("Go");
    expect(detectStackFromFiles(["Cargo.toml"]).primary).toBe("Rust");
  });
  it("detects .NET from a csproj file", () => {
    expect(detectStackFromFiles(["App.csproj"]).primary).toBe(".NET");
  });
  it("prefers the more specific ecosystem when several are present", () => {
    const r = detectStackFromFiles(["go.mod", "package.json"]);
    expect(r.primary).toBe("Go");
    expect(r.tags).toEqual(expect.arrayContaining(["Go", "Node"]));
  });
  it("adds a Docker tag", () => {
    expect(detectStackFromFiles(["package.json", "Dockerfile"]).tags).toContain("Docker");
  });
  it("returns Unknown for an unrecognised folder", () => {
    expect(detectStackFromFiles(["notes.txt", "photo.png"]).primary).toBe("Unknown");
  });
});

describe("frameworksFromPackageJson", () => {
  it("extracts framework tags from dependencies", () => {
    const tags = frameworksFromPackageJson({
      dependencies: { next: "16", react: "19" },
      devDependencies: { tailwindcss: "4" },
    });
    expect(tags).toEqual(expect.arrayContaining(["Next.js", "React", "Tailwind"]));
  });
  it("handles missing/invalid input", () => {
    expect(frameworksFromPackageJson(null)).toEqual([]);
    expect(frameworksFromPackageJson({})).toEqual([]);
  });
});
