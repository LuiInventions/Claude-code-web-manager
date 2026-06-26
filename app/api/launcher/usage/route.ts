import { getUsage } from "@/lib/usage-store";

export const dynamic = "force-dynamic";

// Current Claude usage / rate-limit state for the launcher (browser-safe).
export async function GET() {
  return Response.json(getUsage());
}
