import { SettingsRow } from "~/components/settings/settingsLayout";
import { searchableSetting } from "~/components/settings/settingsSearch";
import {
  useScopedSettings,
  useUpdateScopedSettings,
} from "~/components/settings/useScopedSettings";
import { Switch } from "~/components/ui/switch";
import { hasDesktopNotifications } from "~/threadNotifications";

/** The previews switch under Thread notifications, shown only while they send system alerts. */
export function NotificationPreviewsSettingsRow() {
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const previews = useScopedSettings((settings) => settings.notificationPreviewsEnabled);
  const updateSettings = useUpdateScopedSettings();
  if (!hasDesktopNotifications(mode)) return null;
  return (
    <SettingsRow
      {...searchableSetting("notification-previews")}
      description="Show thread and pull request titles in system notifications. Turn off to hide them on this device."
      control={
        <Switch
          checked={previews}
          onCheckedChange={(checked) => updateSettings({ notificationPreviewsEnabled: checked })}
          aria-label="Notification previews"
        />
      }
    />
  );
}
