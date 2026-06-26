import { listGermanVoices } from "@/lib/voice";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ voices: await listGermanVoices() });
  } catch (err) {
    return Response.json({ voices: [], error: (err as Error).message });
  }
}
