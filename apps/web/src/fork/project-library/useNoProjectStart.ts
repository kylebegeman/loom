import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { useScratchProject } from "~/hooks/useScratchProject";
import { useEnvironment } from "~/state/environments";

/**
 * Starting without a project from a Library surface. It prefers the open thread's computer, like
 * the command palette, and is null when no connected computer can run work.
 */
export function useNoProjectStart() {
  const { activeDraftThread, activeThread } = useHandleNewThread();
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  const environmentId = scratchEnvironmentId(
    activeThread?.environmentId ?? activeDraftThread?.environmentId ?? null,
  );
  const label = useEnvironment(environmentId)?.label;
  if (environmentId === null) return null;
  return {
    label: label ?? environmentId,
    start: () => startScratchThread(environmentId),
  };
}
