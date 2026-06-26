import { buildIndex, getIndex } from "@/lib/indexer";

export const dynamic = "force-dynamic";

export async function GET() {
  const idx = getIndex();
  return Response.json(
    idx
      ? {
          builtAt: idx.builtAt,
          projectsDir: idx.projectsDir,
          projectCount: idx.projects.length,
        }
      : { builtAt: null, projectCount: 0 },
  );
}

export async function POST() {
  try {
    const idx = await buildIndex();
    return Response.json({
      builtAt: idx.builtAt,
      projectsDir: idx.projectsDir,
      projectCount: idx.projects.length,
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
