import type { NextRequest } from "next/server";
import {
  listPushQueue,
  reconcileQueue,
  replacePushQueue,
  listDismissed,
  writeDismissed,
  dismissRepo,
  filterDismissed,
  pruneDismissed,
  pushSignature,
  removePush,
} from "@/lib/repo-push-store";
import { scanPushableRepos } from "@/lib/server/repo-push-scan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The Repo Push queue is DERIVED from the live git state of the cloned repos,
 * not just from session-exit events (which never fire for still-open sessions
 * or across a server restart). We scan for dirty/ahead repos, hide any the user
 * removed from the list (until that repo is edited again), reconcile against the
 * persisted queue (to keep addedAt order + any in-flight push/error status),
 * persist, and return.
 */
export async function GET() {
  const scanned = await scanPushableRepos(Date.now());

  // Forget dismissals whose repo went clean or changed again, then hide the
  // still-valid ones from the visible list.
  const dismissed = listDismissed();
  const stillValid = pruneDismissed(dismissed, scanned);
  if (stillValid.length !== dismissed.length) writeDismissed(stillValid);
  const visible = filterDismissed(scanned, stillValid);

  const queue = reconcileQueue(listPushQueue(), visible);
  replacePushQueue(queue);
  return Response.json({ queue });
}

/**
 * Remove a repo from the push list. Non-destructive: the local changes stay on
 * disk; we just record a dismissal for the repo's current change-set so it does
 * not reappear until it is edited again.
 */
export async function DELETE(req: NextRequest) {
  const repoPath = req.nextUrl.searchParams.get("repoPath")?.trim();
  if (!repoPath) return Response.json({ error: "repoPath fehlt." }, { status: 400 });

  const scanned = await scanPushableRepos(Date.now());
  const entry = scanned.find((e) => e.repoPath === repoPath);
  if (entry) dismissRepo(repoPath, pushSignature(entry));
  removePush(repoPath);
  return Response.json({ ok: true });
}
