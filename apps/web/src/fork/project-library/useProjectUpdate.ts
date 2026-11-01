import { validateResources } from "@t3tools/client-runtime/fork";
import * as Schema from "effect/Schema";
import { useRef, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  LibraryError,
  type LibraryUpdateProjectRequest,
  type LibraryProject,
  type LibraryProjectColor,
  type LibraryProjectProfileInput,
} from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { randomUUID } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";
import { projectLibrary, useLibraryPermission } from "./state";

const isLibraryError = Schema.is(LibraryError);

type ProjectChange = Partial<Pick<LibraryProject, "title" | "brief" | "resources">> & {
  /** Null returns the project to its automatic color. */
  readonly color?: LibraryProjectColor | null;
  /** Null removes the profile. */
  readonly profile?: LibraryProjectProfileInput | null;
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
  const pending = useRef<{ fingerprint: string; input: LibraryUpdateProjectRequest } | null>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (change: ProjectChange) => {
    if (!authorityId || saving.current) return false;
    const next = {
      title: (change.title ?? project.title).trim(),
      brief: change.brief ?? project.brief,
      resources: change.resources ?? project.resources,
    };
    const invalid = !next.title
      ? "Give the project a name."
      : change.resources === undefined
        ? null
        : validateResources(change.resources);
    if (invalid) {
      setError(invalid);
      return false;
    }
    const fingerprint = JSON.stringify({ authorityId, projectId: project.id, change });
    if (pending.current?.fingerprint !== fingerprint) {
      const { resources, ...fields } = change;
      const patchResources =
        resources !== undefined &&
        resources.length === project.resources.length &&
        resources.every((resource, index) => {
          const saved = project.resources[index]!;
          return (
            resource.id === saved.id &&
            resource.kind === saved.kind &&
            !(resource.url === undefined && saved.url !== undefined)
          );
        });
      const resourceChange =
        resources === undefined
          ? {}
          : patchResources
            ? {
                resourceUpdates: resources.flatMap((resource, index) => {
                  const saved = project.resources[index]!;
                  const patch = {
                    id: resource.id,
                    ...(resource.title === saved.title ? {} : { title: resource.title }),
                    ...(resource.remoteUrl === saved.remoteUrl
                      ? {}
                      : { remoteUrl: resource.remoteUrl }),
                    ...(resource.relativePath === saved.relativePath
                      ? {}
                      : { relativePath: resource.relativePath }),
                    ...(resource.defaultBranch === saved.defaultBranch
                      ? {}
                      : { defaultBranch: resource.defaultBranch }),
                    ...(resource.url === saved.url || resource.url === undefined
                      ? {}
                      : { url: resource.url }),
                  };
                  return Object.keys(patch).length > 1 ? [patch] : [];
                }),
              }
            : { resources };
      pending.current = {
        fingerprint,
        input: {
          requestId: randomUUID(),
          projectId: project.id,
          expectedRevision: project.revision,
          ...fields,
          ...resourceChange,
          ...(change.title === undefined ? {} : { title: next.title }),
        },
      };
    }
    const input = pending.current.input;
    saving.current = true;
    setBusy(true);
    setError(null);
    const saveProject = async () => {
      const result = await update({
        environmentId: authorityId,
        input,
      });
      if (result._tag === "Failure") {
        const cause = squashAtomCommandFailure(result);
        if (isLibraryError(cause) && cause.reason !== "io") pending.current = null;
        throw cause;
      }
      pending.current = null;
      onSaved();
      return true;
    };
    return saveProject()
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Could not save this change. Try again.");
        onSaved();
        return false;
      })
      .finally(() => {
        saving.current = false;
        setBusy(false);
      });
  };
  return {
    save,
    busy,
    error,
    clearError: () => setError(null),
    canEdit: allowed && connected && !project.archived,
  };
}
