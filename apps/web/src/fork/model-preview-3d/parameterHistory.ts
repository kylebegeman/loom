export type ParameterState = {
  overrides: Readonly<Record<string, string>>;
  setName: string | null;
};
export type ParameterHistory = {
  entries: { label: string; value: ParameterState; time: number; key: string | null }[];
  cursor: number;
};
export const createHistory = (value: ParameterState): ParameterHistory => ({
  entries: [{ label: "Starting values", value, time: 0, key: null }],
  cursor: 0,
});
export function recordHistory(
  history: ParameterHistory,
  value: ParameterState,
  label: string,
  key: string | null,
  time: number,
): ParameterHistory {
  const current = history.entries[history.cursor]!;
  if (JSON.stringify(current.value) === JSON.stringify(value)) return history;
  const entries = history.entries.slice(0, history.cursor + 1);
  const grouped =
    key !== null && current.key === key && time - current.time < 700 && history.cursor > 0;
  const entry = { label, value, key, time };
  if (grouped) entries[entries.length - 1] = entry;
  else entries.push(entry);
  const bounded = entries.slice(-80);
  return { entries: bounded, cursor: bounded.length - 1 };
}
export function moveHistory(history: ParameterHistory, cursor: number): ParameterHistory {
  const index = Math.max(0, Math.min(history.entries.length - 1, cursor));
  return {
    entries: history.entries.map((entry, i) => (i === index ? { ...entry, key: null } : entry)),
    cursor: index,
  };
}
/**
 * The entry nearest the cursor that holds `value`, or -1. Panel-wide undo steps back to a
 * parameter state by moving here, so the customizer's own history keeps its redo entries.
 */
export function nearestEntry(history: ParameterHistory, value: ParameterState): number {
  const key = JSON.stringify(value);
  let best = -1;
  history.entries.forEach((entry, index) => {
    if (
      JSON.stringify(entry.value) === key &&
      (best < 0 || Math.abs(index - history.cursor) < Math.abs(best - history.cursor))
    )
      best = index;
  });
  return best;
}
