import { SettingsRow } from "~/components/settings/settingsLayout";
import { searchableSetting } from "~/components/settings/settingsSearch";
import {
  useScopedSettings,
  useUpdateScopedSettings,
} from "~/components/settings/useScopedSettings";
import { Switch } from "~/components/ui/switch";

/** The previews switch, shown under Thread notifications in General settings. */
export function NotificationPreviewsSettingsRow() {
  const previews = useScopedSettings((settings) => settings.notificationPreviewsEnabled);
  const updateSettings = useUpdateScopedSettings();
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
