import { listPtySessions } from "./claude-pty";
import { listLauncherSessions } from "../launcher-store";
import { dedupeBotRuns, type BotRun } from "../bot-summary";

/**
 * Collect the current "bot" runs from both sources and normalize them to
 * `BotRun`:
 *  - live PTY sessions (in-memory registry, the bots running right now), and
 *  - persisted launcher history (finished/stopped runs with their result).
 *
 * Live sessions are listed first so that, on an id collision, the live (current)
 * state wins over the persisted snapshot. Server-only (touches node-pty + the
 * launcher store); the pure summary functions live in `lib/bot-summary.ts`.
 */
export function collectBotRuns(): BotRun[] {
  const live: BotRun[] = listPtySessions().map((s) => ({
    id: s.id,
    projectName: s.projectName || s.cwd.split(/[\\/]/).filter(Boolean).pop() || "",
    prompt: s.prompt,
    status: s.status,
    startedAt: s.startedAt,
    model: s.model || undefined,
    origin: s.origin,
    repoFullName: s.repoFullName,
  }));

  const persisted: BotRun[] = listLauncherSessions().map((s) => ({
    id: s.id,
    projectName: s.projectName,
    prompt: s.prompt,
    status: s.status,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    result: s.result,
    origin: s.origin,
    repoFullName: s.repoFullName,
  }));

  return dedupeBotRuns([...live, ...persisted]);
}
