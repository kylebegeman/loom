import type { ScheduledTask } from "@t3tools/contracts";
import { readVaultPrompt } from "@t3tools/contracts/fork";
import { Button } from "~/components/ui/button";
export function VaultScheduledRecovery({
  task,
  onReview,
  onRetry,
  disabled,
}: {
  task: ScheduledTask;
  onReview: () => void;
  onRetry: () => void;
  disabled: boolean;
}) {
  const parsed = readVaultPrompt(task.prompt);
  if (task.lastRunStatus !== "failed" || (parsed.valid && !parsed.attachments.length)) return null;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={disabled} onClick={onReview}>
        Review Vault attachments
      </Button>
      {task.schedule.type !== "webhook" ? (
        <Button size="sm" variant="outline" disabled={disabled} onClick={onRetry}>
          Retry task
        </Button>
      ) : (
        <span>Send a new webhook after reviewing access.</span>
      )}
    </span>
  );
}
