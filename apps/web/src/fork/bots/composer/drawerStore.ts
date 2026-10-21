import { create } from "zustand";

/** The bot whose run form is open above a thread's composer. In memory only. */
export const useBotRunDrawerStore = create<{
  readonly open: { readonly threadKey: string; readonly botId: string } | null;
  readonly show: (threadKey: string, botId: string) => void;
  readonly close: () => void;
}>()((set) => ({
  open: null,
  show: (threadKey, botId) => set({ open: { threadKey, botId } }),
  close: () => set({ open: null }),
}));
