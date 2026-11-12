import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { isBotRunThreadId } from "@t3tools/contracts/fork";
import {
  projectThreadAwarenessV2,
  type ProjectThreadAwarenessV2Input,
} from "@t3tools/shared/agentAwareness";

export const isInternalNotificationThread = (
  thread: Pick<OrchestrationV2ThreadShell, "id" | "delegatedFrom">,
): boolean => isBotRunThreadId(thread.id) || thread.delegatedFrom !== undefined;

export function projectThreadNotificationAwareness(
  input: ProjectThreadAwarenessV2Input & {
    readonly thread: ProjectThreadAwarenessV2Input["thread"] &
      Pick<OrchestrationV2ThreadShell, "delegatedFrom">;
  },
) {
  const state = projectThreadAwarenessV2(input);
  if (state === null || !isInternalNotificationThread(input.thread)) return state;
  // Internal outcomes return to their caller; only a person's decision needs a phone alert.
  if (state.phase !== "waiting_for_approval" && state.phase !== "waiting_for_input") return null;
  return state;
}
