import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useProjects } from "~/state/entities";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useClientSettings } from "~/hooks/useSettings";
import { useStableCallback } from "~/hooks/useStableCallback";
import {
  deriveLogicalProjectKeyFromSettings,
  derivePhysicalProjectKey,
  selectProjectGroupingSettings,
} from "~/logicalProject";
import { buildPhysicalToLogicalProjectKeyMap } from "~/sidebarProjectGrouping";
import { toastManager } from "~/components/ui/toast";
import { useRouteThread } from "../routeThread";
import { onProfileAction, profileError } from "./state";
import { forkSettingsTarget } from "../settings/navigation";
import { useRunProfileCommand } from "./runInTerminal";
function ActiveCommandHost({ threadRef }: { threadRef: ScopedThreadRef }) {
  const run = useRunProfileCommand(threadRef);
  const handle = useStableCallback(
    async (intent: import("@t3tools/contracts/fork").CommandIntent) => {
      try {
        await run({ intent });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Command could not start",
          description: profileError(error),
        });
      }
    },
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the module bus for run actions on this thread and unsubscribes on unmount
  useEffect(
    () =>
      onProfileAction((action) => {
        if (
          action.kind === "run" &&
          action.threadRef.environmentId === threadRef.environmentId &&
          action.threadRef.threadId === threadRef.threadId
        )
          void handle(action.intent);
      }),
    [threadRef.environmentId, threadRef.threadId, handle],
  );
  return null;
}
export function ProjectProfileHost() {
  const navigate = useNavigate();
  const projects = useProjects();
  const grouping = useClientSettings(selectProjectGroupingSettings);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const route = useRouteThread();
  const edit = useStableCallback(
    (
      environmentId: import("@t3tools/contracts").EnvironmentId,
      projectId: import("@t3tools/contracts").ProjectId,
    ) => {
      const project = projects.find(
        (project) => project.environmentId === environmentId && project.id === projectId,
      );
      if (!project) return;
      const keys = buildPhysicalToLogicalProjectKeyMap({
        projects,
        settings: grouping,
        primaryEnvironmentId,
      });
      const key =
        keys.get(derivePhysicalProjectKey(project)) ??
        deriveLogicalProjectKeyFromSettings(project, grouping);
      void navigate({
        ...forkSettingsTarget("project-profiles"),
        search: {
          project: key,
          machine: environmentId,
          checkout: derivePhysicalProjectKey(project),
        },
      });
    },
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the module bus for profile edit actions and unsubscribes on unmount
  useEffect(
    () =>
      onProfileAction((action) => {
        if (action.kind === "edit") edit(action.environmentId, action.projectId);
      }),
    [edit],
  );
  return route && !route.isDraft ? <ActiveCommandHost threadRef={route.threadRef} /> : null;
}
