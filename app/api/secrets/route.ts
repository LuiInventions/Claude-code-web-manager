import type { NextRequest } from "next/server";
import { secretsStatus, writeSecrets, type Secrets } from "@/lib/secrets";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(secretsStatus());
}

export async function POST(req: NextRequest) {
  let body: Secrets;
  try {
    body = (await req.json()) as Secrets;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const patch: Secrets = {};
  if (typeof body.openaiApiKey === "string") patch.openaiApiKey = body.openaiApiKey;
  if (typeof body.cartesiaApiKey === "string") patch.cartesiaApiKey = body.cartesiaApiKey;
  if (typeof body.picovoiceAccessKey === "string") patch.picovoiceAccessKey = body.picovoiceAccessKey;
  const status = writeSecrets(patch);
  return Response.json(status);
}
