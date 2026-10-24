import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { noProjectTargetEnvironmentId, noProjectWorkspaceRoot } from "@t3tools/client-runtime/fork"; // fork: no-project-first
import { availableScratchWorkspaceRoot } from "@t3tools/client-runtime/operations/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments"; // fork: no-project-first
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";
import { useNewThreadHandler } from "./useHandleNewThread";

function reportScratchFailure(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

export function useScratchProject() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId(); // fork: no-project-first
  const openScratch = useAtomCommand(projectEnvironment.openScratch, { reportFailure: false });
  const handleNewThread = useNewThreadHandler();

  const scratchWorkspaceRootFor = (environmentId: EnvironmentId | null): string | null => {
    const environment = environments.find((entry) => entry.environmentId === environmentId);
    return availableScratchWorkspaceRoot(environment?.connection.phase, environment?.serverConfig);
  };

  // fork: no-project-first: current, then primary, then the first by name that can run work.
  // The Library advertises a scratch folder too, so it is never a target.
  const scratchEnvironmentId = (current: EnvironmentId | null): EnvironmentId | null =>
    noProjectTargetEnvironmentId({
      environments: environments.toSorted((a, b) => a.label.localeCompare(b.label)),
      canRun: (entry) =>
        noProjectWorkspaceRoot(entry.connection.phase, entry.serverConfig) !== null,
      preferred: [current, primaryEnvironmentId],
    });

  const openScratchProject = async (
    environmentId: EnvironmentId,
    failureTitle = "Could not start without a project",
  ): Promise<EnvironmentProject | null> => {
    const result = await openScratch({ environmentId, input: {} });
    if (result._tag === "Success") return result.value;
    if (!isAtomCommandInterrupted(result)) {
      reportScratchFailure(failureTitle, squashAtomCommandFailure(result));
    }
    return null;
  };

  const startScratchThread = async (environmentId: EnvironmentId) => {
    const project = await openScratchProject(environmentId);
    if (project) {
      await handleNewThread(scopeProjectRef(project.environmentId, project.id)).catch(
        (error: unknown) => reportScratchFailure("Could not start without a project", error),
      );
    }
  };

  return { scratchWorkspaceRootFor, scratchEnvironmentId, openScratchProject, startScratchThread };
}
