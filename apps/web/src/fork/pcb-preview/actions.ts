import type { ScopedThreadRef } from "@t3tools/contracts";
export type PcbAction = "sweep" | "history" | "history-previous" | "history-next";
const listeners = new Set<{ ref: ScopedThreadRef; callback: (action: PcbAction) => void }>();
export function onPcbAction(ref: ScopedThreadRef, callback: (action: PcbAction) => void) {
  const entry = { ref, callback };
  listeners.add(entry);
  return () => {
    listeners.delete(entry);
  };
}
export function dispatchPcbAction(ref: ScopedThreadRef, action: PcbAction) {
  for (const entry of listeners)
    if (entry.ref.environmentId === ref.environmentId && entry.ref.threadId === ref.threadId)
      entry.callback(action);
}
