import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { ModelWorkspaceOperation } from "@t3tools/contracts/fork";
import { commit, rebase, redo, same, startHistory, undo, type History } from "./undoHistory";
import { applyToList, describeChange, operationField, type UndoSlice } from "./undoSlice";

export type UndoStatus = { undo: string | undefined; redo: string | undefined };
/** What a step did, for its announcement. `applied` is false when it changed elsewhere. */
export type UndoOutcome = { message: string; applied: boolean };

/** Histories outlive a panel remount, like the customizer's, but only for recent files. */
const SCOPES_KEPT = 40;
const histories = new Map<string, History<UndoSlice>>();
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
function keep(scope: string, history: History<UndoSlice>) {
  histories.delete(scope);
  histories.set(scope, history);
  while (histories.size > SCOPES_KEPT) histories.delete(histories.keys().next().value!);
  notify();
}

const NOTHING: UndoStatus = { undo: undefined, redo: undefined };
const statuses = new WeakMap<History<UndoSlice>, UndoStatus>();
/** The labels of the next undo and redo, the same object for the same history. */
function statusOf(history: History<UndoSlice> | undefined): UndoStatus {
  if (!history) return NOTHING;
  let status = statuses.get(history);
  if (!status) {
    status = { undo: history.past.at(-1)?.label, redo: history.future[0]?.label };
    statuses.set(history, status);
  }
  return status;
}

/** Forgets every history. Tests use it; the app keeps them for the session. */
export function clearUndoHistories() {
  histories.clear();
  notify();
}

/**
 * Keeps an in-memory undo history per file revision (`scope`) over the panel state in `slice`.
 * Entering a scope adopts its current state and drops steps on fields that moved meanwhile. Edits
 * are recorded where they commit. `apply` returns false when everything a step touches changed
 * elsewhere, and that step is dropped instead of overwriting the change.
 */
export function useUndoHistory({
  scope,
  slice,
  ready,
  apply,
}: {
  /** Empty while there is no revision to keep a history for. */
  scope: string;
  slice: UndoSlice;
  ready: boolean;
  apply: (fields: Partial<UndoSlice>, from: Partial<UndoSlice>) => boolean;
}) {
  const latest = useRef(slice),
    applyLatest = useRef(apply),
    entered = useRef("");
  const status = useSyncExternalStore(subscribe, () =>
    statusOf(scope && ready ? histories.get(scope) : undefined),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the latest slice and apply function in refs for the module-level undo history
  useLayoutEffect(() => {
    latest.current = slice;
    applyLatest.current = apply;
  });
  /** The scope's history with this render's state adopted, starting one if needed. */
  const held = useCallback((): History<UndoSlice> | undefined => {
    if (!scope || !ready) return undefined;
    const history = histories.get(scope);
    if (!history) return startHistory(latest.current);
    if (entered.current !== scope) return rebase(history, latest.current);
    return history;
  }, [scope, ready]);
  const parameters = slice.parameters;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records customizer parameter changes into the module-level undo history for this scope
  useEffect(() => {
    let history = held();
    if (!history) {
      entered.current = "";
      return;
    }
    entered.current = scope;
    // Customizer changes are only seen after the fact, so they are recorded here. Their first
    // values once the parameters load are adopted rather than recorded.
    if (!same(history.present.parameters, parameters))
      history = history.present.parameters
        ? commit(history, { ...history.present, parameters }, describeChange, Date.now())
        : { ...history, present: { ...history.present, parameters } };
    keep(scope, history);
  }, [held, scope, parameters]);
  const save = useCallback(
    (next: (history: History<UndoSlice>) => History<UndoSlice>) => {
      const history = held();
      if (!history) return;
      entered.current = scope;
      const updated = next(history);
      keep(scope, updated);
    },
    [held, scope],
  );
  /**
   * Records a saved workspace operation on measurements or pins. Others are ignored. Operations
   * sharing a `group` merge into one step, as a bulk clear does; otherwise each item is its own.
   */
  const recordOperation = useCallback(
    (operation: ModelWorkspaceOperation, group?: string) => {
      const field = operationField(operation);
      if (!field) return;
      save((history) => {
        const list = history.present[field] as readonly { id: string }[];
        const next = applyToList(
          list,
          operation.kind === "remove"
            ? { kind: "remove", id: operation.id }
            : { kind: "upsert", item: (operation as { item: { id: string } }).item },
        );
        const describe: typeof describeChange = (before, after) => {
          const change = describeChange(before, after);
          return group ? { label: change.label, key: `${field}:group-${group}` } : change;
        };
        return commit(history, { ...history.present, [field]: next }, describe, Date.now());
      });
    },
    [save],
  );
  /** Records a section or orientation change from `before` to `after`. */
  const recordValue = useCallback(
    <K extends "section" | "orientation">(field: K, before: UndoSlice[K], after: UndoSlice[K]) =>
      save((history) => {
        const present = { ...history.present, [field]: before };
        return commit(
          { ...history, present },
          { ...present, [field]: after },
          describeChange,
          Date.now(),
        );
      }),
    [save],
  );
  const step = useCallback(
    (direction: "undo" | "redo"): UndoOutcome | null => {
      const history = scope && ready ? histories.get(scope) : undefined;
      const result = history && (direction === "undo" ? undo(history) : redo(history));
      if (!result) return null;
      const applied = applyLatest.current(result.apply, result.from);
      // A step whose every field changed elsewhere is dropped rather than kept to replay.
      const next = applied
        ? result.history
        : direction === "undo"
          ? { ...result.history, future: result.history.future.slice(1) }
          : { ...result.history, past: result.history.past.slice(0, -1) };
      keep(scope, next);
      return {
        message: applied
          ? `${direction === "undo" ? "Undid" : "Redid"}: ${result.label}`
          : `Could not ${direction} ${result.label}: it changed somewhere else.`,
        applied,
      };
    },
    [scope, ready],
  );
  return {
    status,
    recordOperation,
    recordValue,
    /** Steps back once and says what it did, or returns null when there is nothing to undo. */
    undo: useCallback(() => step("undo"), [step]),
    redo: useCallback(() => step("redo"), [step]),
  };
}
