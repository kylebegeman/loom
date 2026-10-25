import { libraryHoldsLocalRefs } from "@t3tools/client-runtime/fork";
import type { ScopedProjectRef } from "@t3tools/contracts";
import type { LibraryWorkingCopy } from "@t3tools/contracts/fork";

import { useEnvironmentQuery } from "~/state/query";
import { openLibraryAction } from "./actions";
import { projectLibrary, useLibraryAuthority } from "./state";
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
  const { authorityId } = useLibraryAuthority();
  // Shared with the sidebar's Library filter, so it is normally loaded already. Until it loads, a
  // folder starts as a plain local project, as iPhone's New task also lists it.
  const copies = useEnvironmentQuery(
    authorityId ? projectLibrary.copies({ environmentId: authorityId, input: {} }) : null,
  );
  return (ref: ScopedProjectRef) => {
    const start = libraryStartForLocalProject(ref, copies.data ?? []);
    if (!start) return false;
    openLibraryAction("new-conversation", start.projectId, start.defaults);
    return true;
  };
}
