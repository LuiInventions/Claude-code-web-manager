import type { NextRequest } from "next/server";
import { existsSync } from "node:fs";
import { getPublicConfig } from "@/lib/config";
import { writeSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(getPublicConfig());
}

export async function POST(req: NextRequest) {
  let body: { projectsDir?: string; openaiModel?: string; cartesiaVoice?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const patch: {
    projectsDir?: string;
    openaiModel?: string;
    cartesiaVoice?: string;
  } = {};

  if (typeof body.projectsDir === "string") {
    const dir = body.projectsDir.trim();
    if (dir && !existsSync(dir)) {
      return Response.json({ error: `Ordner existiert nicht: ${dir}` }, { status: 400 });
    }
    patch.projectsDir = dir;
  }
  if (typeof body.openaiModel === "string") patch.openaiModel = body.openaiModel.trim();
  if (typeof body.cartesiaVoice === "string") patch.cartesiaVoice = body.cartesiaVoice.trim();

  writeSettings(patch);
  return Response.json(getPublicConfig());
}
