import { useCallback, useEffect, useState } from "react";
import { resolveLoomNavigatorView, type LoomNavigatorView } from "@t3tools/client-runtime/fork";

export type ProjectNavigationView = LoomNavigatorView;
export const PROJECT_NAVIGATION_VIEW_KEY = "loom:project-navigation:view:v1";
const VIEW_CHANGE_EVENT = "loom:project-navigation-view-changed";

export function decodeProjectNavigationView(value: unknown): ProjectNavigationView {
  return resolveLoomNavigatorView(value);
}

export function readProjectNavigationView(
  storage: Pick<Storage, "getItem"> | null,
): ProjectNavigationView {
  try {
    return decodeProjectNavigationView(storage?.getItem(PROJECT_NAVIGATION_VIEW_KEY));
  } catch {
    return "threads";
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function useProjectNavigationView() {
  const [view, setView] = useState(() => readProjectNavigationView(browserStorage()));
  useEffect(() => {
    const handleViewChange = (event: Event) => {
      if (event instanceof StorageEvent) {
        if (event.key !== null && event.key !== PROJECT_NAVIGATION_VIEW_KEY) return;
        setView(readProjectNavigationView(browserStorage()));
      } else if (event instanceof CustomEvent) {
        setView(decodeProjectNavigationView(event.detail));
      }
    };
    window.addEventListener("storage", handleViewChange);
    window.addEventListener(VIEW_CHANGE_EVENT, handleViewChange);
    return () => {
      window.removeEventListener("storage", handleViewChange);
      window.removeEventListener(VIEW_CHANGE_EVENT, handleViewChange);
    };
  }, []);

  const saveView = useCallback((nextView: ProjectNavigationView) => {
    setView(nextView);
    try {
      browserStorage()?.setItem(PROJECT_NAVIGATION_VIEW_KEY, nextView);
    } catch {
      // Browsing still works when private browsing or a full disk blocks persistence.
    }
    window.dispatchEvent(new CustomEvent(VIEW_CHANGE_EVENT, { detail: nextView }));
  }, []);
  return [view, saveView] as const;
}
