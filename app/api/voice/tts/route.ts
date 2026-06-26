import type { NextRequest } from "next/server";
import { synthesize } from "@/lib/voice";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const text = (body.text ?? "").trim();
  if (!text) return Response.json({ error: "empty text" }, { status: 400 });
  try {
    const { audio, contentType } = await synthesize(text);
    return new Response(new Uint8Array(audio), {
      headers: { "content-type": contentType, "cache-control": "no-store" },
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
