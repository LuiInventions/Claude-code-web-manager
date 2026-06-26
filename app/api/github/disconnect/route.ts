import { clearGithubToken } from "@/lib/github-secret";
import { clearGithubState } from "@/lib/github-store";

export const dynamic = "force-dynamic";

export async function POST() {
  clearGithubToken();
  clearGithubState();
  return Response.json({ connected: false });
}
