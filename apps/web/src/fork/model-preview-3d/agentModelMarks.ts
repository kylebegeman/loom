import type { RunId } from "@t3tools/contracts";
import type { TurnModels } from "@t3tools/contracts/fork";
import { create } from "zustand";

export interface AgentModelMark {
  turn: number;
}
interface AgentModelMarks {
  marks: Record<string, Record<string, AgentModelMark>>;
  latest: Record<string, TurnModels>;
  pickerTurn: Record<string, RunId>;
  mark: (threadKey: string, paths: readonly string[], turn: number) => void;
  clear: (threadKey: string, path?: string) => void;
  remember: (threadKey: string, models: TurnModels) => void;
  setPickerTurn: (threadKey: string, runId: RunId | null) => void;
}

/** Changes are session state; model tabs themselves persist in the right panel store. */
export const useAgentModelMarks = create<AgentModelMarks>((set) => ({
  marks: {},
  latest: {},
  pickerTurn: {},
  mark: (threadKey, paths, turn) =>
    set((state) => ({
      marks: {
        ...state.marks,
        [threadKey]: {
          ...state.marks[threadKey],
          ...Object.fromEntries(paths.map((path) => [path, { turn }])),
        },
      },
    })),
  clear: (threadKey, path) =>
    set((state) => {
      const current = state.marks[threadKey];
      if (!current || (path !== undefined && !current[path])) return state;
      const next = { ...current };
      if (path === undefined) {
        const marks = { ...state.marks };
        delete marks[threadKey];
        return { marks };
      }
      delete next[path];
      return { marks: { ...state.marks, [threadKey]: next } };
    }),
  remember: (threadKey, models) =>
    set((state) => {
      const current = state.latest[threadKey];
      if (current && (current.turn ?? 0) > (models.turn ?? 0)) return state;
      return { latest: { ...state.latest, [threadKey]: models } };
    }),
  setPickerTurn: (threadKey, runId) =>
    set((state) => {
      const next = { ...state.pickerTurn };
      if (runId === null) delete next[threadKey];
      else next[threadKey] = runId;
      return { pickerTurn: next };
    }),
}));
