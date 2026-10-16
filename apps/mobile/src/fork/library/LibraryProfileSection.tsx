import type { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_PROFILE_LIMITS,
  LIBRARY_TOOL_CATALOG,
  type LibraryComputer,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import {
  libraryProfileComputerIds,
  libraryProfileScriptSources,
  librarySecretNameFromInput,
  libraryToolLabel,
  libraryToolsWithVersion,
  type LibraryProfileDraft,
} from "@t3tools/client-runtime/fork";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { MaterialButton } from "../../components/MaterialButton";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { SettingsSwitchRow } from "../../features/settings/components/SettingsSwitchRow";
import { cn } from "../../lib/cn";
import { useProjects } from "../../state/entities";

/**
 * How work on a project gets going on any computer: its scripts, the tools it needs, the
 * secrets each computer provides by name, and where it prefers to run. Mirrors the web editor.
 */
export function LibraryProfileSection(props: {
  readonly draft: LibraryProfileDraft;
  readonly onChange: (change: LibraryProfileDraft) => void;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly computers: readonly LibraryComputer[];
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly disabled: boolean;
}) {
  const { draft, onChange, disabled } = props;
  const scripts = draft.scripts ?? [],
    tools = draft.requiredTools ?? [],
    selected = draft.preferredEnvironmentIds ?? [];
  // Scripts come from a copy's local project, where people already write and run them.
  const sources = libraryProfileScriptSources(props.copies, useProjects());
  const computerIds = libraryProfileComputerIds(props.computers, selected);
  return (
    <>
      <SettingsSection
        title="Setup scripts"
        footer={
          scripts.length
            ? undefined
            : sources.length
              ? "Bring in the scripts a copy already uses."
              : "Scripts appear here once a copy on a connected computer has some."
        }
      >
        {scripts.map((script) => (
          <View key={script.id} className="flex-row items-center gap-3 py-2 ps-4 pe-2">
            <View className="min-w-0 flex-1">
              <Text className="text-sm text-foreground" numberOfLines={1}>
                {script.name}
              </Text>
              <Text className="font-mono text-xs text-foreground-muted" numberOfLines={1}>
                {script.command}
              </Text>
            </View>
            <MaterialButton
              label="Remove"
              tone="text"
              disabled={disabled}
              onPress={() =>
                onChange({ scripts: scripts.filter((entry) => entry.id !== script.id) })
              }
            />
          </View>
        ))}
        {sources.length ? (
          <View className="gap-2 p-4">
            {sources.map((source) => (
              <MaterialButton
                key={`${source.environmentId}:${source.projectId}`}
                label={`Use ${source.title} on ${props.hostLabel(source.environmentId)} (${source.scripts.length})`}
                disabled={disabled}
                onPress={() => onChange({ scripts: source.scripts })}
              />
            ))}
          </View>
        ) : null}
      </SettingsSection>
      <SettingsSection
        title="Required tools"
        footer="Each computer checks these tools itself and never runs a saved command."
      >
        <View className="flex-row flex-wrap gap-2 p-4">
          {LIBRARY_TOOL_CATALOG.map((tool) => {
            const pressed = tools.some((entry) => entry.id === tool.id);
            return (
              <Pill
                key={tool.id}
                label={tool.label}
                selected={pressed}
                disabled={disabled}
                onPress={() =>
                  onChange({
                    requiredTools: pressed
                      ? tools.filter((entry) => entry.id !== tool.id)
                      : [...tools, { id: tool.id }],
                  })
                }
              />
            );
          })}
        </View>
        {tools.length ? (
          <View className="gap-2 px-4 pb-4">
            {tools.map((tool) => (
              <View key={tool.id} className="flex-row items-center gap-2">
                <Text className="w-24 text-sm text-foreground" numberOfLines={1}>
                  {libraryToolLabel(tool.id)}
                </Text>
                <TextInput
                  accessibilityLabel={`Minimum ${libraryToolLabel(tool.id)} version`}
                  placeholder="Any version"
                  value={tool.minimumVersion ?? ""}
                  onChangeText={(value) =>
                    onChange({ requiredTools: libraryToolsWithVersion(tools, tool.id, value) })
                  }
                  maxLength={32}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!disabled}
                  className="min-h-10 flex-1 rounded-xl border border-input-border bg-input px-3 text-sm text-foreground"
                />
                {LIBRARY_TOOL_CATALOG.some((entry) => entry.id === tool.id) ? null : (
                  // Only catalog tools have a pill above, so others are removed here.
                  <MaterialButton
                    label="Remove"
                    tone="text"
                    disabled={disabled}
                    onPress={() =>
                      onChange({ requiredTools: tools.filter((entry) => entry.id !== tool.id) })
                    }
                  />
                )}
              </View>
            ))}
          </View>
        ) : null}
      </SettingsSection>
      <SecretNamesSection
        names={draft.secretNames ?? []}
        disabled={disabled}
        onChange={(secretNames) => onChange({ secretNames })}
      />
      {computerIds.length ? (
        <SettingsSection title="Preferred computers">
          {computerIds.map((id) => {
            const checked = selected.includes(id);
            return (
              <SettingsSwitchRow
                key={id}
                label={props.hostLabel(id)}
                value={checked}
                disabled={
                  disabled ||
                  (!checked && selected.length >= LIBRARY_PROFILE_LIMITS.preferredEnvironmentIds)
                }
                onValueChange={(next) =>
                  onChange({
                    preferredEnvironmentIds: next
                      ? [...selected, id]
                      : selected.filter((entry) => entry !== id),
                  })
                }
              />
            );
          })}
        </SettingsSection>
      ) : null}
      {draft.defaultModelSelection ? (
        <SettingsSection title="Default model">
          <View className="flex-row items-center gap-3 py-2 ps-4 pe-2">
            <Text className="min-w-0 flex-1 text-sm text-foreground" numberOfLines={1}>
              {draft.defaultModelSelection.model}
            </Text>
            <MaterialButton
              label="Remove"
              tone="text"
              disabled={disabled}
              onPress={() => onChange({ defaultModelSelection: undefined })}
            />
          </View>
        </SettingsSection>
      ) : null}
      <SettingsSection title="Mini">
        <SettingsSwitchRow
          label="Let Mini run its jobs"
          subtitle="Builds and tests for this project can be sent to a Mini worker."
          value={draft.allowMini === true}
          disabled={disabled}
          onValueChange={(allowMini) => onChange({ allowMini })}
        />
      </SettingsSection>
    </>
  );
}

