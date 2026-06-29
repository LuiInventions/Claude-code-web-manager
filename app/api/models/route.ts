import { listModelsForUi } from "@/lib/openai";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Curated current models for the active provider, enriched with the live
    // /models list when a key is present (so every provider has a dropdown).
    return Response.json({ models: await listModelsForUi() });
  } catch (err) {
    // Degrade gracefully (e.g. missing key) so Settings still loads.
    return Response.json({ models: [], error: (err as Error).message });
  }
}
