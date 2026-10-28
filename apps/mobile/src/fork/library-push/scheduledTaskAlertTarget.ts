import { useRoute } from "@react-navigation/native";
import { EnvironmentId, ScheduledTaskId } from "@t3tools/contracts";

export function scheduledTaskAlertTarget(params: unknown) {
  if (typeof params !== "object" || params === null) return null;
  if (!("environmentId" in params) || !("taskId" in params)) return null;
  const { environmentId, taskId } = params;
  if (
    typeof environmentId !== "string" ||
    environmentId.length === 0 ||
    typeof taskId !== "string" ||
    taskId.length === 0
  )
    return null;
  return { environmentId: EnvironmentId.make(environmentId), taskId: ScheduledTaskId.make(taskId) };
}

export function useScheduledTaskAlertTarget() {
  return scheduledTaskAlertTarget(useRoute().params);
}
