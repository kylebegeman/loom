import { useAtomValue } from "@effect/atom-react";
import { trackThreadNotification } from "~/components/ThreadNotificationCoordinator";
import { useClientSettings } from "~/hooks/useSettings";
import { environmentSummaries } from "~/state/presentation";
import { ScheduledTaskFailureAlerts } from "./ScheduledTaskFailureAlerts";

export function ScheduledTaskFailureAlertsHost() {
  const environmentIds = useAtomValue(environmentSummaries.environmentIdsAtom);
  const enabled = useClientSettings(
    (settings) => settings.notificationMode !== "off" || settings.inAppNotificationsEnabled,
  );
  if (!enabled) return null;
  return environmentIds.map((environmentId) => (
    <ScheduledTaskFailureAlerts
      key={environmentId}
      environmentId={environmentId}
      onNotification={trackThreadNotification}
    />
  ));
}
