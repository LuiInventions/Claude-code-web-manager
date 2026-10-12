import type { NextRequest } from "next/server";
import { ensureLocalCodium, stopLocalCodium, syncLocalCodium } from "@/lib/server/local-codium";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await syncLocalCodium());
}

export async function POST(req: NextRequest) {
  let body: { action?: string } = {};
  try {
    body = (await req.json()) as { action?: string };
  } catch {
    body = {};
  }
  if (body.action === "stop") return Response.json(await stopLocalCodium());
  return Response.json(await ensureLocalCodium());
}
