import { resolveLoomNavigatorView, type LoomNavigatorView } from "@t3tools/client-runtime/fork";
import { useAtomSet } from "@effect/atom-react";
import { useCallback } from "react";

import { updateMobilePreferencesAtom } from "../../state/preferences";

export type ProjectNavigationView = LoomNavigatorView;

/** Thread navigation ignores the retired Threads/Projects view preference. */
export function useProjectNavigation() {
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const view = resolveLoomNavigatorView("threads");
  const setView = useCallback(
    (next: ProjectNavigationView) => savePreferences({ loomNavigationView: next }),
    [savePreferences],
  );
  const title = "Threads";
  const searchLabel = "Search threads";
  const searchPlaceholder = "Search threads";
  return { view, setView, title, searchLabel, searchPlaceholder } as const;
}
