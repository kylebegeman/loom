import {
  AuthOrchestrationReadScope,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type ProviderOptionDescriptor,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";
import { LIBRARY_FILE_LIFECYCLE_FEATURE } from "@t3tools/contracts/fork";
import { getProviderOptionCurrentLabel } from "@t3tools/shared/model";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListRow } from "../../components/ui/ListRow";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { RUNTIME_MODE_CHOICES } from "../../features/threads/thread-settings-options";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { LibraryFolderStorage } from "./LibraryFolderStorage";
import { LibraryManagedFileControls } from "./LibraryManagedFileControls";
import { library, useLibraryAuthority, useLoomFeature } from "./libraryState";
import { conversationLibraryContext, conversationWorkingCopy } from "./threadConversationContext";

export type ThreadConversationDetailsProps = {
  readonly thread: {
    readonly id: ThreadId;
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
  };
  readonly projectTitle: string | null;
  readonly computerLabel: string;
  readonly connected: boolean;
  readonly cwd: string | null;
  readonly modelSelection: ModelSelection;
  readonly modelLabel: string;
  readonly optionDescriptors: readonly ProviderOptionDescriptor[];
  readonly runtimeMode: RuntimeMode;
  readonly canEditModel: boolean;
  readonly onOpenModel: () => void;
  readonly onOpenProject: (projectId: string) => void;
  readonly onContinue: (projectId: string, archiveId: string) => void;
};

function Detail(props: { readonly label: string; readonly value: string }) {
  return (
    <View className="gap-1 px-4 py-3">
      <Text className="text-xs text-foreground-muted">{props.label}</Text>
      <Text selectable className="text-sm text-foreground">
        {props.value}
      </Text>
    </View>
  );
}

