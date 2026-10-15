import { useAtomValue } from "@effect/atom-react";
import {
  useIsFocused,
  useFocusEffect,
  useNavigation,
  useRoute,
  type StaticScreenProps,
} from "@react-navigation/native";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { LibraryProject, LibraryThreadSummary } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { ListChoiceRow } from "../../components/ListChoiceRow";
import { MaterialButton } from "../../components/MaterialButton";
import { ScreenHeader } from "../../components/ScreenHeader";
import { ScreenScrollView } from "../../components/ScreenScrollView";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { uuidv4 } from "../../lib/uuid";
import { appAtomRegistry } from "../../state/atom-registry";
import { useHardwareKeyboardCommand } from "../../features/keyboard/hardwareKeyboardCommands";
import {
  library,
  refreshLibraryProject,
  refreshLibraryWork,
  useLibraryAuthority,
} from "./libraryState";
import { libraryListState, libraryRepositories, libraryScopeLabel } from "./libraryLogic";
import { LibraryCopySection } from "./LibraryCopySection";

export function LibraryPage(props: {
  title: string;
  children: ReactNode;
  back?: boolean;
  scroll?: boolean;
  actions?: Parameters<typeof ScreenHeader>[0]["actions"];
}) {
  const navigation = useNavigation();
  const focused = useIsFocused();
  const route = useRoute();
  useHardwareKeyboardCommand(
    "newTask",
    useCallback(() => {
      if (!focused) return false;
      const params = route.params;
      if (params && "projectId" in params && typeof params.projectId === "string")
        navigation.navigate("LibraryStart", { projectId: params.projectId });
      else navigation.navigate("Library");
      return true;
    }, [focused, route.params, navigation]),
  );
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-screen">
      <ScreenHeader
        title={props.title}
        onBack={props.back ? () => navigation.goBack() : undefined}
        actions={props.actions}
      />
      {props.scroll === false ? (
        props.children
      ) : (
        <ScreenScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            padding: 16,
            gap: 20,
            paddingBottom: Math.max(insets.bottom, 24) + 24,
          }}
        >
          {props.children}
        </ScreenScrollView>
      )}
    </View>
  );
}

export function LibraryNotice(props: {
  error?: string | null;
  detail?: string | null;
  onRetry?: () => void;
}) {
  return (
    <View className="gap-2">
      {props.detail ? <Text className="text-sm text-foreground-muted">{props.detail}</Text> : null}
      {props.error ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-danger-foreground">
          {props.error}
        </Text>
      ) : null}
      {props.onRetry ? (
        <MaterialButton label="Reload library" tone="text" onPress={props.onRetry} />
      ) : null}
    </View>
  );
}

