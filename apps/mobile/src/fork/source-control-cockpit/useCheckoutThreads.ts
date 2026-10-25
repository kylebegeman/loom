import { useAtomValue } from "@effect/atom-react";
import { environmentThreadShells } from "../../state/threads";
import { useThreadSelection } from "../../state/use-thread-selection";
import { useSelectedThreadWorktree } from "../../state/use-selected-thread-worktree";

export function useCheckoutThreads() {
  const { selectedThread, selectedThreadProject: project } = useThreadSelection();
  const { selectedThreadCwd } = useSelectedThreadWorktree();
  const threads = useAtomValue(
    environmentThreadShells.threadShellsForProjectRefsAtom(
      project ? [{ environmentId: project.environmentId, projectId: project.id }] : [],
    ),
  );
  const sharing = threads.filter(
    (thread) => (thread.worktreePath ?? project?.workspaceRoot) === selectedThreadCwd,
  );
  return {
    otherCount: sharing.filter((thread) => thread.id !== selectedThread?.id).length,
    busy: sharing.some((thread) => thread.runtime?.activeRunId != null),
  };
}
