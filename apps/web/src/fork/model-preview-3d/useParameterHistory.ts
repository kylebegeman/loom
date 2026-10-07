import { useState, useEffect, useCallback } from "react";
import {
  createHistory,
  recordHistory,
  moveHistory,
  type ParameterState,
  type ParameterHistory,
} from "./parameterHistory";
const sessions = new Map<string, { source: string; history: ParameterHistory }>();
/** Session-local history survives switching file tabs; source edits establish a new baseline. */
export function useParameterHistory(key: string, source: string | null, initial: ParameterState) {
  const [state, setState] = useState(
    () => sessions.get(key) ?? { source: "", history: createHistory(initial) },
  );
  let active = state;
  if (source && state.source !== source) {
    active = { source, history: createHistory(initial) };
    setState(active);
  }
  useEffect(() => {
    if (state.source) sessions.set(key, state);
    if (sessions.size > 40) sessions.delete(sessions.keys().next().value!);
  }, [key, state]);
  const record = useCallback(
    (value: ParameterState, label: string, coalesce: string | null = null) =>
      setState((current) => ({
        ...current,
        history: recordHistory(current.history, value, label, coalesce, Date.now()),
      })),
    [],
  );
  const move = useCallback(
    (cursor: number) =>
      setState((current) => ({ ...current, history: moveHistory(current.history, cursor) })),
    [],
  );
  return {
    history: active.history,
    current: active.history.entries[active.history.cursor]!.value,
    record,
    move,
  };
}
