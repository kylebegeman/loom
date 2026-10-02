import type { EnvironmentId } from "@t3tools/contracts";

import { SettingsRow } from "~/components/settings/settingsLayout";
import { Switch } from "~/components/ui/switch";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "~/hooks/useSettings";

/** The Switchboard switch, shown with the usage hubs since Switchboard is one. */
export function SwitchboardSettingsRow({
  environmentId,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly readOnly: boolean;
}) {
  const enabled = useEnvironmentSettings(environmentId, (settings) => settings.switchboardEnabled);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  return (
    <SettingsRow
      id="switchboard"
      title="Route through Switchboard"
      description="Send Claude and Codex through the Switchboard hub on this Mac, which picks the account for each request. The model picker shows one Claude and one Codex. New sessions use the change; running ones keep their route."
      control={
        <Switch
          aria-label="Route through Switchboard"
          checked={enabled}
          disabled={readOnly}
          onCheckedChange={(checked) => updateSettings({ switchboardEnabled: Boolean(checked) })}
        />
      }
    />
  );
}
