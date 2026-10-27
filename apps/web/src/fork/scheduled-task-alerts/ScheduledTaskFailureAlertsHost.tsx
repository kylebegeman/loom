import { trackThreadNotification } from "~/components/ThreadNotificationCoordinator";
import { useClientSettings } from "~/hooks/useSettings";
import { useEnvironmentIds } from "~/state/environments";
import { ScheduledTaskFailureAlerts } from "./ScheduledTaskFailureAlerts";

export function ScheduledTaskFailureAlertsHost() {
  const environmentIds = useEnvironmentIds();
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
