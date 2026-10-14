import { useMemo } from "react";
import { useLocation, useParams } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { projectHomeDestinationFromSearch, validateProjectHomeSearch } from "./routeSearch";
import { useProjectHomeGroup } from "./useProjectHomeGroup";

/** Palette project actions follow the current home instead of the first catalog project. */
export function useProjectHomePaletteContext() {
  const projectKey = useParams({
    strict: false,
    select: (params) => (typeof params.projectKey === "string" ? params.projectKey : null),
  });
  const search = useLocation({ select: (location) => location.search });
  const { group, settingsProjectKey } = useProjectHomeGroup(projectKey ?? "");
  return useMemo(() => {
    const chosen = projectHomeDestinationFromSearch(validateProjectHomeSearch(search));
    return group
      ? {
          group,
          settingsProjectKey,
          projectRef: chosen ?? scopeProjectRef(group.environmentId, group.id),
        }
      : null;
  }, [group, settingsProjectKey, search]);
}
