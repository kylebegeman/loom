import { SettingsRow } from "~/components/settings/settingsLayout";
import { Switch } from "~/components/ui/switch";
import { LoomSettingsContent, LoomSettingsNotice } from "~/fork/settings/parts";
import {
  setPanelPickerEnabled,
  setPanelPickerShortcut,
  usePanelPickerPreferences,
} from "./preferences";

/** Client preferences: they apply on this device, on any server, without a reload. */
export function PanelPickerSettingsSection() {
  const { enabled, shortcut } = usePanelPickerPreferences();
  return (
    <div className="flex min-w-0 flex-col">
      <LoomSettingsContent className="flex flex-col gap-3">
        <LoomSettingsNotice>
          These preferences apply on this device, across all connected environments.
        </LoomSettingsNotice>
      </LoomSettingsContent>
      <SettingsRow
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
        title="mod+shift+' opens the panel picker"
        description="Off leaves the key alone. You can still bind Open panel picker in Keybindings."
        control={
          <Switch
            aria-label="mod+shift+' opens the panel picker"
            checked={shortcut}
            onCheckedChange={setPanelPickerShortcut}
          />
        }
      />
    </div>
  );
}
