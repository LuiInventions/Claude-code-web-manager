import { readGithubState } from "@/lib/github-store";
import { gitHasPendingPush } from "@/lib/git";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = readGithubState();
  // Annotate each cloned repo with a transient "pushable" flag so the UI can
  // hint when there are local changes to commit/push. Not persisted.
  const repos = await Promise.all(
    state.repos.map(async (r) =>
      r.cloneStatus === "cloned"
        ? { ...r, pendingPush: await gitHasPendingPush(r.localPath) }
        : { ...r, pendingPush: false },
    ),
  );
  return Response.json({ ...state, repos });
}
