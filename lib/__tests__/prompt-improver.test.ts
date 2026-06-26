import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildContextFromDisk } from "../prompt-improver";

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "improver-test-"));
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "demo-app",
      version: "1.2.3",
      scripts: { dev: "next dev", build: "next build" },
      dependencies: { next: "^15.0.0", react: "^19.0.0" },
    }),
  );
  await fs.writeFile(path.join(dir, "README.md"), "# Demo\nEin Testprojekt.");
  await fs.mkdir(path.join(dir, "src"));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("buildContextFromDisk", () => {
  it("derives stack + frameworks + manifest from a real project on disk", async () => {
    const ctx = await buildContextFromDisk(dir);
    expect(ctx.source).toBe("disk");
    expect(ctx.name).toBe(path.basename(dir));
    const stack = ctx.stack as { primary: string; tags: string[] };
    expect(stack.primary).toBe("Node.js");
    expect(stack.tags).toContain("Next.js");
    const manifest = ctx.manifest as { name: string; dependencies: string[] };
    expect(manifest.name).toBe("demo-app");
    expect(manifest.dependencies).toContain("next");
    expect(ctx.readme).toContain("Demo");
    expect(ctx.tree).toContain("[dir] src");
  });

  it("degrades gracefully for a non-existent path", async () => {
    const ctx = await buildContextFromDisk(path.join(dir, "does-not-exist"));
    expect(ctx.source).toBe("disk");
    expect(ctx.note).toBeTruthy();
  });
});
