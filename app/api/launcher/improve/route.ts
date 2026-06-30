import type { NextRequest } from "next/server";
import { improvePrompt } from "@/lib/prompt-improver";
import { friendlyAiError } from "@/lib/openai";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
    const improvedPrompt = await improvePrompt(projectPath, prompt);
    return Response.json({ improvedPrompt });
  } catch (err) {
    return Response.json({ error: friendlyAiError(err) }, { status: 400 });
  }
}
