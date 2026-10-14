/**
 * Commands the MCP server asks the open window to perform.
 * The shell polls GET /api/ui-commands, applies each command once, and posts
 * the section that is on screen so tools can see where the user is.
 */

export type UiSectionId =
  | "remote"
  | "github-launch"
  | "launcher"
  | "github"
  | "sessions"
  | "jarvis"
  | "settings";

export interface UiCommand {
  id: number;
  section: UiSectionId;
  payload: unknown;
}

export interface UiSnapshot {
  /** Sidebar section last reported by the window. */
  section: UiSectionId | null;
  /** Epoch ms of that report. Null until the window has polled once. */
  seenAt: number | null;
  /** True when the window reported itself in the last few seconds. */
  attached: boolean;
  pending: number;
}

const ATTACHED_MS = 4000;
const MAX_PENDING = 40;

const g = globalThis as unknown as {
  __cccUi?: {
    next: number;
    queue: UiCommand[];
    section: UiSectionId | null;
    seenAt: number | null;
  };
};

function hub() {
  return (g.__cccUi ??= { next: 1, queue: [], section: null, seenAt: null });
}

export function enqueueUiCommand(section: UiSectionId, payload: unknown): UiCommand {
  const state = hub();
  const command: UiCommand = { id: state.next++, section, payload };
  state.queue.push(command);
  if (state.queue.length > MAX_PENDING) state.queue.splice(0, state.queue.length - MAX_PENDING);
  return command;
}

/** Take every pending command. A second poll does not see them again. */
export function drainUiCommands(): UiCommand[] {
  const state = hub();
  const commands = state.queue;
  state.queue = [];
  return commands;
}

export function noteUiSection(section: UiSectionId): void {
  const state = hub();
  state.section = section;
  state.seenAt = Date.now();
}

export function uiSnapshot(now = Date.now()): UiSnapshot {
  const state = hub();
  return {
    section: state.section,
    seenAt: state.seenAt,
    attached: state.seenAt != null && now - state.seenAt <= ATTACHED_MS,
    pending: state.queue.length,
  };
}

/** Test hook. Production code does not reset the queue. */
export function resetUiCommands(): void {
  const state = hub();
  state.next = 1;
  state.queue = [];
  state.section = null;
  state.seenAt = null;
}
