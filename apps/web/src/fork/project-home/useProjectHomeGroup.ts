import { useMemo } from "react";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { resolveProjectHomeGroup } from "./groupResolution";
import { useClientSettings } from "~/hooks/useSettings";
import { selectProjectGroupingSettings } from "~/logicalProject";
import {
  buildSidebarProjectSnapshots,
  getSidebarProjectSettingsKey,
} from "~/sidebarProjectGrouping";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { useAllEnvironmentProjectSnapshotsReady, useProjects } from "~/state/entities";

export function useProjectHomeGroup(
  projectKey: string,
  projectRef: ScopedProjectRef | null = null,
) {
  const projects = useProjects();
  const settings = useClientSettings(selectProjectGroupingSettings);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const snapshotsReady = useAllEnvironmentProjectSnapshotsReady();
  const groups = useMemo(() => {
    if (!projectKey) return [];
    const labels = new Map(
      environments.map((environment) => [environment.environmentId, environment.label]),
    );
    return buildSidebarProjectSnapshots({
      projects,
      settings,
      groupScratchProjects: true,
      primaryEnvironmentId,
      resolveEnvironmentLabel: (id) => labels.get(id) ?? null,
    });
  }, [projectKey, projects, settings, primaryEnvironmentId, environments]);
  const resolved = resolveProjectHomeGroup({ groups, projectKey, projectRef });
  const { group } = resolved;
  const settingsProjectKey = group
    ? getSidebarProjectSettingsKey(group, settings, projects, resolved.projectRef ?? undefined)
    : null;
  return {
    group,
    resolvedProjectRef: resolved.projectRef,
    snapshotsReady,
    settingsProjectKey,
    environments,
    primaryEnvironmentId,
  };
}
