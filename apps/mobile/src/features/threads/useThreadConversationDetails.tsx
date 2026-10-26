import { StackActions, useNavigation } from "@react-navigation/native";
import type { ModelSelection, RuntimeMode, ServerConfig } from "@t3tools/contracts";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  ThreadConversationDetails,
  type ThreadConversationDetailsProps,
} from "../../fork/library/ThreadConversationDetails";
import {
  useThreadConversationSettingsRoute,
  type ThreadConversationSettingsSession,
} from "../../fork/library/threadConversationSettingsRoute";
import { buildModelOptions, groupByProvider } from "../../lib/modelOptions";
import { resolveProviderOptionDescriptors } from "../../lib/providerOptions";
import {
  getComposerDraftSnapshot,
  setComposerDraftText,
  useComposerDraft,
} from "../../state/use-composer-drafts";
import {
  rememberModelOptions,
  withRememberedModelOptions,
} from "../../state/use-model-option-memory";

type Props = Pick<
  ThreadConversationDetailsProps,
  "projectTitle" | "computerLabel" | "connected" | "cwd" | "runtimeMode"
> & {
  readonly thread: ThreadConversationDetailsProps["thread"] & {
    readonly modelSelection: ModelSelection;
  };
  readonly serverConfig: ServerConfig | null;
  /** The composer draft whose text carries prompt-controlled reasoning such as Ultrathink. */
  readonly draftKey: string | null;
  readonly canSwitchProvider: boolean;
  readonly canOperate: boolean;
  readonly onUpdateModelSelection: (selection: ModelSelection) => void;
  readonly onUpdateRuntimeMode: (mode: RuntimeMode) => void;
};

export function useThreadConversationDetails(props: Props | null) {
  const navigation = useNavigation();
  const { session, present, clear } = useThreadConversationSettingsRoute();
  const ownerId = props ? `details:${props.thread.environmentId}:${props.thread.id}` : null;
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const onUpdateModelSelection = useCallback(
    (selection: ModelSelection) => {
      const current = latest.current;
      if (
        !current ||
        !current.connected ||
        !current.canOperate ||
        `details:${current.thread.environmentId}:${current.thread.id}` !== ownerId
      )
        return;
      current.onUpdateModelSelection(selection);
    },
    [ownerId],
  );
  const onUpdateRuntimeMode = useCallback(
    (mode: RuntimeMode) => {
      const current = latest.current;
      if (
        !current ||
        !current.connected ||
        !current.canOperate ||
        `details:${current.thread.environmentId}:${current.thread.id}` !== ownerId
      )
        return;
      current.onUpdateRuntimeMode(mode);
    },
    [ownerId],
  );
  const onPromptChange = useCallback(
    (prompt: string) => {
      const current = latest.current;
      if (
        !current?.draftKey ||
        `details:${current.thread.environmentId}:${current.thread.id}` !== ownerId
      )
        return;
      setComposerDraftText(current.draftKey, prompt);
    },
    [ownerId],
  );
  const environmentId = props?.thread.environmentId;
  const threadId = props?.thread.id;
  const projectId = props?.thread.projectId;
  const selection = props?.thread.modelSelection;
  const {
    projectTitle = null,
    computerLabel = "Conversation computer",
    connected = false,
    cwd = null,
    runtimeMode = "full-access",
    serverConfig = null,
    draftKey = null,
    canSwitchProvider = false,
    canOperate = false,
  } = props ?? {};
  const active = ownerId !== null && session?.ownerId === ownerId;
  // Only an open settings page follows the draft, so typing never re-renders the thread route.
  const activeDraftText = useComposerDraft(active ? draftKey : null).text;
  const nextSession = useMemo<ThreadConversationSettingsSession | null>(() => {
    if (!environmentId || !threadId || !projectId || !selection || !ownerId) return null;
    const lockedProviderInstanceId = canSwitchProvider ? undefined : selection.instanceId;
    const options = buildModelOptions(serverConfig, selection, lockedProviderInstanceId, projectId);
    const current = options.find(
      (option) =>
        option.selection.instanceId === selection.instanceId &&
        option.selection.model === selection.model,
    );
    const descriptors = resolveProviderOptionDescriptors({
      capabilities: current?.capabilities,
      selections: selection.options,
    });
    return {
      ownerId,
      environmentId,
      projectId,
      providerInstanceId: selection.instanceId,
      ...(lockedProviderInstanceId ? { lockedProviderInstanceId } : {}),
      providerGroups: groupByProvider(options),
      selectedModel: selection,
      prompt: activeDraftText,
      onPromptChange,
      restoreSelection: withRememberedModelOptions,
      onSelectModel: (option) =>
        onUpdateModelSelection(withRememberedModelOptions(option.selection)),
      optionDescriptors: descriptors,
      onUpdateOptionSelections: (selections) => {
        rememberModelOptions(selection.instanceId, selection.model, selections);
        onUpdateModelSelection({ ...selection, options: selections });
      },
      runtimeMode,
      onUpdateRuntimeMode,
      conversationDetails: (onOpenModel) => (
        <ThreadConversationDetails
          key={ownerId}
          thread={{ id: threadId, environmentId, projectId }}
          projectTitle={projectTitle}
          computerLabel={computerLabel}
          connected={connected}
          cwd={cwd}
          modelSelection={selection}
          modelLabel={current?.label ?? selection.model}
          optionDescriptors={descriptors}
          runtimeMode={runtimeMode}
          canEditModel={canOperate && connected}
          onOpenModel={onOpenModel}
          onOpenProject={(projectId) =>
            navigation.dispatch(StackActions.replace("LibraryProject", { projectId }))
          }
          onContinue={(projectId, archiveId) =>
            navigation.dispatch(
              StackActions.replace("LibraryStart", { projectId, sourceArchiveId: archiveId }),
            )
          }
        />
      ),
    };
  }, [
    ownerId,
    environmentId,
    threadId,
    projectId,
    selection,
    serverConfig,
    runtimeMode,
    canSwitchProvider,
    canOperate,
    connected,
    projectTitle,
    computerLabel,
    cwd,
    navigation,
    onUpdateModelSelection,
    onUpdateRuntimeMode,
    activeDraftText,
    onPromptChange,
  ]);
  useEffect(() => {
    if (active && nextSession) present(nextSession);
  }, [active, nextSession, present]);
  useEffect(
    () => () => {
      if (ownerId) clear(ownerId);
    },
    [ownerId, clear],
  );
  return useCallback(() => {
    if (!nextSession) return;
    present({ ...nextSession, prompt: draftKey ? getComposerDraftSnapshot(draftKey).text : "" });
    navigation.dispatch(StackActions.push("ThreadConversationSettingsSheet"));
  }, [nextSession, draftKey, present, navigation]);
}
