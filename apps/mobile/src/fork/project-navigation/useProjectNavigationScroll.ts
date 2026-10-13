import type { LegendListRef } from "@legendapp/list/react-native";
import { useCallback, useEffect, useRef, type RefObject } from "react";

import type { ProjectNavigationView } from "./useProjectNavigation";

/** Switching the library must not replace the conversation list's saved position. */
export function useProjectNavigationScroll(
  view: ProjectNavigationView,
  listRef: RefObject<LegendListRef | null>,
  topInset: number,
  initialThreadsOffset = 0,
) {
  const offsets = useRef({ threads: initialThreadsOffset, projects: 0 });
  const previousView = useRef(view);
  useEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;
    listRef.current?.scrollToOffset({ offset: offsets.current[view] - topInset, animated: false });
  }, [listRef, topInset, view]);
  const recordScrollOffset = useCallback(
    (offset: number) => {
      offsets.current[view] = Math.max(0, offset + topInset);
    },
    [view, topInset],
  );
  return recordScrollOffset;
}
