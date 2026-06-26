import type { NextRequest } from "next/server";
import { splitPrompt } from "@/lib/prompt-splitter";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// "KI Modus": split a large prompt into 1–6 structured sub-session prompts.
export async function POST(req: NextRequest) {
  let body: { projectPath?: string; prompt?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const projectPath = (body.projectPath ?? "").trim();
  const prompt = (body.prompt ?? "").trim();
  if (!projectPath || !prompt) {
    return Response.json(
      { error: "projectPath und prompt sind erforderlich" },
      { status: 400 },
    );
  }
  try {
    const sessions = await splitPrompt(projectPath, prompt);
    return Response.json({ sessions });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
