import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type {
  LibraryThreadBinding,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";

type ConversationIdentity = {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly id: ThreadId;
};

export function conversationLibraryContext(
  thread: ConversationIdentity,
  binding: LibraryThreadBinding | null,
  saved: LibraryThreadSummary | null,
) {
  const summary =
    saved?.environmentId === thread.environmentId &&
    saved.threadId === thread.id &&
    saved.localProjectId === thread.projectId
      ? saved
      : null;
  if (binding) {
    if (binding.environmentId !== thread.environmentId) return null;
    return {
      projectId: binding.projectId,
      workingCopyId: binding.workingCopyId,
      archiveId:
        summary?.projectId === binding.projectId && summary.workingCopyId === binding.workingCopyId
          ? summary.id
          : null,
    };
  }
  return summary
    ? {
        projectId: summary.projectId,
        workingCopyId: summary.workingCopyId,
        archiveId: summary.id,
      }
    : null;
}

export function conversationWorkingCopy(
  thread: ConversationIdentity,
  cwd: string | null,
  context: NonNullable<ReturnType<typeof conversationLibraryContext>>,
  copies: readonly LibraryWorkingCopy[],
) {
  if (!cwd) return null;
  return (
    copies.find(
      (copy) =>
        copy.id === context.workingCopyId &&
        copy.projectId === context.projectId &&
        copy.environmentId === thread.environmentId &&
        ((copy.rootLocalProjectId === thread.projectId && copy.rootPath === cwd) ||
          copy.repositories.some(
            (repository) =>
              repository.localProjectId === thread.projectId && repository.path === cwd,
          )),
    ) ?? null
  );
}
