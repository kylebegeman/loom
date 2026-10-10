import { useEffect } from "react";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { useServerConfigs } from "~/state/entities";
import { shouldReportProjectOpen } from "./openWatcher.logic";
import { FEATURE, codeGraph, runCommand } from "./state";

/** Projects reported this session, with when. */
const reported = new Map<string, number>();

/**
 * Tells the server when a project is opened so it can update a stale graph if the user turned
 * automatic updates on. The server decides; this only reports, at most every few minutes.
 */
export function CodeGraphOpenWatcher() {
  const { activeThread } = useHandleNewThread();
  const environmentId = activeThread?.environmentId ?? null;
  const projectId = activeThread?.projectId ?? null;
  const capabilities = useServerConfigs().get(environmentId ?? ("" as never))?.environment
    .capabilities;
  const enabled = loomFeaturesOf(capabilities).includes(FEATURE);

  useEffect(() => {
    if (!enabled || environmentId === null || projectId === null) return;
    if (!shouldReportProjectOpen(reported, `${environmentId}:${projectId}`, Date.now())) return;
    runCommand(codeGraph.noteProjectOpened, { environmentId, input: { projectId } }).catch(
      () => undefined,
    );
  }, [enabled, environmentId, projectId]);

  return null;
}
