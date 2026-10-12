import type { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { openInExplorer } from "@/lib/fs-explorer";
import { getConfig } from "@/lib/config";

// Reveal a path in Windows Explorer.
export async function POST(req: NextRequest) {
  let body: { path?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.path) return Response.json({ error: "missing path" }, { status: 400 });
  try {
    const abs = path.resolve(body.path);
    const { projectsDir, githubDir } = getConfig();
    // The Local and GitHub rails open these two folders. Create them if the
    // user has not cloned or saved anything into them yet.
    if (abs === path.resolve(projectsDir) || abs === path.resolve(githubDir)) {
      await fs.mkdir(abs, { recursive: true });
    }
    await openInExplorer(abs);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
