import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME } from "~/components/settings/settingsLayout";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import { providerInstanceEntriesFor } from "~/providerInstances";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "~/state/server";

/** The model choices of one environment, as the bot editor and retry offer them. */
export function useBotModelChoices(environmentId: EnvironmentId) {
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const instanceEntries = providerInstanceEntriesFor(providers, settings, null);
  return { settings, providers, instanceEntries };
}

export function BotModelPicker({
  environmentId,
  value,
  onChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly value: ModelSelection | null;
  readonly onChange: (value: ModelSelection) => void;
}) {
  const { settings, providers, instanceEntries } = useBotModelChoices(environmentId);
  const activeInstanceId =
    value?.instanceId ?? instanceEntries[0]?.instanceId ?? ("" as ProviderInstanceId);
  const activeModel = value?.model ?? "";
  return (
    <ProviderModelPicker
      environmentId={environmentId}
      activeInstanceId={activeInstanceId}
      model={activeModel}
      lockedProvider={null}
      instanceEntries={instanceEntries}
      modelOptionsByInstance={getCustomModelOptionsByInstance(
        settings,
        providers,
        activeInstanceId,
        activeModel,
      )}
      isComposerOwned={false}
      triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
      onInstanceModelChange={(instanceId, model) => onChange({ instanceId, model })}
    />
  );
}
