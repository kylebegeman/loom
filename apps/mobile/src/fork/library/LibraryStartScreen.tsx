import { useAtomValue } from "@effect/atom-react";
import {
  useFocusEffect,
  useNavigation,
  usePreventRemove,
  type StaticScreenProps,
} from "@react-navigation/native";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { ListChoiceRow } from "../../components/ListChoiceRow";
import { MaterialButton } from "../../components/MaterialButton";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { buildModelOptions, resolveNewTaskModelSelection } from "../../lib/modelOptions";
import { uuidv4 } from "../../lib/uuid";
import { appAtomRegistry } from "../../state/atom-registry";
import { useServerConfigs } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { environmentPresentations } from "../../state/presentation";
import { useEnvironmentQuery } from "../../state/query";
import { readEnvironmentScope, useEnvironmentsWithScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { LibraryAuthorityScreen, LibraryNotice, LibraryPage } from "./LibraryScreens";
import { library, refreshLibraryWork, useLibraryAuthority } from "./libraryState";
import { libraryEligibleCopies, libraryListState, libraryRepositories } from "./libraryLogic";
import { emptyLibraryLaunchReceipt, launchLibraryConversation } from "./libraryLaunch";

function unwrap<A, E>(result: AtomCommandResult<A, E>): A {
  if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
  return result.value;
}
export function LibraryStartRouteScreen({
  route,
}: StaticScreenProps<{
  readonly projectId: string;
  readonly sourceArchiveId?: string;
  readonly reuseEnvironmentId?: EnvironmentId;
  readonly reuseRootPath?: string;
}>) {
  const authority = useLibraryAuthority();
  const project = useEnvironmentQuery(
    authority.environmentId
      ? library.project({
          environmentId: authority.environmentId,
          input: { projectId: route.params.projectId },
        })
      : null,
  );
  useFocusEffect(
    useCallback(() => {
      if (!authority.environmentId || !authority.connected || !authority.canRead) return;
      appAtomRegistry.refresh(
        library.project({
          environmentId: authority.environmentId,
          input: { projectId: route.params.projectId },
        }),
      );
      refreshLibraryWork(authority.environmentId, route.params.projectId);
      if (route.params.sourceArchiveId)
        appAtomRegistry.refresh(
          library.history({
            environmentId: authority.environmentId,
            input: { id: route.params.sourceArchiveId },
          }),
        );
    }, [
      authority.environmentId,
      authority.connected,
      authority.canRead,
      route.params.projectId,
      route.params.sourceArchiveId,
    ]),
  );
  return project.data ? (
    <LibraryStartContent
      key={`${route.params.projectId}:${route.params.sourceArchiveId ?? "new"}:${route.params.reuseEnvironmentId ?? ""}:${route.params.reuseRootPath ?? ""}`}
      project={project.data}
      projectReady={project.isSuccess && !project.isPending && project.error === null}
      projectNotice={
        project.error ?? (project.isPending ? "Refreshing shared project context…" : null)
      }
      projectError={project.error}
      onRefreshProject={project.refresh}
      sourceArchiveId={route.params.sourceArchiveId}
      reuseEnvironmentId={route.params.reuseEnvironmentId}
      reuseRootPath={route.params.reuseRootPath}
    />
  ) : (
    <LibraryPage title="New conversation" back>
      <LibraryNotice
        error={project.error}
        detail={project.error ? null : "Loading shared project context…"}
        onRetry={project.refresh}
      />
    </LibraryPage>
  );
}
function LibraryStartContent(props: {
  project: LibraryProject;
  projectReady: boolean;
  projectNotice: string | null;
  projectError: string | null;
  onRefreshProject: () => void;
  sourceArchiveId?: string;
  reuseEnvironmentId?: EnvironmentId;
  reuseRootPath?: string;
}) {
  const authority = useLibraryAuthority(),
    navigation = useNavigation(),
    { environments } = useEnvironments(),
    configs = useServerConfigs();
  const operable = useEnvironmentsWithScope(environments, AuthOrchestrationOperateScope),
    writable = useEnvironmentsWithScope(environments, AuthSourceControlWriteScope);
  const [scope, setScope] = useState("all"),
    [execution, setExecution] = useState<EnvironmentId | null>(props.reuseEnvironmentId ?? null),
    [mode, setMode] = useState<"reuse" | "folder" | "clone">(
      props.reuseRootPath ? "folder" : "reuse",
    ),
    [rootPath, setRootPath] = useState(props.reuseRootPath ?? ""),
    [copyId, setCopyId] = useState<string | null>(null),
    [title, setTitle] = useState(
      props.sourceArchiveId ? "Linked continuation" : "Project discussion",
    ),
    [modelKey, setModelKey] = useState<string | null>(null),
    [showModels, setShowModels] = useState(false);
  const [pending, setPending] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  usePreventRemove(pending !== null, () => undefined);
  const [progress, setProgress] = useState(emptyLibraryLaunchReceipt);
  const receipt = useRef(emptyLibraryLaunchReceipt()),
    requestId = useRef(uuidv4()),
    threadId = useRef(ThreadId.make(uuidv4())),
    busy = useRef(false);
  const reviewed = useRef<{
    authorityEnvironmentId: EnvironmentId;
    model: ReturnType<typeof buildModelOptions>[number];
    title: string;
    mode: "reuse" | "folder" | "clone";
    rootPath: string;
    copy: LibraryWorkingCopy | null;
  } | null>(null);
  const launchProject = progress.intent?.project ?? props.project;
  const repositories = libraryRepositories(launchProject),
    resourceIds =
      progress.intent?.resourceIds ??
      (scope === "all" ? repositories.map((resource) => resource.id) : [scope]);
  const copies = useEnvironmentQuery(
    authority.environmentId
      ? library.copies({
          environmentId: authority.environmentId,
          input: { projectId: props.project.id },
        })
      : null,
  );
  const source = useEnvironmentQuery(
    authority.environmentId && props.sourceArchiveId
      ? library.history({
          environmentId: authority.environmentId,
          input: { id: props.sourceArchiveId },
        })
      : null,
  );
  const eligible = libraryEligibleCopies(launchProject, execution, resourceIds, copies.data ?? []);
  const copiesState = libraryListState(copies);
  const copiesReady = copiesState === "ready" || copiesState === "empty";
  const selectedCopy = eligible.find((copy) => copy.id === copyId) ?? eligible[0] ?? null;
  const config = execution ? (configs.get(execution) ?? null) : null;
  const models = useMemo(
    () =>
      buildModelOptions(config, null, undefined, null).filter(
        (model) => !model.isHidden && !model.isUnavailable,
      ),
    [config],
  );
  const defaultModel = resolveNewTaskModelSelection({
    modelOptions: models,
    draftSelection: null,
    projectDefaultSelection: null,
    stickySelection: null,
  });
  const chosenModel =
    modelKey !== null
      ? (models.find((model) => model.key === modelKey) ?? null)
      : (models.find(
          (model) =>
            model.selection.instanceId === defaultModel?.instanceId &&
            model.selection.model === defaultModel?.model,
        ) ?? null);
  const canPrepare = useAtomValue(library.prepareCopy.permissionAtom(execution)),
    canBind = useAtomValue(library.bindThread.permissionAtom(execution)),
    canRegisterCopy = useAtomValue(library.registerCopy.permissionAtom(authority.environmentId)),
    canRegisterThread = useAtomValue(
      library.registerThread.permissionAtom(authority.environmentId),
    );
  const prepare = useAtomCommand(library.prepareCopy, { reportFailure: false }),
    registerCopy = useAtomCommand(library.registerCopy, { reportFailure: false }),
    bind = useAtomCommand(library.bindThread, { reportFailure: false }),
    registerThread = useAtomCommand(library.registerThread, { reportFailure: false }),
    create = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const resolve = useAtomQueryRunner(library.resolveBinding, {
      refresh: true,
      reportFailure: false,
    }),
    snapshot = useAtomQueryRunner(library.snapshotThread, { refresh: true, reportFailure: false });
  const locked = pending !== null || progress.intent !== null;
  const selectedHost = environments.find((env) => env.environmentId === execution);
  const hostReady =
    selectedHost?.entry.enabled === true &&
    selectedHost.connection.phase === "connected" &&
    supportsLoomFeature(selectedHost.serverConfig?.environment.capabilities, "project-library") &&
    execution !== null &&
    operable.has(execution);
  const canStart =
    authority.ready &&
    hostReady &&
    canBind &&
    canRegisterCopy &&
    canRegisterThread &&
    (progress.intent !== null || copiesReady) &&
    (progress.intent !== null || props.projectReady) &&
    (resourceIds.length > 0 || repositories.length === 0) &&
    (progress.threadCreated || chosenModel !== null) &&
    !launchProject.archived &&
    (progress.copy !== null || mode === "reuse"
      ? progress.copy !== null || selectedCopy !== null
      : canPrepare &&
        rootPath.trim().length > 0 &&
        (mode !== "clone" || (execution !== null && writable.has(execution)))) &&
    (!props.sourceArchiveId ||
      progress.intent !== null ||
      (source.data !== null && source.isSuccess && !source.isPending && source.error === null));
  if (!authority.environmentId) return <LibraryAuthorityScreen />;
  async function start() {
    if (busy.current || !canStart || !execution || !authority.environmentId) return;
    const current = appAtomRegistry.get(environmentPresentations.presentationAtom(execution));
    if (
      current?.entry.enabled !== true ||
      current.connection.phase !== "connected" ||
      !readEnvironmentScope(execution, AuthOrchestrationOperateScope)
    )
      return;
    if (!reviewed.current) {
      if (!chosenModel) return;
      reviewed.current = {
        authorityEnvironmentId: authority.environmentId,
        model: chosenModel,
        title: title.trim() || "Project discussion",
        mode,
        rootPath: rootPath.trim(),
        copy: selectedCopy,
      };
      setModelKey(chosenModel.key);
    }
    const review = reviewed.current;
    if (review.authorityEnvironmentId !== authority.environmentId) {
      setError("Reconnect the library used to start this preparation before resuming it.");
      return;
    }
    busy.current = true;
    setPending("Preparing conversation…");
    setError(null);
    try {
      const continuation =
        receipt.current.intent?.continuationOf ??
        (source.data
          ? {
              environmentId: source.data.summary.environmentId,
              threadId: source.data.summary.threadId,
              sequence: source.data.summary.sequence,
            }
          : undefined);
      const target = await launchLibraryConversation(
        {
          project: launchProject,
          executionEnvironmentId: execution,
          resourceIds,
          threadId: threadId.current,
          ...(continuation ? { continuationOf: continuation } : {}),
        },
        receipt.current,
        {
          prepare: async (intent) =>
            review.mode === "reuse" && review.copy
              ? review.copy
              : unwrap(
                  await prepare({
                    environmentId: execution,
                    input: {
                      requestId: `${requestId.current}:prepare`,
                      project: intent.project,
                      rootPath: review.rootPath,
                      strategy: review.mode === "clone" ? "clone" : "reuse",
                      ...(review.mode === "folder" ? { resourceIds: intent.resourceIds } : {}),
                    },
                  }),
                ),
          registerCopy: async (copy) => {
            unwrap(
              await registerCopy({
                environmentId: authority.environmentId!,
                input: { requestId: `${requestId.current}:copy`, copy },
              }),
            );
          },
          resolve: async (input) =>
            unwrap(
              await resolve({
                environmentId: execution,
                input,
              }),
            ),
          create: async (localProjectId) => {
            const currentModels = buildModelOptions(
              config,
              review.model.selection,
              undefined,
              localProjectId,
            );
            if (
              !currentModels.some((model) => model.key === review.model.key && !model.isUnavailable)
            )
              throw new Error(
                "This model is unavailable for the chosen workspace. Review provider settings.",
              );
            unwrap(
              await create({
                environmentId: execution,
                input: {
                  commandId: CommandId.make(`${requestId.current}:thread`),
                  threadId: threadId.current,
                  projectId: localProjectId,
                  title: review.title,
                  modelSelection: review.model.selection,
                  runtimeMode: config?.settings.defaultRuntimeMode ?? DEFAULT_RUNTIME_MODE,
                  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
                  branch: null,
                  worktreePath: null,
                },
              }),
            );
          },
          bind: async (input) => {
            unwrap(
              await bind({
                environmentId: execution,
                input,
              }),
            );
          },
          snapshot: async () =>
            unwrap(
              await snapshot({ environmentId: execution, input: { threadId: threadId.current } }),
            ),
          registerHistory: async (archive) => {
            unwrap(
              await registerThread({
                environmentId: authority.environmentId!,
                input: { requestId: `${requestId.current}:history`, thread: archive },
              }),
            );
          },
          progress: (label) => {
            setProgress({ ...receipt.current });
            setPending(label);
          },
        },
      );
      refreshLibraryWork(authority.environmentId, launchProject.id);
      navigation.navigate("Thread", target);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The conversation could not be prepared. Retry the saved steps.",
      );
    } finally {
      busy.current = false;
      setProgress({ ...receipt.current });
      setPending(null);
    }
  }
  return (
    <LibraryPage title={props.sourceArchiveId ? "Linked continuation" : "New conversation"} back>
      <Text className="text-sm text-foreground-muted">
        {launchProject.title} supplies shared context. This conversation runs on one chosen
        computer. Its binding stays fixed.
      </Text>
      {props.projectNotice && progress.intent === null ? (
        <LibraryNotice
          detail={props.projectError ? null : props.projectNotice}
          error={props.projectError}
          onRetry={props.onRefreshProject}
        />
      ) : null}
      {props.reuseRootPath ? (
        <LibraryNotice detail="Review this folder for a new registration. Existing conversations keep their original working-copy association." />
      ) : null}
      {source.data ? (
        <SettingsSection title="Continuation source">
          <View className="p-4">
            <Text className="text-sm text-foreground">{source.data.summary.title}</Text>
            <Text className="text-xs text-foreground-muted">
              The saved source stays bound to its original computer. This continuation records an
              explicit link.
            </Text>
          </View>
        </SettingsSection>
      ) : props.sourceArchiveId ? (
        <LibraryNotice
          error={source.error}
          detail={source.error ? null : "Loading the saved source context…"}
          onRetry={source.refresh}
        />
      ) : null}
      {source.data && (source.error || source.isPending) && progress.intent === null ? (
        <LibraryNotice
          error={source.error}
          detail={source.error ? null : "Refreshing the saved source context…"}
          onRetry={source.error ? source.refresh : undefined}
        />
      ) : null}
      <TextInput
        accessibilityLabel="Conversation title"
        value={title}
        onChangeText={setTitle}
        editable={!locked}
        placeholder="Project discussion"
        maxLength={160}
        className="min-h-11 rounded-xl border border-input-border bg-input px-3 text-base text-foreground"
      />
      <SettingsSection title="Conversation context">
        <ListChoiceRow
          label="Whole project"
          description={
            repositories.length > 0
              ? "Discuss and work across every repository."
              : "Use the shared brief and links in a dedicated discussion workspace."
          }
          selected={scope === "all"}
          disabled={locked}
          onPress={() => {
            setScope("all");
            setCopyId(null);
          }}
        />
        {repositories.map((resource) => (
          <ListChoiceRow
            key={resource.id}
            label={resource.title}
            selected={scope === resource.id}
            disabled={locked}
            separated
            onPress={() => {
              setScope(resource.id);
              setCopyId(null);
            }}
          />
        ))}
      </SettingsSection>
      <SettingsSection title="Computer for this conversation">
        {environments.map((env, index) => {
          const connected = env.entry.enabled && env.connection.phase === "connected",
            supported = supportsLoomFeature(
              env.serverConfig?.environment.capabilities,
              "project-library",
            );
          return (
            <ListChoiceRow
              key={env.environmentId}
              label={env.label}
              selected={execution === env.environmentId}
              separated={index > 0}
              disabled={locked || !connected || !supported || !operable.has(env.environmentId)}
              description={
                !connected
                  ? "Offline"
                  : !supported
                    ? "Update Loom to run library conversations"
                    : !operable.has(env.environmentId)
                      ? "Conversation access required"
                      : "Connected"
              }
              onPress={() => {
                setExecution(env.environmentId);
                setCopyId(null);
                setModelKey(null);
              }}
            />
          );
        })}
      </SettingsSection>
      {execution ? (
        <>
          <SettingsSection title="Working files">
            <ListChoiceRow
              label="Use existing working copy"
              description={
                !copiesReady
                  ? "Checking registered working copies before preparing this conversation."
                  : eligible.length
                    ? "Reuse a registered copy before cloning another."
                    : "No compatible registered copy contains this scope on the selected computer."
              }
              selected={mode === "reuse"}
              disabled={locked || !copiesReady}
              onPress={() => setMode("reuse")}
            />
            {mode === "reuse"
              ? eligible.map((copy, index) => (
                  <ListChoiceRow
                    key={copy.id}
                    label={copy.rootPath}
                    selected={selectedCopy?.id === copy.id}
                    separated={index > 0}
                    disabled={locked || !copiesReady}
                    onPress={() => setCopyId(copy.id)}
                  />
                ))
              : null}
            <ListChoiceRow
              label="Use an existing folder"
              description={
                repositories.length > 0
                  ? "Review matching repositories already on this computer. Existing files stay user-owned."
                  : "Use an existing Git workspace on this computer. Existing files stay user-owned."
              }
              selected={mode === "folder"}
              disabled={locked || !copiesReady || !canPrepare}
              separated
              onPress={() => setMode("folder")}
            />
            <ListChoiceRow
              label={repositories.length > 0 ? "Clone project" : "Create discussion workspace"}
              description={
                repositories.length > 0
                  ? `Prepare all ${repositories.length} repositories together under one parent folder.`
                  : "Create a managed folder for the conversation and its saved checkpoints."
              }
              selected={mode === "clone"}
              disabled={locked || !copiesReady || !canPrepare || !writable.has(execution)}
              separated
              onPress={() => setMode("clone")}
            />
          </SettingsSection>
          {mode !== "reuse" ? (
            <TextInput
              accessibilityLabel="Parent folder on selected computer"
              placeholder="Absolute parent folder on this computer"
              value={rootPath}
              onChangeText={setRootPath}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!locked}
              className="min-h-11 rounded-xl border border-input-border bg-input px-3 text-sm text-foreground"
            />
          ) : null}
          <MaterialButton
            label={
              chosenModel
                ? `${chosenModel.providerLabel}: ${chosenModel.label}`
                : "No available agent model"
            }
            disabled={locked}
            onPress={() => setShowModels((value) => !value)}
          />
          {showModels ? (
            <SettingsSection title="Agent model">
              {models.map((model) => (
                <ListChoiceRow
                  key={model.key}
                  label={`${model.providerLabel}: ${model.label}`}
                  selected={chosenModel?.key === model.key}
                  disabled={locked}
                  onPress={() => {
                    setModelKey(model.key);
                    setShowModels(false);
                  }}
                />
              ))}
            </SettingsSection>
          ) : null}
        </>
      ) : null}
      {!authority.ready ? (
        <LibraryNotice detail="Reconnect the selected library server to register this conversation. Another computer will not replace that library." />
      ) : null}
      {copies.error ? <LibraryNotice error={copies.error} onRetry={copies.refresh} /> : null}
      {copiesState === "loading" && progress.intent === null ? (
        <LibraryNotice
          detail={
            !authority.connected
              ? "Reconnect the library to check working copies before preparing a conversation."
              : copies.data === null
                ? "Loading registered working copies…"
                : "Refreshing registered working copies…"
          }
        />
      ) : null}
      {modelKey !== null && !chosenModel && !progress.threadCreated ? (
        <LibraryNotice detail="The selected model is unavailable. Restore it in provider settings before resuming this preparation." />
      ) : null}
      {error ? <LibraryNotice error={error} /> : null}
      <MaterialButton
        label={pending ?? (progress.intent ? "Resume preparation" : "Open conversation")}
        tone="primary"
        disabled={pending !== null || !canStart}
        onPress={() => {
          void start();
        }}
      />
    </LibraryPage>
  );
}
