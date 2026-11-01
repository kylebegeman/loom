import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import { NetworkIcon } from "lucide-react";
import { useSettingsScope } from "~/components/settings/SettingsScopeContext";
import { LibraryEmpty } from "~/fork/project-library/LibraryControls";
import { useServerConfigs } from "~/state/entities";
import { MiniWorkers } from "./Workers";

export function MiniOffloadSettingsSection() {
  const { environment } = useSettingsScope();
  const configs = useServerConfigs();
  if (!environment)
    return (
      <LibraryEmpty icon={NetworkIcon} title="Choose a computer">
        Select a connected computer to manage its command workers.
      </LibraryEmpty>
    );
  if (
    !loomFeaturesOf(configs.get(environment.environmentId)?.environment.capabilities).includes(
      "mini-offload",
    )
  )
    return (
      <LibraryEmpty icon={NetworkIcon} title="Command workers unavailable">
        This Loom server does not support command jobs.
      </LibraryEmpty>
    );
  return <MiniWorkers key={environment.environmentId} environmentId={environment.environmentId} />;
}
