import { resolveLoomNavigatorView, type LoomNavigatorView } from "@t3tools/client-runtime/fork";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useCallback } from "react";

import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";

export type ProjectNavigationView = LoomNavigatorView;

/** Both adaptive navigation surfaces read the same optimistic device preference. */
export function useProjectNavigation() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const view: ProjectNavigationView = resolveLoomNavigatorView(
    AsyncResult.isSuccess(preferences) ? preferences.value.loomNavigationView : undefined,
  );
  const setView = useCallback(
    (next: ProjectNavigationView) => savePreferences({ loomNavigationView: next }),
    [savePreferences],
  );
  const title = view === "projects" ? "Computer folders" : "Computer conversations";
  const searchLabel = view === "projects" ? "Search computer folders" : "Search conversations";
  const searchPlaceholder =
    view === "projects" ? "Search folders and conversations" : "Search conversations";
  return { view, setView, title, searchLabel, searchPlaceholder } as const;
}
