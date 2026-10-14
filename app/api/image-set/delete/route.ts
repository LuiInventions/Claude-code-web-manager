import type { NextRequest } from "next/server";
import { isImageSetFolder } from "@/lib/remote-upload-flow";
import { removeLocalImageSet } from "@/lib/server/local-upload";
import { remoteRemoveSet } from "@/lib/server/remote-copy";
import { remoteBrokerPort } from "@/lib/server/remote-session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { kind?: unknown; dir?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const kind = body.kind === "local" ? "local" : body.kind === "remote" ? "remote" : "";
  const dir = typeof body.dir === "string" ? body.dir.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!kind || !dir || !isImageSetFolder(name)) {
    return Response.json({ error: "Nur Bildordner." }, { status: 400 });
  }
  try {
    if (kind === "local") await removeLocalImageSet(dir, name);
    else {
      const port = remoteBrokerPort();
      if (!port) return Response.json({ error: "Nicht mit dem Server verbunden." }, { status: 409 });
      await remoteRemoveSet(port, dir, name);
    }
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
