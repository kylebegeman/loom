import { libraryHoldsLocalRefs, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import type { ScopedProjectRef } from "@t3tools/contracts";
import type { LibraryWorkingCopy } from "@t3tools/contracts/fork";

import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { openLibraryAction, type LibraryConversationDefaults } from "./actions";
import { projectLibrary, readLibraryAuthorityId } from "./state";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentPresentations } from "~/state/presentation";
import { libraryContextForLocalProject } from "./useLibraryNewConversation";

/**
 * Where a new conversation in a local project starts when that project is a Library project's
 * folder: that project's settings on this folder, or the chooser when the folder belongs to more
 * than one project or resource. Null for a plain local project, which starts a thread as before.
 */
export function libraryStartForLocalProject(
  ref: ScopedProjectRef,
  copies: readonly LibraryWorkingCopy[],
) {
  if (!libraryHoldsLocalRefs([], [ref], copies)) return null;
  const context = libraryContextForLocalProject(ref, copies);
  if (!context) return {};
  return {
    projectId: context.projectId,
    defaults: {
      environmentId: ref.environmentId,
      workingCopyId: context.workingCopyId,
      ...(context.resourceId ? { resourceId: context.resourceId } : {}),
    },
  };
}

/**
 * Starts a Library project's folder through the Library, which links the conversation so it
 * replicates; a bare thread there never reaches the Library. False for a plain local project.
 */
export function useLibraryLocalProjectStart() {
  return startLibraryLocalProject(useAtomQueryRunner(projectLibrary.copies, { refresh: true }));
}

/** The same start for handlers built outside React, such as the registered new-thread shortcut. */
export function createLibraryLocalProjectStart() {
  return startLibraryLocalProject(loadCopies);
}

const loadCopies = (target: Parameters<typeof projectLibrary.copies>[0]) => {
  const atom = projectLibrary.copies(target);
  return executeAtomQuery(appAtomRegistry, atom, {
    label: atom.label?.[0] ?? "atom query",
    refresh: true,
  });
};

function startLibraryLocalProject(load: typeof loadCopies) {
  return async (
    ref: ScopedProjectRef,
    current: () => boolean = () => true,
    defaults?: LibraryConversationDefaults,
  ) => {
    // Read connection state at invocation without subscribing every new-thread caller to it.
    const authorityId = readLibraryAuthorityId();
    const host = appAtomRegistry.get(environmentPresentations.presentationAtom(ref.environmentId));
    const authority = authorityId
      ? appAtomRegistry.get(environmentPresentations.presentationAtom(authorityId))
      : null;
    const connected =
      authority?.entry.enabled === true && authority.connection.phase === "connected";
    if (
      !authorityId &&
      !supportsLoomFeature(host?.serverConfig?.environment.capabilities, "project-library")
    )
      return false;
    const environmentId = connected && authorityId ? authorityId : ref.environmentId;
    if (
      environmentId === ref.environmentId &&
      (host?.connection.phase !== "connected" || !host.entry.enabled)
    ) {
      if (current()) openLibraryAction("new-conversation");
      return true;
    }
    // A missing answer is not evidence that the folder is outside the Library.
    const result = await load({ environmentId, input: {} });
    if (!current()) return true;
    if (result._tag === "Failure") {
      openLibraryAction("new-conversation");
      return true;
    }
    const start = libraryStartForLocalProject(ref, result.value);
    if (!start) return false;
    openLibraryAction("new-conversation", start.projectId, { ...defaults, ...start.defaults });
    return true;
  };
}
