import { create } from "zustand";

/** Whether the header card is showing. In memory only; the button and the shortcut share it. */
export const useInspectorCardStore = create<{
  readonly open: boolean;
  readonly toggle: () => void;
  readonly close: () => void;
}>()((set) => ({
  open: false,
  toggle: () => set((state) => ({ open: !state.open })),
  close: () => set({ open: false }),
}));
