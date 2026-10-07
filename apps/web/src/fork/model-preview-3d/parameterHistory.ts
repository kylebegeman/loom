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
