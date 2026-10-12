import type { NextRequest } from "next/server";
import { readViewFile, writeViewFile } from "@/lib/file-view";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get("path")?.trim() || "";
  if (!filePath) return Response.json({ error: "path fehlt." }, { status: 400 });
  try {
    return Response.json(await readViewFile(filePath));
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  let body: { path?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const filePath = (body.path ?? "").trim();
  if (!filePath) return Response.json({ error: "path fehlt." }, { status: 400 });
  if (typeof body.content !== "string") {
    return Response.json({ error: "content fehlt." }, { status: 400 });
  }
  try {
    await writeViewFile(filePath, body.content);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
