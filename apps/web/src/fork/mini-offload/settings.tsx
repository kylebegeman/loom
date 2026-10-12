import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { useServerConfigs } from "~/state/entities";
import { MiniWorkers } from "./Workers";
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
      <p className="text-sm text-muted-foreground">
        Command jobs are unavailable on this Loom server.
      </p>
    );
  return <MiniWorkers key={environment.environmentId} environmentId={environment.environmentId} />;
}
