import { useEffect } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useRightPanelStore } from "~/rightPanelStore";
const eventName = "loom:panel-presentation";
type Request = {
  threadRef: ScopedThreadRef;
  maximized: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
};
export function requestPanelPresentation(threadRef: ScopedThreadRef, maximized: boolean) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The thread panel did not acknowledge its presentation change.")),
      2000,
    );
    window.dispatchEvent(
      new CustomEvent<Request>(eventName, {
        detail: {
          threadRef,
          maximized,
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        },
      }),
    );
  });
}
export function useForkPanelPresentation(threadRef: ScopedThreadRef | null, available: boolean) {
  useEffect(() => {
    const onRequest = (event: Event) => {
      const request = (event as CustomEvent<Request>).detail;
      if (!threadRef || scopedThreadKey(threadRef) !== scopedThreadKey(request.threadRef)) return;
      if (!available) {
        request.reject(new Error("This window is too narrow to maximize the panel."));
        return;
      }
      useRightPanelStore.getState().setMaximized(threadRef, request.maximized);
      request.resolve();
    };
    window.addEventListener(eventName, onRequest);
    return () => window.removeEventListener(eventName, onRequest);
  }, [threadRef, available]);
}
