import type { NextRequest } from "next/server";
import { testProvider, type ProviderTestResult } from "@/lib/openai";
import { secretsStatus } from "@/lib/secrets";

/**
 * POST /api/providers/test — verify AI provider keys actually work.
 *
 * Body: { provider?: string, model?: string }
 *   - with `provider`: tests just that provider (with `model` or its default)
 *   - without `provider`: tests EVERY provider that currently has a key set
 *
 * Each result is { provider, label, ok, model?, error? }. Runs server-side only
 * (keys never reach the browser). Used by the Settings "Test keys" button.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: { provider?: string; model?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body → test all keyed providers */
  }

  const provider = (body.provider ?? "").trim();
  const model = (body.model ?? "").trim() || undefined;

  let results: ProviderTestResult[];
  if (provider) {
    results = [await testProvider(provider, model)];
  } else {
    const status = secretsStatus();
    const keyed = Object.entries(status.providers)
      .filter(([, has]) => has)
      .map(([id]) => id);
    // Tested concurrently — independent network calls to different providers.
    results = await Promise.all(keyed.map((id) => testProvider(id)));
  }

  return Response.json({ results });
}
