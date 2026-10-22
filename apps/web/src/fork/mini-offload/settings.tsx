import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { useServerConfigs } from "~/state/entities";
import { MiniWorkers } from "./Workers";
import { LoomSettingsNotice } from "~/fork/settings/parts";
export function MiniOffloadSettingsSection() {
  const { environment } = useSettingsScope();
  const configs = useServerConfigs();
  if (
    !environment ||
    !loomFeaturesOf(configs.get(environment.environmentId)?.environment.capabilities).includes(
      "mini-offload",
    )
  )
    return (
      <LoomSettingsNotice>Command jobs are unavailable on this Loom server.</LoomSettingsNotice>
    );
  return <MiniWorkers key={environment.environmentId} environmentId={environment.environmentId} />;
}
