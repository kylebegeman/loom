import type { ScopedThreadRef } from "@t3tools/contracts";
export type ModelAction =
  | "capture"
  | "capture-four"
  | "rerender"
  | "toggle-units"
  | "copy-view"
  | "save-view"
  | "toggle-overhangs";
const listeners = new Set<{
  ref: ScopedThreadRef;
  callback: (action: ModelAction) => void;
  getOverhangs: (() => boolean) | undefined;
}>();
export function onModelAction(
  ref: ScopedThreadRef,
  callback: (action: ModelAction) => void,
  getOverhangs?: () => boolean,
) {
  const entry = { ref, callback, getOverhangs };
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

/** Palette labels read the visible panel when the palette opens. */
export function modelOverhangsShown(ref: ScopedThreadRef): boolean {
  for (const entry of listeners)
    if (entry.ref.threadId === ref.threadId && entry.ref.environmentId === ref.environmentId)
      return entry.getOverhangs?.() ?? false;
  return false;
}
