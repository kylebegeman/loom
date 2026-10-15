/**
 * Bounded undo history over a record of independent fields. Each step keeps only the fields it
 * changed, so undoing it restores those fields and leaves the rest as they are now. Ported from
 * the Loom 3D widget's `shared/history.ts`.
 */
export type Step<T> = {
  before: Partial<T>;
  after: Partial<T>;
  label: string;
  /** Rapid steps with the same key merge into one. */
  key: string;
  at: number;
};

export type History<T> = { past: Step<T>[]; present: T; future: Step<T>[] };

/** Most steps one history keeps; older ones fall off. */
export const HISTORY_LIMIT = 100;
/** Changes to the same target within this many milliseconds are one step. */
export const COALESCE_MS = 800;

/**
 * Structural equality for plain state: arrays, objects and primitives. Key order does not matter
 * and a key holding `undefined` counts as absent, because the server returns items with its own
 * key order.
 */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((item, index) => same(item, b[index]));
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) if (!same(left[key], right[key])) return false;
  return true;
}

export function startHistory<T extends object>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** The fields whose values differ between two states. */
function changedFields<T extends object>(from: T, to: T): (keyof T)[] {
  return (Object.keys(to) as (keyof T)[]).filter((field) => !same(from[field], to[field]));
}

const pick = <T extends object>(state: T, fields: (keyof T)[]): Partial<T> =>
  Object.fromEntries(fields.map((field) => [field, state[field]])) as Partial<T>;

/**
 * Records `next` as the present. A change to the same fields under the same key within
 * COALESCE_MS of the last step extends that step, so a drag or a run of keystrokes undoes in one
 * go. Any new step clears the redo future.
 */
export function commit<T extends object>(
  history: History<T>,
  next: T,
  describe: (before: Partial<T>, after: Partial<T>) => { label: string; key: string },
  at: number,
  limit = HISTORY_LIMIT,
): History<T> {
  const fields = changedFields(history.present, next);
  if (!fields.length) return { ...history, present: next };
  const before = pick(history.present, fields),
    after = pick(next, fields),
    { label, key } = describe(before, after),
    last = history.past.at(-1);
  if (
    last &&
    last.key === key &&
    at - last.at <= COALESCE_MS &&
    fields.every((field) => field in last.after)
  ) {
    const mergedAfter = { ...last.after, ...after };
    // The run is named by its whole change, so a run of deletions reads as one.
    const merged: Step<T> = {
      ...last,
      after: mergedAfter,
      label: describe(last.before, mergedAfter).label,
      at,
    };
    // A run that ends where it started leaves nothing to undo.
    const settled = changedFields(merged.before, merged.after).length;
    return {
      past: settled ? [...history.past.slice(0, -1), merged] : history.past.slice(0, -1),
      present: next,
      future: [],
    };
  }
  return {
    past: [...history.past, { before, after, label, key, at }].slice(-limit),
    present: next,
    future: [],
  };
}

/**
 * Adopts a present that changed outside the history, such as a revision reload. Steps on fields
 * that moved are dropped, because replaying them would discard that change.
 */
export function rebase<T extends object>(history: History<T>, present: T): History<T> {
  const moved = changedFields(history.present, present),
    keep = (step: Step<T>) => !moved.some((field) => field in step.after);
  return { past: history.past.filter(keep), present, future: history.future.filter(keep) };
}

/** Steps back once; `apply` holds the field values to set and `from` the values it replaces. */
export function undo<T extends object>(
  history: History<T>,
): { history: History<T>; apply: Partial<T>; from: Partial<T>; label: string } | undefined {
  const step = history.past.at(-1);
  if (!step) return undefined;
  return {
    history: {
      past: history.past.slice(0, -1),
      present: { ...history.present, ...step.before },
      future: [step, ...history.future],
    },
    apply: step.before,
    from: step.after,
    label: step.label,
  };
}

/** Steps forward once after an undo. */
export function redo<T extends object>(
  history: History<T>,
): { history: History<T>; apply: Partial<T>; from: Partial<T>; label: string } | undefined {
  const step = history.future[0];
  if (!step) return undefined;
  return {
    history: {
      past: [...history.past, step],
      present: { ...history.present, ...step.after },
      future: history.future.slice(1),
    },
    apply: step.after,
    from: step.before,
    label: step.label,
  };
}
