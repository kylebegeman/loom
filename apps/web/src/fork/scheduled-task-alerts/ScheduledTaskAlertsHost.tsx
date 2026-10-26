import { useClientSettings } from "~/hooks/useSettings";
import { useEnvironmentIds } from "~/state/environments";
import { trackForkNotification } from "../respectful-notifications/notificationTracking";
import { ScheduledTaskFailureAlerts } from "./ScheduledTaskFailureAlerts";

/** Watches every connected computer's scheduled tasks while any notification channel is on. */
export function ScheduledTaskAlertsHost() {
  const environmentIds = useEnvironmentIds();
  const enabled = useClientSettings(
    (settings) => settings.notificationMode !== "off" || settings.inAppNotificationsEnabled,
  );
  if (!enabled) return null;
  return environmentIds.map((environmentId) => (
    <ScheduledTaskFailureAlerts
      key={environmentId}
      environmentId={environmentId}
      onNotification={trackForkNotification}
    />
  ));
}
