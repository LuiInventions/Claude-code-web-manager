import type { NextRequest } from "next/server";
import { existsSync } from "node:fs";
import { getPublicConfig } from "@/lib/config";
import { writeSettings } from "@/lib/settings";
import { appVersion } from "@/lib/version";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(getPublicConfig());
}

export async function POST(req: NextRequest) {
  let body: {
    projectsDir?: string;
    aiProvider?: string;
    aiModel?: string;
    openaiModel?: string;
    cartesiaVoice?: string;
    sessionsView?: string;
    /** Sent by the setup screen on "Loslegen" — stamps this app version. */
    setupComplete?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const patch: {
    projectsDir?: string;
    aiProvider?: string;
    aiModel?: string;
    openaiModel?: string;
    cartesiaVoice?: string;
    sessionsView?: "pixel" | "flow";
    setupVersion?: string;
  } = {};

  if (typeof body.projectsDir === "string") {
    const dir = body.projectsDir.trim();
    if (dir && !existsSync(dir)) {
      return Response.json({ error: `Ordner existiert nicht: ${dir}` }, { status: 400 });
    }
    patch.projectsDir = dir;
  }
  if (typeof body.aiProvider === "string") patch.aiProvider = body.aiProvider.trim();
  if (typeof body.aiModel === "string") patch.aiModel = body.aiModel.trim();
  if (typeof body.openaiModel === "string") patch.openaiModel = body.openaiModel.trim();
  if (typeof body.cartesiaVoice === "string") patch.cartesiaVoice = body.cartesiaVoice.trim();
  if (body.sessionsView === "pixel" || body.sessionsView === "flow")
    patch.sessionsView = body.sessionsView;
  // Mark first-run setup complete for THIS version so the gate (config.ready)
  // doesn't re-show the welcome screen until the next update. Only stamp once a
  // valid, existing projects folder is present — otherwise `ready` would stay
  // false (folder missing) yet setupVersion would be set, leaving the welcome
  // screen reappearing with no clear cause.
  if (body.setupComplete === true) {
    const dir = typeof body.projectsDir === "string" ? body.projectsDir.trim() : "";
    if (!dir || !existsSync(dir)) {
      return Response.json(
        { error: "Projektordner erforderlich und muss existieren." },
        { status: 400 },
      );
    }
    patch.setupVersion = appVersion();
  }

  writeSettings(patch);
  return Response.json(getPublicConfig());
}
