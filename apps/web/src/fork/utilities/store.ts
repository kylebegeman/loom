import { create } from "zustand";

import { resolveStorage } from "~/lib/storage";
import { UTILITY_RECENT_LIMIT, findUtilityToolMeta } from "./registry-meta";
import type { UtilityOptionValues, UtilityResult } from "./types";

const RECENT_STORAGE_KEY = "loom:utilities:recent:v1";

export interface UtilityDraft {
  readonly text: string;
  readonly second: string;
  readonly options: UtilityOptionValues;
}

export interface UtilityGenerated {
  readonly result: UtilityResult;
  /** The options the result was generated with, so the view can say when they changed. */
  readonly options: UtilityOptionValues;
}

interface UtilitiesState {
  readonly selectedToolId: string | null;
  readonly dialogOpen: boolean;
  /** Per tool, in memory only: inputs can hold secrets, so nothing typed is ever persisted. */
  readonly drafts: Readonly<Record<string, UtilityDraft>>;
  readonly generated: Readonly<Record<string, UtilityGenerated>>;
  readonly recent: ReadonlyArray<string>;
  readonly select: (toolId: string) => void;
  readonly setDraft: (toolId: string, draft: UtilityDraft) => void;
  readonly setGenerated: (toolId: string, generated: UtilityGenerated) => void;
  readonly openDialog: () => void;
  readonly closeDialog: () => void;
}

function resolveRecentStorage() {
  try {
    return resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined);
  } catch {
    // Reading `localStorage` throws where site data is blocked.
    return resolveStorage(undefined);
  }
}

const storage = resolveRecentStorage();

function readRecent(): ReadonlyArray<string> {
  try {
    const raw = storage.getItem(RECENT_STORAGE_KEY);
    if (typeof raw !== "string") return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((id): id is string => typeof id === "string" && findUtilityToolMeta(id) !== null)
      .slice(0, UTILITY_RECENT_LIMIT);
  } catch {
    return [];
  }
}

function writeRecent(recent: ReadonlyArray<string>) {
  try {
    storage.setItem(RECENT_STORAGE_KEY, JSON.stringify(recent));
  } catch {
    // Private windows and full quotas lose the recent list, nothing else.
  }
}

export const useUtilitiesStore = create<UtilitiesState>()((set, get) => ({
  selectedToolId: null,
  dialogOpen: false,
  drafts: {},
  generated: {},
  recent: readRecent(),
  select: (toolId) => {
    if (findUtilityToolMeta(toolId) === null) return;
    const recent = [toolId, ...get().recent.filter((id) => id !== toolId)].slice(
      0,
      UTILITY_RECENT_LIMIT,
    );
    writeRecent(recent);
    set({ selectedToolId: toolId, recent });
  },
  setDraft: (toolId, draft) => set((state) => ({ drafts: { ...state.drafts, [toolId]: draft } })),
  setGenerated: (toolId, generated) =>
    set((state) => ({ generated: { ...state.generated, [toolId]: generated } })),
  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),
}));
