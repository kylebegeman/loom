import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage, type StateStorage } from "~/lib/storage";

export interface OutlineSource {
  readonly threadRef: ScopedThreadRef;
  readonly path: string;
  readonly contents: string;
  readonly truncated: boolean;
}
interface FileOutlineState {
  readonly open: boolean;
  readonly sources: Readonly<Record<string, OutlineSource>>;
  readonly focusRequestId: number;
  readonly toggle: () => void;
  readonly publish: (threadKey: string, source: OutlineSource) => void;
  readonly unpublish: (threadKey: string, path: string) => void;
}

function browserStorage() {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** Storage failures fall back to a usable in-memory preference, including private browsing. */
export function createFileOutlineStore(storage: StateStorage | undefined = browserStorage()) {
  const resolved = resolveStorage(storage);
  const safeStorage: StateStorage = {
    getItem: (name) => {
      try {
        return resolved.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        resolved.setItem(name, value);
      } catch {
        /* Keep session state. */
      }
    },
    removeItem: (name) => {
      try {
        resolved.removeItem(name);
      } catch {
        /* Keep session state. */
      }
    },
  };
  return create<FileOutlineState>()(
    persist(
      (set) => ({
        open: false,
        sources: {},
        focusRequestId: 0,
        toggle: () =>
          set((state) => ({
            open: !state.open,
            focusRequestId: state.focusRequestId + (state.open ? 0 : 1),
          })),
        publish: (threadKey, source) =>
          set((state) => {
            const previous = state.sources[threadKey];
            if (
              previous?.path === source.path &&
              previous.contents === source.contents &&
              previous.truncated === source.truncated
            )
              return state;
            return { sources: { ...state.sources, [threadKey]: source } };
          }),
        unpublish: (threadKey, path) =>
          set((state) => {
            if (state.sources[threadKey]?.path !== path) return state;
            const sources = { ...state.sources };
            delete sources[threadKey];
            return { sources };
          }),
      }),
      {
        name: "loom:file-outline:open:v1",
        storage: createJSONStorage(() => safeStorage),
        partialize: ({ open }) => ({ open }),
        merge: (persisted, current) => ({
          ...current,
          open:
            typeof persisted === "object" &&
            persisted !== null &&
            "open" in persisted &&
            persisted.open === true,
        }),
      },
    ),
  );
}
export const useFileOutlineStore = createFileOutlineStore();
