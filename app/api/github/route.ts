import { readGithubState } from "@/lib/github-store";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(readGithubState());
}
