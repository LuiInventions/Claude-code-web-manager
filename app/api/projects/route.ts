import { scanProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await scanProjects());
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
