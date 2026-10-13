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
    const code = (err as NodeJS.ErrnoException).code;
    const message =
      code === "ENOENT" ? "Dieser Ordner ist nicht mehr da." : (err as Error).message;
    return Response.json({ error: message }, { status: 400 });
  }
}
