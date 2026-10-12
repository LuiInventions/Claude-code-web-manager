import type { NextRequest } from "next/server";
import { remoteBrokerPort } from "@/lib/server/remote-session";
import { remoteReadFile, remoteWriteFile } from "@/lib/server/remote-broker";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const port = remoteBrokerPort();
  if (!port) return Response.json({ error: "Nicht mit dem Server verbunden." }, { status: 409 });
  const filePath = req.nextUrl.searchParams.get("path")?.trim() || "";
  if (!filePath) return Response.json({ error: "path fehlt." }, { status: 400 });
  try {
    return Response.json(await remoteReadFile(port, filePath));
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}

export async function PUT(req: NextRequest) {
  const port = remoteBrokerPort();
  if (!port) return Response.json({ error: "Nicht mit dem Server verbunden." }, { status: 409 });
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
    await remoteWriteFile(port, filePath, body.content);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
