import { useState } from "react";
import { Modal, View } from "react-native";
import type { EnvironmentId, ModelSelection, ProjectId, RuntimeMode } from "@t3tools/contracts";
import { Button } from "../../components/ui/Button";
import { useEnvironmentServerConfig } from "../../state/entities";
import { buildModelOptions, groupByProvider } from "../../lib/modelOptions";
import { resolveProviderOptionDescriptors } from "../../lib/providerOptions";
import { ThreadSettingsPickerScreen } from "../../features/threads/ThreadSettingsSheet";
import { BotField } from "./BotControls";

/** Uses the same provider catalog and option controls as native thread settings. */
export function BotModelField({
  environmentId,
  value,
  onChange,
  projectId = null,
  disabled = false,
  runtimeMode,
  onRuntimeModeChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly value: ModelSelection | null;
  readonly onChange: (selection: ModelSelection) => void;
  readonly projectId?: ProjectId | null;
  readonly disabled?: boolean;
  readonly runtimeMode?: RuntimeMode;
  readonly onRuntimeModeChange?: (mode: RuntimeMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const config = useEnvironmentServerConfig(environmentId);
  const options = buildModelOptions(config, value, undefined, projectId);
  const selected = options.find(
    (option) =>
      option.selection.instanceId === value?.instanceId && option.selection.model === value.model,
  );
  const groups = groupByProvider(options);
  const descriptors = resolveProviderOptionDescriptors({
    capabilities: selected?.capabilities,
    selections: value?.options,
  });
  return (
    <BotField label="Model" hint={selected?.providerLabel}>
      <Button
        label={selected?.label ?? value?.model ?? "Choose model"}
        disabled={disabled}
        onPress={() => setOpen(true)}
      />
      {open ? (
        <Modal
          visible
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => setOpen(false)}
        >
          <View className="flex-1 bg-screen">
            <ThreadSettingsPickerScreen
              environmentId={environmentId}
              projectId={projectId}
              providerGroups={groups}
              selectedModel={value}
              onSelectModel={(option) => onChange(option.selection)}
              optionDescriptors={descriptors}
              onUpdateOptionSelections={(selections) => {
                if (value) onChange({ ...value, options: selections });
              }}
              runtimeMode={runtimeMode ?? "auto-accept-edits"}
              hideRuntimeMode={onRuntimeModeChange === undefined}
              onUpdateRuntimeMode={(mode) => onRuntimeModeChange?.(mode)}
              onClose={() => setOpen(false)}
            />
          </View>
        </Modal>
      ) : null}
    </BotField>
  );
}
