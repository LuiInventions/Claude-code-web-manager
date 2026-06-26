/**
 * Window/instance model for the control center.
 *
 * The new concept treats every open thing — a Claude Code console, a section
 * view, a future floating window — as a referenceable "instance". This module
 * is the small, pure state foundation for that: a shared shape plus stable
 * numbering, so instances can be addressed as "#1", "#2", … in the UI and
 * (later) by Jarvis.
 *
 * Deliberately decoupled from the live PTY layer — it carries no sockets,
 * timers, or side effects. Wiring it into the running consoles is a later step.
 */

/** What kind of thing an instance represents. */
export type InstanceKind = "claude" | "section";

/** A single referenceable window/instance. */
export interface WindowInstance {
  /** Stable unique id (matches the underlying session/section id). */
  id: string;
  kind: InstanceKind;
  /** Human-facing label (project name, section name, …). */
  label: string;
  /**
   * Monotonic creation key — lower is older. Numbering is derived from this,
   * not from array position, so a number never changes when newer instances
   * appear or older ones are removed mid-list.
   */
  createdAt: number;
  /** Optional grouping (e.g. a launcher batch that opened together). */
  groupId?: string;
}

/** An instance paired with its stable 1-based display number. */
export interface NumberedInstance<T extends WindowInstance = WindowInstance> {
  instance: T;
  /** 1-based number assigned by age (oldest = 1). */
  number: number;
}

/**
 * Assign stable, unique 1-based numbers by creation order (oldest = 1) while
 * preserving the input array's order in the result.
 *
 * Stability: the same instance keeps the same number regardless of how the
 * caller sorts the list or how many others are added afterwards — the number
 * is a function of `createdAt` (ties broken by `id`), never of position.
 */
export function numberInstances<T extends WindowInstance>(
  instances: T[],
): NumberedInstance<T>[] {
  const byAge = [...instances].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  const numberById = new Map<string, number>();
  byAge.forEach((inst, i) => numberById.set(inst.id, i + 1));
  return instances.map((instance) => ({
    instance,
    number: numberById.get(instance.id) ?? 0,
  }));
}

/** Look up one instance's stable number within its set (1-based, 0 if absent). */
export function instanceNumber(
  instances: WindowInstance[],
  id: string,
): number {
  return numberInstances(instances).find((n) => n.instance.id === id)?.number ?? 0;
}
