import { validateResources } from "@t3tools/client-runtime/fork";
import { useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { LibraryProject, LibraryProjectColor } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { randomUUID } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";
import { projectLibrary, useLibraryPermission } from "./state";

type ProjectChange = Partial<Pick<LibraryProject, "title" | "brief" | "resources">> & {
  /** Null returns the project to its automatic color. */
  readonly color?: LibraryProjectColor | null;
};

/**
 * Saves one in-place edit against the revision on screen. A conflict reports and refreshes
 * rather than overwriting someone else's change, so each edit stays small and retryable.
 */
export function useProjectUpdate({
  project,
  authorityId,
  connected,
  onSaved,
}: {
  readonly project: LibraryProject;
  readonly authorityId: EnvironmentId | null;
  readonly connected: boolean;
  readonly onSaved: () => void;
}) {
  const update = useAtomCommand(projectLibrary.updateProject, { reportFailure: false });
  const allowed = useLibraryPermission(projectLibrary.updateProject, authorityId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (change: ProjectChange) => {
    if (!authorityId || busy) return false;
    const next = {
      title: (change.title ?? project.title).trim(),
      brief: change.brief ?? project.brief,
      resources: change.resources ?? project.resources,
    };
    const invalid = next.title ? validateResources(next.resources) : "Give the project a name.";
    if (invalid) {
      setError(invalid);
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await update({
        environmentId: authorityId,
        input: {
          requestId: randomUUID(),
          projectId: project.id,
          expectedRevision: project.revision,
          ...next,
          ...(change.color !== undefined ? { color: change.color } : {}),
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      onSaved();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this change. Try again.");
      onSaved();
      return false;
    } finally {
      setBusy(false);
    }
  };
  return {
    save,
    busy,
    error,
    clearError: () => setError(null),
    canEdit: allowed && connected && !project.archived,
  };
}