export function LibraryRouteScreen() {
  const authority = useLibraryAuthority();
  const navigation = useNavigation();
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const projects = useEnvironmentQuery(
    authority.environmentId
      ? library.projects({ environmentId: authority.environmentId, input: { includeArchived } })
      : null,
  );
  const projectsState = libraryListState(projects);
  const projectsReady = projectsState === "ready" || projectsState === "empty";
  const canCreate = useAtomValue(library.createProject.permissionAtom(authority.environmentId));
  useFocusEffect(
    useCallback(() => {
      if (!authority.environmentId || !authority.connected || !authority.canRead) return;
      appAtomRegistry.refresh(
        library.projects({ environmentId: authority.environmentId, input: { includeArchived } }),
      );
    }, [authority.environmentId, authority.connected, authority.canRead, includeArchived]),
  );
  if (!authority.loaded)
    return (
      <LibraryPage title="Library">
        <Text className="text-foreground-muted">Loading your library connection…</Text>
      </LibraryPage>
    );
  if (!authority.environmentId) return <LibraryAuthorityScreen />;
  const list =
    projects.data?.filter((project) =>
      `${project.title} ${project.brief}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    ) ?? [];
  return (
    <LibraryPage
      title="Library"
      actions={[
        {
          icon: "gearshape",
          accessibilityLabel: "Library settings",
          onPress: () => navigation.navigate("LibrarySettings"),
        },
        {
          icon: "text.bubble",
          accessibilityLabel: "Host conversations",
          onPress: () => navigation.navigate("Home"),
        },
      ]}
    >
      <View className="gap-3">
        <Text className="text-sm text-foreground-muted">
          Projects keep their brief, components, and conversation history. Choose a computer when
          you start work.
        </Text>
        <MaterialButton
          label="Create project"
          tone="primary"
          disabled={!authority.ready || !canCreate || !projectsReady}
          onPress={() => navigation.navigate("LibraryCreate")}
        />
      </View>
      <TextInput
        accessibilityLabel="Search library projects"
        placeholder="Search projects"
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        className="min-h-11 rounded-xl border border-input-border bg-input px-3 text-sm text-foreground"
      />
      <MaterialButton
        label={includeArchived ? "Hide archived projects" : "Show archived projects"}
        tone="text"
        onPress={() => setIncludeArchived((current) => !current)}
      />
      {!authority.connected ? (
        <LibraryNotice
          detail={`Your saved library is available below. Reconnect ${authority.label} to save changes.`}
        />
      ) : !authority.supported ? (
        <LibraryNotice detail="Update the library server to use this library." />
      ) : null}
      {projects.error ? <LibraryNotice error={projects.error} onRetry={projects.refresh} /> : null}
      {projectsState === "loading" ? (
        <Text className="text-foreground-muted">
          {!authority.connected
            ? "No library projects are cached on this device. Reconnect the selected library to load them."
            : projects.data === null
              ? "Loading saved projects…"
              : "Refreshing saved projects…"}
        </Text>
      ) : null}
      {list.map((project) => (
        <Pressable
          key={project.id}
          accessibilityRole="button"
          accessibilityLabel={`Open ${project.title}${project.archived ? ", archived" : ""}`}
          onPress={() => navigation.navigate("LibraryProject", { projectId: project.id })}
          className="gap-2 rounded-2xl bg-card p-4 active:opacity-70"
        >
          <Text className="text-lg font-t3-semibold text-foreground">{project.title}</Text>
          <Text className="text-sm text-foreground-muted" numberOfLines={3}>
            {project.brief || "Add a brief to keep shared context with this project."}
          </Text>
          <Text className="text-xs text-foreground-muted">
            {libraryRepositories(project).length} components{project.archived ? " · Archived" : ""}
          </Text>
        </Pressable>
      ))}
      {projectsReady && list.length === 0 ? (
        <EmptyState
          variant="plain"
          title={query ? "No matching projects" : "No projects yet"}
          detail={
            query
              ? "Try another name or brief."
              : "Create a project first. It does not need a computer or working files."
          }
        />
      ) : null}
    </LibraryPage>
  );
}

export function LibraryAuthorityScreen() {
  const authority = useLibraryAuthority();
  const { environments } = useEnvironments();
  const navigation = useNavigation();
  const info = useAtomQueryRunner(library.info, { refresh: true, reportFailure: false });
  const [pending, setPending] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  return (
    <LibraryPage title="Connect your library" back={!!authority.environmentId}>
      <Text className="text-sm text-foreground-muted">
        Choose where Loom keeps your shared library once. Projects can use any connected execution
        computer later.
      </Text>
      {authority.environmentId ? (
        <Text className="text-sm text-foreground">
          Current library: {authority.label}. Changing it opens another library; it does not move
          saved projects.
        </Text>
      ) : null}
      <SettingsSection title="Library server">
        {environments.map((environment, index) => {
          const connected =
            environment.entry.enabled && environment.connection.phase === "connected";
          const supported = supportsLoomFeature(
            environment.serverConfig?.environment.capabilities,
            "project-library",
          );
          return (
            <ListChoiceRow
              key={environment.environmentId}
              label={environment.label}
              selected={authority.environmentId === environment.environmentId}
              separated={index > 0}
              disabled={!connected || !supported || pending !== null}
              description={
                !connected
                  ? "Offline"
                  : !supported
                    ? "Update this server to support the library"
                    : "Connected"
              }
              onPress={() => {
                setPending(environment.environmentId);
                setError(null);
                void (async () => {
                  try {
                    const result = await info({
                      environmentId: environment.environmentId,
                      input: {},
                    });
                    if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
                    await authority.select(environment.environmentId);
                    navigation.navigate("Library");
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "The library connection could not be saved.",
                    );
                  } finally {
                    setPending(null);
                  }
                })();
              }}
            />
          );
        })}
      </SettingsSection>
      {error ? <LibraryNotice error={error} /> : null}
      <MaterialButton
        label="Sign in to library"
        tone="primary"
        onPress={() =>
          navigation.navigate(
            "LibrarySignIn",
            authority.environmentId ? { environmentId: authority.environmentId } : {},
          )
        }
      />
      <MaterialButton
        label="Manage computer connections"
        tone="text"
        onPress={() => navigation.navigate("Connections")}
      />
      <MaterialButton
        label="T3 Connect account settings"
        tone="text"
        onPress={() => navigation.navigate("SettingsSheet", { screen: "SettingsAuth" })}
      />
    </LibraryPage>
  );
}

export function LibraryProjectRouteScreen({
  route,
}: StaticScreenProps<{ readonly projectId: string }>) {
  return <LibraryProjectContent key={route.params.projectId} projectId={route.params.projectId} />;
}
function LibraryProjectContent({ projectId }: { projectId: string }) {
  const authority = useLibraryAuthority(),
    navigation = useNavigation(),
    { environments } = useEnvironments();
  const target = authority.environmentId;
  const project = useEnvironmentQuery(
    target ? library.project({ environmentId: target, input: { projectId } }) : null,
  );
  const threads = useEnvironmentQuery(
    target ? library.threads({ environmentId: target, input: { projectId } }) : null,
  );
  const [showRemovedCopies, setShowRemovedCopies] = useState(false);
  const copies = useEnvironmentQuery(
    target
      ? library.copies({
          environmentId: target,
          input: { projectId, ...(showRemovedCopies ? { includeReleased: true } : {}) },
        })
      : null,
  );
  const copiesState = libraryListState(copies);
  const copiesReady = copiesState === "ready" || copiesState === "empty";
  const threadsState = libraryListState(threads);
  const threadListNotice =
    threadsState === "loading"
      ? !authority.connected
        ? "Reconnect the selected library to load conversation history."
        : threads.data === null
          ? "Loading conversation history…"
          : "Refreshing conversation history…"
      : null;
  const [tab, setTab] = useState<"overview" | "resources" | "threads" | "copies">("overview");
  const canArchive = useAtomValue(library.archiveProject.permissionAtom(target));
  const archive = useAtomCommand(library.archiveProject, { reportFailure: false });
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!target || !authority.connected || !authority.canRead) return;
      refreshLibraryProject(target, projectId);
      refreshLibraryWork(target, projectId);
    }, [target, projectId, authority.connected, authority.canRead]),
  );
  if (!target) return <LibraryAuthorityScreen />;
  if (!project.data)
    return (
      <LibraryPage title="Project" back>
        <LibraryNotice
          error={project.error}
          detail={
            project.error
              ? null
              : !authority.connected
                ? "This project is not cached on this device. Reconnect the selected library to load it."
                : "Loading the saved project…"
          }
          onRetry={project.refresh}
        />
      </LibraryPage>
    );
  const p = project.data,
    hostLabel = (id: string) =>
      environments.find((env) => env.environmentId === id)?.label ?? "Saved computer";
  const showThread = (thread: LibraryThreadSummary) =>
    navigation.navigate("LibraryHistory", { projectId: p.id, archiveId: thread.id });
  return (
    <LibraryPage
      title={p.title}
      back
      actions={[
        {
          icon: "pencil",
          accessibilityLabel: "Edit project resources and brief",
          disabled: !authority.ready,
          onPress: () => navigation.navigate("LibraryEdit", { projectId: p.id }),
        },
      ]}
    >
      {!authority.connected ? (
        <LibraryNotice detail="Viewing saved library data. Reconnect the library server to make changes." />
      ) : null}
      <View className="gap-3">
        <Text className="text-sm text-foreground-muted">
          {libraryRepositories(p).length} components
          {threads.data !== null
            ? ` · ${threads.data.length} saved conversations`
            : threadsState === "error"
              ? " · Conversations unavailable"
              : " · Loading conversations…"}
        </Text>
        <MaterialButton
          label="New conversation"
          tone="primary"
          disabled={!authority.ready || p.archived}
          onPress={() => navigation.navigate("LibraryStart", { projectId: p.id })}
        />
        {libraryRepositories(p).length === 0 ? (
          <Text className="text-sm text-foreground-muted">
            Start a discussion using this project's brief and links. Add repositories when the work
            needs them.
          </Text>
        ) : null}
      </View>
      <View className="flex-row flex-wrap gap-2">
        {(["overview", "resources", "threads", "copies"] as const).map((value) => (
          <MaterialButton
            key={value}
            label={
              value === "overview"
                ? "Overview"
                : value === "resources"
                  ? "Resources"
                  : value === "threads"
                    ? "Conversations"
                    : "Working copies"
            }
            tone={tab === value ? "secondary" : "text"}
            onPress={() => {
              if (
                (value === "copies" || value === "threads") &&
                authority.connected &&
                authority.canRead
              )
                refreshLibraryWork(target, projectId);
              setTab(value);
            }}
          />
        ))}
      </View>
      {tab === "overview" ? (
        <>
          <SettingsSection title="Shared brief">
            <View className="p-4">
              <Text selectable className="text-sm leading-normal text-foreground">
                {p.brief || "Add a brief to capture the purpose of this project."}
              </Text>
            </View>
          </SettingsSection>
          <SettingsSection title="Recent activity">
            {(threads.data ?? []).slice(0, 5).map((thread) => (
              <LibraryThreadRow
                key={thread.id}
                thread={thread}
                project={p}
                computerLabel={hostLabel(thread.environmentId)}
                onPress={() => showThread(thread)}
              />
            ))}
            {threadsState === "empty" ? (
              <Text className="p-4 text-sm text-foreground-muted">No saved conversations yet.</Text>
            ) : null}
            {threadListNotice || threads.error ? (
              <View className="p-4">
                <LibraryNotice
                  detail={threadListNotice}
                  error={threads.error}
                  onRetry={threads.error ? threads.refresh : undefined}
                />
              </View>
            ) : null}
          </SettingsSection>
        </>
      ) : null}
      {tab === "resources" ? (
        <SettingsSection title="Components">
          {p.resources.map((resource) => (
            <View key={resource.id} className="gap-1 p-4">
              <Text className="text-base font-t3-medium text-foreground">{resource.title}</Text>
              <Text selectable className="text-sm text-foreground-muted">
                {resource.kind === "link"
                  ? resource.url
                  : (resource.remoteUrl ?? "Existing local repository")}
              </Text>
              {resource.kind !== "link" ? (
                <Text className="text-xs text-foreground-muted">
                  Folder: {resource.relativePath}
                </Text>
              ) : null}
            </View>
          ))}
          <MaterialButton
            label="Edit resources"
            tone="text"
            disabled={!authority.ready}
            onPress={() => navigation.navigate("LibraryEdit", { projectId: p.id })}
          />
        </SettingsSection>
      ) : null}
      {tab === "threads" ? (
        <SettingsSection title="Conversations">
          {(threads.data ?? []).map((thread) => (
            <LibraryThreadRow
              key={thread.id}
              thread={thread}
              project={p}
              computerLabel={hostLabel(thread.environmentId)}
              onPress={() => showThread(thread)}
            />
          ))}
          {threadListNotice || threads.error ? (
            <LibraryNotice
              error={threads.error}
              detail={threadListNotice}
              onRetry={threads.error ? threads.refresh : undefined}
            />
          ) : null}
          {threadsState === "empty" ? (
            <Text className="p-4 text-sm text-foreground-muted">No saved conversations yet.</Text>
          ) : null}
        </SettingsSection>
      ) : null}
      {tab === "copies" ? (
        <View className="gap-4">
          <Text className="text-sm text-foreground-muted">
            Working files have a computer and folder. Removing a safe Loom-owned copy keeps this
            project and its history.
          </Text>
          <MaterialButton
            label={showRemovedCopies ? "Hide removed copies" : "Show removed copies"}
            tone="text"
            onPress={() => setShowRemovedCopies((current) => !current)}
          />
          {(copies.data ?? []).map((copy) => (
            <LibraryCopySection
              key={copy.id}
              copy={copy}
              authorityEnvironmentId={target}
              authorityReady={authority.ready && copiesReady}
              computerLabel={hostLabel(copy.environmentId)}
              onReuseFolder={() =>
                navigation.navigate("LibraryStart", {
                  projectId: p.id,
                  reuseEnvironmentId: copy.environmentId,
                  reuseRootPath: copy.rootPath,
                })
              }
              onChanged={() => refreshLibraryWork(target, projectId)}
            />
          ))}
          {copiesState === "empty" ? (
            <Text className="text-sm text-foreground-muted">
              No working copies. Start a conversation to choose a computer and reuse or prepare
              files.
            </Text>
          ) : null}
          {copiesState === "loading" ? (
            <LibraryNotice
              detail={
                !authority.connected
                  ? "Reconnect the selected library to load working copies."
                  : copies.data === null
                    ? "Loading working copies…"
                    : "Refreshing working copies…"
              }
            />
          ) : null}
          {copies.error ? <LibraryNotice error={copies.error} onRetry={copies.refresh} /> : null}
        </View>
      ) : null}
      {project.error ? <LibraryNotice error={project.error} onRetry={project.refresh} /> : null}
      {error ? <LibraryNotice error={error} /> : null}
      <MaterialButton
        label={p.archived ? "Reopen project" : "Archive project"}
        tone="text"
        disabled={!authority.ready || !canArchive || pending}
        onPress={() => {
          setPending(true);
          setError(null);
          void archive({
            environmentId: target,
            input: {
              requestId: uuidv4(),
              projectId: p.id,
              expectedRevision: p.revision,
              archived: !p.archived,
            },
          })
            .then((result) => {
              if (AsyncResult.isFailure(result)) throw squashAtomCommandFailure(result);
              refreshLibraryProject(target, p.id);
            })
            .catch((cause) =>
              setError(
                cause instanceof Error ? cause.message : "The project could not be updated.",
              ),
            )
            .finally(() => setPending(false));
        }}
      />
    </LibraryPage>
  );
}
function LibraryThreadRow(props: {
  thread: LibraryThreadSummary;
  project: LibraryProject;
  computerLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      className="gap-1 p-4 active:opacity-70"
    >
      <Text className="text-sm font-t3-medium text-foreground">{props.thread.title}</Text>
      <Text className="text-xs text-foreground-muted">
        {libraryScopeLabel(props.project, props.thread.resourceIds)} · {props.computerLabel}
      </Text>
      <Text className="text-xs text-foreground-muted">
        {props.thread.status} · Saved {new Date(props.thread.syncedAt).toLocaleString()}
      </Text>
    </Pressable>
  );
}
