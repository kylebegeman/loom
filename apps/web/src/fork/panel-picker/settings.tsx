import { SettingsRow } from "~/components/settings/settingsLayout";
import { Switch } from "~/components/ui/switch";
import {
  setPanelPickerEnabled,
  setPanelPickerShortcut,
  usePanelPickerPreferences,
} from "./preferences";

/** Client preferences: they apply on this device, on any server, without a reload. */
export function PanelPickerSettingsSection() {
  const { enabled, shortcut } = usePanelPickerPreferences();
  return (
    <div className="flex flex-col gap-3">
      <SettingsRow
        title="Use the compact panel picker"
        description="Search and recent panels in the right panel's launcher and + menu. Off shows the standard list."
      >
        <Switch
          aria-label="Use the compact panel picker"
          checked={enabled}
          onCheckedChange={setPanelPickerEnabled}
        />
      </SettingsRow>
      <SettingsRow
        title="mod+shift+' opens the panel picker"
        description="Off leaves the key alone. You can still bind Open panel picker in Keybindings."
      >
        <Switch
          aria-label="mod+shift+' opens the panel picker"
          checked={shortcut}
          onCheckedChange={setPanelPickerShortcut}
        />
      </SettingsRow>
    </div>
  );
}
