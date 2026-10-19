import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { useEnvironmentServerConfig } from "../../state/entities";
import type { EnvironmentId, ScheduledTask } from "@t3tools/contracts";
import { readVaultPrompt } from "@t3tools/contracts/fork";
import { AppText as Text } from "../../components/ui/AppText";
export function VaultScheduledRecovery({
  task,
  environmentId,
}: {
  task: ScheduledTask;
  environmentId: EnvironmentId;
}) {
  const config = useEnvironmentServerConfig(environmentId);
  if (!supportsLoomFeature(config?.environment.capabilities, "vault-scheduled-outcomes"))
    return null;
  const parsed = readVaultPrompt(task.prompt);
  if (parsed.valid && !parsed.attachments.length) return null;
  return (
    <Text className="text-sm text-foreground-muted" accessibilityRole="summary">
      {task.lastRunStatus === "running"
        ? "Vault-attached run is queued or running."
        : task.lastRunStatus === "failed"
          ? task.schedule.type === "webhook"
            ? "Tap this task to review Vault attachments, then send a new webhook."
            : "Tap this task to review Vault attachments. Save changes, then choose Run now to retry."
          : task.lastRunStatus === "succeeded"
            ? "Vault-attached run completed."
            : "Vault requirements are checked at launch."}
    </Text>
  );
}
