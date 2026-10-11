import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
const listeners = new Map<string, () => void>();
export function onRequestPcbChange(thread: ScopedThreadRef, listener: () => void) {
  const key = scopedThreadKey(thread);
  listeners.set(key, listener);
  return () => {
    if (listeners.get(key) === listener) listeners.delete(key);
  };
}
export function requestPcbChange(thread: ScopedThreadRef) {
  listeners.get(scopedThreadKey(thread))?.();
}
