import type { NextRequest } from "next/server";
import { setRepoVisibility } from "@/lib/github";
import { readGithubToken } from "@/lib/github-secret";
import { markRepoPrivate, readGithubState } from "@/lib/github-store";

export const dynamic = "force-dynamic";

/** Toggle a repo between public and private on GitHub, then mirror locally. */
export async function POST(req: NextRequest) {
  let body: { fullName?: string; private?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const fullName = (body.fullName ?? "").trim();
  if (!fullName) return Response.json({ error: "Repo fehlt." }, { status: 400 });
  if (typeof body.private !== "boolean")
    return Response.json({ error: "Sichtbarkeit fehlt." }, { status: 400 });

  const token = readGithubToken();
  if (!token) return Response.json({ error: "Nicht mit GitHub verbunden." }, { status: 400 });

  try {
    await setRepoVisibility(token, fullName, body.private);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }

  markRepoPrivate(fullName, body.private);
  return Response.json(readGithubState());
}
