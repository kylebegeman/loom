// fork: webhook-delivery-issues
import { scheduledTaskDeliveryIssueText } from "@t3tools/client-runtime/fork";
import type { ScheduledTaskDeliveryIssue } from "@t3tools/contracts";

import { webhookDeliveryLabel } from "~/components/settings/scheduledTasksSettings.logic";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useNowMinute } from "~/hooks/useNowMinute";

export function WebhookDeliveryIssue({
  issue,
  onReview,
}: {
  readonly issue: ScheduledTaskDeliveryIssue;
  readonly onReview: () => void;
}) {
  const now = Date.parse(`${useNowMinute()}:00.000Z`);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge variant="error">{webhookDeliveryLabel(issue)}</Badge>
      <span className="text-destructive">{scheduledTaskDeliveryIssueText(issue, now)}</span>
      <Button size="sm" variant="outline" onClick={onReview}>
        Review deliveries
      </Button>
    </span>
  );
}
