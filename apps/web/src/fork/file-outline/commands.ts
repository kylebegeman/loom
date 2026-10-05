import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { selectActiveRightPanelSurface, useRightPanelStore } from "~/rightPanelStore";
import { useFileOutlineStore } from "./store";

export function activeOutlineSource(threadRef: ScopedThreadRef | null) {
  if (!threadRef) return null;
  const surface = selectActiveRightPanelSurface(
    useRightPanelStore.getState().byThreadKey,
    threadRef,
  );
  const source = useFileOutlineStore.getState().sources[scopedThreadKey(threadRef)];
  return surface?.kind === "file" && source?.path === surface.relativePath ? source : null;
}