/** Names only. Each computer supplies the values, so none ever reach the Library. */
function SecretNamesSection(props: {
  readonly names: readonly string[];
  readonly disabled: boolean;
  readonly onChange: (names: readonly string[]) => void;
}) {
  const { names, onChange } = props;
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const add = () => {
    const name = librarySecretNameFromInput(value);
    if (!name) {
      setInvalid(true);
      return;
    }
    if (!names.includes(name)) onChange([...names, name]);
    setValue("");
  };
  return (
    <SettingsSection
      title="Secret names"
      footer={
        invalid
          ? "Use a variable name like GITHUB_TOKEN. Never paste the value here."
          : "Each computer provides the value from its own environment."
      }
    >
      <View className="gap-3 p-4">
        {names.length ? (
          <View className="flex-row flex-wrap gap-2">
            {names.map((name) => (
              <Pill
                key={name}
                label={`${name}  ×`}
                accessibilityLabel={`Remove ${name}`}
                selected
                disabled={props.disabled}
                onPress={() => onChange(names.filter((entry) => entry !== name))}
              />
            ))}
          </View>
        ) : null}
        {names.length < LIBRARY_PROFILE_LIMITS.secretNames ? (
          <View className="flex-row items-center gap-2">
            <TextInput
              accessibilityLabel="Secret name"
              placeholder="GITHUB_TOKEN"
              value={value}
              onChangeText={(next) => {
                setInvalid(false);
                setValue(next);
              }}
              onSubmitEditing={add}
              returnKeyType="done"
              maxLength={128}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              editable={!props.disabled}
              className="min-h-11 flex-1 rounded-xl border border-input-border bg-input px-3 text-sm text-foreground"
            />
            <MaterialButton label="Add" disabled={props.disabled || !value.trim()} onPress={add} />
          </View>
        ) : null}
      </View>
    </SettingsSection>
  );
}

function Pill(props: {
  readonly label: string;
  readonly accessibilityLabel?: string;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ selected: props.selected, disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      className={cn(
        "h-9 justify-center rounded-full border px-3 active:opacity-70",
        props.selected ? "border-foreground bg-subtle" : "border-border",
      )}
    >
      <Text className="text-sm text-foreground">{props.label}</Text>
    </Pressable>
  );
}
