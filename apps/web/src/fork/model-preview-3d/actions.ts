import type { ScopedThreadRef } from "@t3tools/contracts";
export type ModelAction = "capture" | "capture-four" | "rerender";
const listeners = new Set<{ ref: ScopedThreadRef; callback: (action: ModelAction) => void }>();
export function onModelAction(ref: ScopedThreadRef, callback: (action: ModelAction) => void) {
  const entry = { ref, callback };
  listeners.add(entry);
  return () => {
    listeners.delete(entry);
  };
}
export function dispatchModelAction(ref: ScopedThreadRef, action: ModelAction) {
  for (const entry of listeners)
    if (entry.ref.threadId === ref.threadId && entry.ref.environmentId === ref.environmentId)
      entry.callback(action);
}
