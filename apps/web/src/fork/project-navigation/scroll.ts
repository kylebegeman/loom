import { useCallback, useLayoutEffect, useRef } from "react";
import type { ProjectNavigationView } from "./preference";

export function useProjectNavigationScroll(
  view: ProjectNavigationView,
  saveView: (view: ProjectNavigationView) => void,
) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const positions = useRef<Record<ProjectNavigationView, number>>({ threads: 0, projects: 0 });

  useLayoutEffect(() => {
    const viewport = contentRef.current?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!viewport) return;
    viewport.scrollTop = positions.current[view];
    const rememberPosition = () => {
      positions.current[view] = viewport.scrollTop;
    };
    viewport.addEventListener("scroll", rememberPosition, { passive: true });
    return () => viewport.removeEventListener("scroll", rememberPosition);
  }, [view]);

  const changeView = useCallback(
    (nextView: ProjectNavigationView, options?: { resetScroll: boolean }) => {
      const viewport = contentRef.current?.closest<HTMLElement>(
        '[data-slot="scroll-area-viewport"]',
      );
      // Capture before the shorter view can clamp the shared viewport's position.
      if (viewport) positions.current[view] = viewport.scrollTop;
      if (options?.resetScroll) positions.current[nextView] = 0;
      saveView(nextView);
      if (nextView === view && options?.resetScroll && viewport) viewport.scrollTop = 0;
    },
    [saveView, view],
  );

  return { contentRef, changeView };
}
