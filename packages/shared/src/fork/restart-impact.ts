import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";

/**
 * Pull request watches come back from the thread's links when its server starts, so a restart
 * does not stop them. This is the task id prefix the shared pending-work roster gives them.
 */
const PULL_REQUEST_WATCH_TASK_PREFIX = "pull-request-watch:";

export type RestartImpactThread = Pick<
  OrchestrationV2ThreadShell,
  "title" | "status" | "activityRunStatus" | "pendingBackgroundTasks"
>;

/**
 * The shell's status skips held queues, so a queued run here is one that would otherwise start,
 * and a waiting run is still capturing its checkpoint. A settled turn counts when work that holds
 * its completion would stop: a subagent, a background task, or a command or monitor it awaits.
 */
export function threadRestartImpact(thread: RestartImpactThread): "working" | "background" | null {
  if (
    thread.activityRunStatus != null ||
    thread.status === "preparing" ||
    thread.status === "queued" ||
    thread.status === "starting" ||
    thread.status === "running" ||
    thread.status === "waiting"
  ) {
    return "working";
  }
  const stopping = (thread.pendingBackgroundTasks ?? []).filter(
    (task) => !task.taskId.startsWith(PULL_REQUEST_WATCH_TASK_PREFIX),
  );
  return backgroundWorkHoldsCompletion(stopping) ? "background" : null;
}
