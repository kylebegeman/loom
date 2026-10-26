// fork: webhook-delivery-issues
import type { ScheduledTaskDeliveryIssue } from "@t3tools/contracts";
import { directoryAgeText } from "./directory.ts";

/** For example "Webhook delivery refused 5 min ago: The signature was missing or ..." */
export function scheduledTaskDeliveryIssueText(
  issue: ScheduledTaskDeliveryIssue,
  now: number,
): string {
  const verb =
    issue.outcome === "rejected_signature" || issue.outcome === "expired" ? "refused" : "failed";
  const ago = (at: string) => directoryAgeText(now - Date.parse(at));
  return issue.count === 1
    ? `Webhook delivery ${verb} ${ago(issue.lastAt)}: ${issue.reason}`
    : `${issue.count} webhook deliveries refused or failed, the first ${ago(issue.firstAt)}. The latest was ${verb} ${ago(issue.lastAt)}: ${issue.reason}`;
}
