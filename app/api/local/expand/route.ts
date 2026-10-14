import type { NextRequest } from "next/server";
import { expandDroppedPaths } from "@/lib/local-tree";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { paths?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const paths = Array.isArray(body.paths) ? body.paths.filter((item): item is string => typeof item === "string") : [];
  if (paths.length === 0) return Response.json({ error: "Nichts zum Hochladen." }, { status: 400 });
  try {
    const items = await expandDroppedPaths(paths);
    return Response.json({ items });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
