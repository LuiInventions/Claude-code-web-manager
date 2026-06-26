import type { NextRequest } from "next/server";
import { listDir, listDrives } from "@/lib/fs-explorer";

// Read-only directory listing. No `path` -> list drives.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams.get("path");
  try {
    if (!p) {
      return Response.json({ kind: "drives", entries: await listDrives() });
    }
    const { entries, truncated } = await listDir(p);
    return Response.json({ kind: "dir", path: p, entries, truncated });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
