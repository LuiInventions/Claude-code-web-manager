import { existsSync } from "node:fs";
import { getConfig } from "@/lib/config";
import { cloneContainer, readGithubState } from "@/lib/github-store";

export const dynamic = "force-dynamic";

/** Local projects folder, and the folder that actually holds cloned repos. */
export async function GET() {
  const { projectsDir } = getConfig();
  const paths = readGithubState()
    .repos.filter((repo) => repo.cloneStatus === "cloned" && repo.localPath && existsSync(repo.localPath))
    .map((repo) => repo.localPath);
  return Response.json({
    projectsDir,
    clonesDir: cloneContainer(paths),
  });
}
