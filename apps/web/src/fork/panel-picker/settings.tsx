import { SettingsRow } from "~/components/settings/settingsLayout";
import { Switch } from "~/components/ui/switch";
import { LoomSettingsContent, LoomSettingsNotice, LoomSettingsPanel } from "~/fork/settings/parts";
import {
  setPanelPickerEnabled,
  setPanelPickerShortcut,
  usePanelPickerPreferences,
} from "./preferences";

/** Client preferences: they apply on this device, on any server, without a reload. */
export function PanelPickerSettingsSection() {
  const { enabled, shortcut } = usePanelPickerPreferences();
  return (
    <LoomSettingsContent className="flex flex-col gap-5">
      <LoomSettingsNotice>
        These preferences apply on this device, across all connected environments.
      </LoomSettingsNotice>
      <LoomSettingsPanel
        title="Find and open panels"
        description="Choose how the panel launcher works on this device."
      >
        <SettingsRow
          className="px-0 sm:px-0"
          title="Use the compact panel picker"
          description="Search and recent panels in the right panel's launcher and + menu. Off shows the standard list."
          control={
            <Switch
              aria-label="Use the compact panel picker"
              checked={enabled}
              onCheckedChange={setPanelPickerEnabled}
            />
          }
        />
        <SettingsRow
          className="px-0 sm:px-0"
          title="Open the picker with a keyboard shortcut"
          description="Use mod+shift+' to open the picker. Mod is Command on macOS and Control elsewhere. You can change Open panel picker in Keybindings."
          control={
            <Switch
              aria-label="mod+shift+' opens the panel picker"
              checked={shortcut}
              onCheckedChange={setPanelPickerShortcut}
            />
          }
        />
      </LoomSettingsPanel>
      <LoomSettingsNotice>Changes apply immediately on this device.</LoomSettingsNotice>
    </LoomSettingsContent>
  );
}
