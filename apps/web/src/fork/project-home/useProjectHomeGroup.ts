import { useMemo } from "react";
import { useClientSettings } from "~/hooks/useSettings";
import { selectProjectGroupingSettings } from "~/logicalProject";
import {
  buildSidebarProjectSnapshots,
  getSidebarProjectSettingsKey,
} from "~/sidebarProjectGrouping";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { useAllEnvironmentProjectSnapshotsReady, useProjects } from "~/state/entities";

export function useProjectHomeGroup(projectKey: string) {
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
  const group = groups.find((candidate) => candidate.projectKey === projectKey) ?? null;
  const settingsProjectKey = group ? getSidebarProjectSettingsKey(group, settings, projects) : null;
  return { group, snapshotsReady, settingsProjectKey, environments, primaryEnvironmentId };
}
