import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

export type CodeGraphTab = "overview" | "search" | "impact";

/** Files the diff panel asked about. Without one, Impact uses the checkout's uncommitted changes. */
export interface ImpactRequest {
  readonly files: ReadonlyArray<string>;
  readonly scopeLabel: string;
}

interface ThreadView {
  readonly tab: CodeGraphTab;
  readonly impact: ImpactRequest | null;
  /** The node the Search tab shows the neighborhood of. */
  readonly focusId: string | null;
}

const EMPTY: ThreadView = { tab: "overview", impact: null, focusId: null };

/** Each thread's code map view, kept while the panel is closed so the diff header can steer it. */
export const useCodeGraphViewStore = create<{
  readonly byThread: Readonly<Record<string, ThreadView>>;
  readonly update: (threadRef: ScopedThreadRef, patch: Partial<ThreadView>) => void;
}>()((set) => ({
  byThread: {},
  update: (threadRef, patch) =>
    set((state) => {
      const key = scopedThreadKey(threadRef);
      return {
        byThread: { ...state.byThread, [key]: { ...(state.byThread[key] ?? EMPTY), ...patch } },
      };
    }),
}));

export const viewOf = (
  byThread: Readonly<Record<string, ThreadView>>,
  threadRef: ScopedThreadRef,
) => byThread[scopedThreadKey(threadRef)] ?? EMPTY;
