import { listChatModels } from "@/lib/openai";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ models: await listChatModels() });
  } catch (err) {
    // Degrade gracefully (e.g. missing key) so Settings still loads.
    return Response.json({ models: [], error: (err as Error).message });
  }
}