export function ThreadConversationDetails(props: ThreadConversationDetailsProps) {
  const authority = useLibraryAuthority();
  const canReadComputer = useEnvironmentScope(
    props.thread.environmentId,
    AuthOrchestrationReadScope,
  );
  const supportsLibrary = useLoomFeature(props.thread.environmentId, "project-library");
  const supportsFiles = useLoomFeature(props.thread.environmentId, LIBRARY_FILE_LIFECYCLE_FEATURE);
  const binding = useEnvironmentQuery(
    supportsLibrary && canReadComputer && props.connected
      ? library.threadBinding({
          environmentId: props.thread.environmentId,
          input: { threadId: props.thread.id },
        })
      : null,
  );
  const saved = useEnvironmentQuery(
    authority.environmentId && authority.supported && authority.canRead
      ? library.lookupThread({
          environmentId: authority.environmentId,
          input: { sourceEnvironmentId: props.thread.environmentId, threadId: props.thread.id },
        })
      : null,
  );
  const context = conversationLibraryContext(props.thread, binding.data, saved.data);
  const project = useEnvironmentQuery(
    authority.environmentId && authority.supported && authority.canRead && context
      ? library.project({
          environmentId: authority.environmentId,
          input: { projectId: context.projectId },
        })
      : null,
  );
  const copies = useEnvironmentQuery(
    authority.environmentId && authority.supported && authority.canRead && context
      ? library.copies({
          environmentId: authority.environmentId,
          input: { projectId: context.projectId, includeReleased: true },
        })
      : null,
  );
  const copy = context
    ? conversationWorkingCopy(props.thread, props.cwd, context, copies.data ?? [])
    : null;
  const [filePending, setFilePending] = useState(false);
  const [retained, setRetained] = useState<typeof copy>(null);
  const onPending = useCallback((pending: boolean) => setFilePending(pending), []);
  const currentCopy =
    copy &&
    retained?.id === copy.id &&
    retained.environmentId === copy.environmentId &&
    retained.projectId === copy.projectId &&
    retained.rootPath === copy.rootPath &&
    retained.updatedAt >= copy.updatedAt
      ? retained
      : copy;
  const queryError = binding.error ?? saved.error ?? project.error ?? copies.error;
  const refresh = () => {
    binding.refresh();
    saved.refresh();
    project.refresh();
    copies.refresh();
  };
  const insets = useSafeAreaInsets();
  const title =
    context && project.data?.id === context.projectId ? project.data.title : props.projectTitle;
  const options = props.optionDescriptors.map(
    (descriptor) =>
      `${descriptor.label}: ${getProviderOptionCurrentLabel(descriptor, props.modelSelection) ?? "Default"}`,
  );
  const knownOptions = new Set(props.optionDescriptors.map((descriptor) => descriptor.id));
  for (const option of props.modelSelection.options ?? []) {
    if (!knownOptions.has(option.id)) options.push(`${option.id}: ${String(option.value)}`);
  }
  return (
    <ScreenScrollView
      className="flex-1 bg-sheet"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: insets.bottom + 24 }}
    >
      <SettingsSection
        title="Conversation"
        footer="This conversation stays with its project and computer. Continuing elsewhere creates a new conversation with its saved context."
      >
        <Detail label="Project" value={title ?? "Project unavailable"} />
        {context ? (
          <ListRow
            label="Open project"
            icon="folder"
            onPress={() => props.onOpenProject(context.projectId)}
          />
        ) : null}
        <Detail label="Computer" value={props.computerLabel} />
        <Detail
          label="Connection"
          value={props.connected ? "Connected" : "Offline. Showing saved context."}
        />
      </SettingsSection>
      <SettingsSection title="Model and options">
        <Detail label="Current model" value={props.modelLabel} />
        {options.map((option) => (
          <Text key={option} className="px-4 pb-2 text-sm text-foreground-muted">
            {option}
          </Text>
        ))}
        <Detail
          label="Runtime"
          value={
            RUNTIME_MODE_CHOICES.find((choice) => choice.mode === props.runtimeMode)?.label ??
            props.runtimeMode
          }
        />
        <ListRow
          label="Change model and options"
          icon="slider.horizontal.3"
          disabled={!props.canEditModel || filePending}
          onPress={props.onOpenModel}
        />
        {!props.canEditModel ? (
          <Text className="px-4 pb-3 text-xs text-foreground-muted">
            {!props.connected
              ? "Reconnect this computer to change the model and options."
              : "This connection needs permission to change the model and options."}
          </Text>
        ) : null}
      </SettingsSection>
      <SettingsSection title="Files">
        <Detail label="Location" value={props.cwd ?? "File location unavailable"} />
        {currentCopy ? (
          <>
            <Detail
              label={props.connected ? "File status" : "Last known file status"}
              value={
                currentCopy.state === "released" || currentCopy.registered === false
                  ? "Files removed"
                  : currentCopy.state === "missing"
                    ? "Folder not found"
                    : currentCopy.state === "preparing"
                      ? "Preparing files"
                      : currentCopy.state === "failed"
                        ? "Files need attention"
                        : currentCopy.ownership === "borrowed"
                          ? "Existing folder"
                          : currentCopy.keepOnComputer === false
                            ? "Temporary files"
                            : "Files kept on this computer"
              }
            />
            {currentCopy.ownership === "borrowed" ? (
              <LibraryFolderStorage
                copy={currentCopy}
                canAct={authority.ready && !queryError}
                onChanged={copies.refresh}
                onPending={onPending}
              />
            ) : authority.environmentId ? (
              <LibraryManagedFileControls
                copy={currentCopy}
                connected={props.connected}
                supported={supportsFiles}
                canAct={authority.ready && !queryError}
                authorityEnvironmentId={authority.environmentId}
                onPending={onPending}
                onChanged={(updated) => {
                  setRetained(updated);
                  copies.refresh();
                }}
              />
            ) : null}
          </>
        ) : (
          <Text className="px-4 pb-3 text-sm text-foreground-muted">
            {copies.isPending || binding.isPending || saved.isPending
              ? "Checking file context…"
              : context
                ? "This conversation's files could not be matched to a current folder on this computer. Open the project to review its files."
                : "No saved file status is available for this conversation. Use its Files view to inspect this folder."}
          </Text>
        )}
        {!props.connected ? (
          <Text className="px-4 pb-3 text-xs text-foreground-muted">
            Reconnect this computer to check its current files.
          </Text>
        ) : null}
      </SettingsSection>
      {context?.archiveId ? (
        <Button
          label="Continue on another computer"
          tone="secondary"
          disabled={!authority.ready || filePending || queryError !== null}
          onPress={() => props.onContinue(context.projectId, context.archiveId!)}
        />
      ) : null}
      {!authority.connected && context ? (
        <Text className="text-sm text-foreground-muted">
          Reconnect the library to change file settings or continue on another computer.
        </Text>
      ) : null}
      {queryError ? (
        <View className="gap-2">
          <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
            {queryError}
          </Text>
          <Button label="Retry conversation context" tone="text" onPress={refresh} />
        </View>
      ) : null}
    </ScreenScrollView>
  );
}
