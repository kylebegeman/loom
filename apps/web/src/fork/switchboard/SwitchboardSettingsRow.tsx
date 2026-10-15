import type { EnvironmentId } from "@t3tools/contracts";

import { SettingsRow } from "~/components/settings/settingsLayout";
import { Switch } from "~/components/ui/switch";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "~/hooks/useSettings";
import { isSwitchboardAvailabilityUnknown, useSwitchboardStatus } from "./switchboardLimits";

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
  const status = useSwitchboardStatus(enabled, environmentId);
  const statusNote =
    status.availability === "unconfigured"
      ? " This server has no Switchboard controller configured, so model availability is unknown and every model stays selectable. Set LOOM_SWITCHBOARD_CONTROLLER_URL on the server to show it."
      : isSwitchboardAvailabilityUnknown(status)
        ? " Switchboard cannot report model availability right now, so every model stays selectable."
        : "";
  return (
    <SettingsRow
      id="switchboard"
      title="Route through Switchboard"
      description={`Send Claude and Codex through this environment’s Switchboard hub, which picks the account for each request. The model picker shows one Claude and one Codex. New sessions use the change; running ones keep their route.${statusNote}`}
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
