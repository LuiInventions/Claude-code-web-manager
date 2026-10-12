import { NextResponse } from "next/server";
import { remoteBrokerPort } from "@/lib/server/remote-session";
import { remoteFind, remoteList } from "@/lib/server/remote-broker";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const port = remoteBrokerPort();
  if (!port) {
    return NextResponse.json({ error: "Nicht mit dem Server verbunden." }, { status: 409 });
  }
  const url = new URL(req.url);
  const path = url.searchParams.get("path")?.trim() || "~";
  const q = url.searchParams.get("q")?.trim() || "";
  try {
    const listing = q ? await remoteFind(port, path, q) : await remoteList(port, path);
    return NextResponse.json(listing);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Dateiliste fehlgeschlagen.";
    return NextResponse.json({ error: message, path, entries: [] }, { status: 502 });
  }
}
