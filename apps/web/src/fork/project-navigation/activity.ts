import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentServerConfig } from "@t3tools/client-runtime/connection";
import { resolveSidebarThreadStatus } from "~/components/Sidebar.logic";

export type ProjectThreadActivity = ReturnType<typeof resolveProjectThreadActivity>;

export function resolveProjectThreadActivity(
  thread: EnvironmentThreadShell,
  config: EnvironmentServerConfig | undefined,
  now: string,
) {
  if (config?.environment.capabilities.threadSnooze && effectiveSnoozed(thread, { now })) {
    return "snoozed" as const;
  }
  if (config?.environment.capabilities.threadSettlement && thread.settledOverride === "settled") {
    return "settled" as const;
  }
  const status = resolveSidebarThreadStatus(thread);
  switch (status) {
    case "approval":
    case "input":
    case "paused":
      return "attention" as const;
    case "working":
    case "waiting":
      return "working" as const;
    case "failed":
    case "limited":
      return "failed" as const;
    default:
      return "ready" as const;
  }
}
