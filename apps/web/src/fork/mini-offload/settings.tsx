import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { useServerConfigs } from "~/state/entities";
import { MiniWorkers } from "./Workers";
import { LoomSettingsContent, LoomSettingsNotice } from "~/fork/settings/parts";
export function MiniOffloadSettingsSection() {
  const { environment } = useSettingsScope();
  const configs = useServerConfigs();
  if (!environment)
    return (
      <LoomSettingsContent>
        <LoomSettingsNotice>
          Select a connected environment to manage command workers.
        </LoomSettingsNotice>
      </LoomSettingsContent>
    );
  if (
    !loomFeaturesOf(configs.get(environment.environmentId)?.environment.capabilities).includes(
      "mini-offload",
    )
  )
    return (
      <LoomSettingsContent>
        <LoomSettingsNotice>Command jobs are unavailable on this Loom server.</LoomSettingsNotice>
      </LoomSettingsContent>
    );
  return (
    <LoomSettingsContent>
      <MiniWorkers key={environment.environmentId} environmentId={environment.environmentId} />
    </LoomSettingsContent>
  );
}
