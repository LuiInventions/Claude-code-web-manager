import type { NextRequest } from "next/server";
import { friendlyAiError } from "@/lib/openai";
import {
  askJarvis,
  clearJarvisHistory,
  hasJarvisKey,
  JARVIS_MODEL,
  JARVIS_MODEL_LABEL,
  JarvisRequestError,
  loadJarvisHistory,
} from "@/lib/server/jarvis/chat";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function GET() {
  return Response.json({
    messages: loadJarvisHistory().messages,
    model: JARVIS_MODEL,
    modelLabel: JARVIS_MODEL_LABEL,
    hasKey: hasJarvisKey(),
  });
}

export async function POST(req: NextRequest) {
  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Ungültige Nachricht." }, { status: 400 });
  }
  if (typeof body.text !== "string") {
    return Response.json({ error: "Schreib eine Nachricht." }, { status: 400 });
  }
  try {
    const history = await askJarvis(body.text);
    return Response.json({
      messages: history.messages,
      model: JARVIS_MODEL,
      modelLabel: JARVIS_MODEL_LABEL,
    });
  } catch (err) {
    const status = err instanceof JarvisRequestError ? err.status : 400;
    const error = err instanceof JarvisRequestError ? err.message : friendlyAiError(err);
    return Response.json({ messages: loadJarvisHistory().messages, error }, { status });
  }
}

export function DELETE() {
  return Response.json({ messages: clearJarvisHistory().messages });
}
