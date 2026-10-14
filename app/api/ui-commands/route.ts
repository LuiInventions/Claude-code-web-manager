import type { NextRequest } from "next/server";
import {
  drainUiCommands,
  noteUiSection,
  uiSnapshot,
  type UiSectionId,
} from "@/lib/server/ui-commands";

export const dynamic = "force-dynamic";

const SECTIONS = new Set<UiSectionId>([
  "remote",
  "github-launch",
  "launcher",
  "github",
  "sessions",
  "jarvis",
  "settings",
]);

/** The window takes each command once and learns what the model asked it to show. */
export async function GET() {
  return Response.json({ commands: drainUiCommands(), ui: uiSnapshot() });
}

/** The window reports the sidebar section that is on screen. */
export async function POST(req: NextRequest) {
  let body: { section?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.section === "string" && SECTIONS.has(body.section as UiSectionId)) {
    noteUiSection(body.section as UiSectionId);
  }
  return Response.json({ ok: true, ui: uiSnapshot() });
}
