import { libraryCopiesForScope } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  LibraryProject,
  LibraryReopenCopyRequest,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";

/** Whole-project work cannot silently inherit repositories removed from the shared project. */
export function libraryLaunchCopyMatchesScope(
  project: LibraryProject,
  copy: LibraryWorkingCopy,
  resourceId: string | null,
) {
  return (
    (resourceId !== null ||
      copy.repositories.length ===
        project.resources.filter((resource) => resource.kind !== "link").length) &&
    libraryCopiesForScope(
      project,
      [
        {
          ...copy,
          state: "ready",
          registered:
            copy.state === "released" && copy.ownership === "managed" && copy.recovery
              ? true
              : copy.registered,
        },
      ],
      copy.environmentId,
      resourceId === null ? null : [resourceId],
    ).length > 0
  );
}

export function libraryLaunchCopiesForScope(
  project: LibraryProject,
  copies: readonly LibraryWorkingCopy[],
  environmentId: EnvironmentId | null,
  resourceId: string | null,
  allowReopen: boolean,
) {
  return copies.filter(
    (copy) =>
      copy.environmentId === environmentId &&
      (copy.state === "ready" ||
        (copy.state === "released" && copy.ownership === "managed" && allowReopen)) &&
      libraryLaunchCopyMatchesScope(project, copy, resourceId),
  );
}

const normalizedRoot = (root: string) => {
  const normalized = root.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:/i.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
};
const containsRoot = (parent: string, child: string) => {
  const a = normalizedRoot(parent),
    b = normalizedRoot(child);
  return a === b || b.startsWith(`${a}/`);
};
export const libraryLaunchPathOverlaps = (left: string, right: string) =>
  containsRoot(left, right) || containsRoot(right, left);

export async function restoreLibraryLaunchCopy(
  copy: LibraryWorkingCopy,
  requestId: string,
  reopen: (input: {
    environmentId: EnvironmentId;
    input: LibraryReopenCopyRequest;
  }) => Promise<LibraryWorkingCopy>,
) {
  const restored = await reopen({
    environmentId: copy.environmentId,
    input: { requestId, workingCopyId: copy.id },
  });
  if (
    restored.id !== copy.id ||
    restored.environmentId !== copy.environmentId ||
    restored.projectId !== copy.projectId ||
    restored.rootPath !== copy.rootPath ||
    restored.ownership !== "managed" ||
    restored.state !== "ready" ||
    restored.registered === false
  )
    throw new Error("The restored files do not match this conversation's saved project files.");
  return restored;
}
