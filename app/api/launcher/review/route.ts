import type { NextRequest } from "next/server";
import { snapshotPtySessions } from "@/lib/server/claude-pty";
import { generateSpeechSummary, generateMarkdownReport, type ReviewItem } from "@/lib/session-review";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface Body {
  sessions?: { id?: string; number?: number }[];
}

/**
 * Streams two NDJSON lines so the client can start TTS immediately:
 *   {"type":"speech","text":"..."}
 *   {"type":"markdown","text":"..."}
 * Both LLM calls run in parallel; each line is written as soon as its call
 * finishes — whichever arrives first is sent first.
 */
export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const requested = (body.sessions ?? [])
    .map((s) => ({ id: String(s.id ?? ""), number: Number(s.number ?? 0) }))
    .filter((s) => s.id && s.number > 0);

  const ids = requested.map((s) => s.id);
  const numberById = new Map(requested.map((s) => [s.id, s.number]));
  const snapshots = snapshotPtySessions(ids);
  const items: ReviewItem[] = snapshots.map((snap) => ({
    ...snap,
    number: numberById.get(snap.id) ?? 0,
  }));

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, string>) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      try {
        await Promise.all([
          generateSpeechSummary(items)
            .then((text) => send({ type: "speech", text }))
            .catch(() => send({ type: "speech", text: "Der Review ist abgeschlossen." })),
          generateMarkdownReport(items)
            .then((text) => send({ type: "markdown", text }))
            .catch(() => send({ type: "markdown", text: "_Kein Ergebnis._" })),
        ]);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}
