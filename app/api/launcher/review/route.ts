import type { NextRequest } from "next/server";
import { snapshotPtySessions } from "@/lib/server/claude-pty";
import { reviewSessions, type ReviewItem } from "@/lib/session-review";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface Body {
  sessions?: { id?: string; number?: number }[];
}

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

  // Pull output in the requested id order, then re-attach the UI numbers.
  const ids = requested.map((s) => s.id);
  const numberById = new Map(requested.map((s) => [s.id, s.number]));
  const snapshots = snapshotPtySessions(ids);
  const items: ReviewItem[] = snapshots.map((snap) => ({
    ...snap,
    number: numberById.get(snap.id) ?? 0,
  }));

  try {
    const result = await reviewSessions(items);
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
