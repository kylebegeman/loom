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
  const navigation = useNavigation();
  const authority = useLibraryAuthority();
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const catalog = useEnvironmentQuery(
    authority.environmentId
      ? library.projects({
          environmentId: authority.environmentId,
          input: { includeArchived: true },
        })
      : null,
  );
  const canCreate = useAtomValue(library.createProject.permissionAtom(authority.environmentId));
  useFocusEffect(
    useCallback(() => {
      if (authority.connected) {
        catalog.refresh();
        authority.info.refresh();
      }
    }, [authority.connected, catalog.refresh, authority.info.refresh]),
  );
  const query = search.trim().toLocaleLowerCase();
  const projects = (catalog.data ?? [])
    .filter(
      (p) =>
        p.archived === archived &&
        (!query ||
          [p.title, p.brief, ...p.resources.map((r) => r.title)].some((text) =>
            text.toLocaleLowerCase().includes(query),
          )),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <LibraryPage
      title="Projects"
      back={navigation.canGoBack()}
      actions={
        authority.environmentId
          ? [
              {
                icon: "plus",
                accessibilityLabel: "New project",
                disabled: !authority.ready || !canCreate,
                onPress: () => navigation.navigate("LibraryCreate"),
              },
            ]
          : undefined
      }
    >
      <Text className="text-sm text-foreground-muted">
        Keep the context, repositories and conversations for each thing you’re building together.
      </Text>
      {!authority.environmentId ? (
        <View className="gap-3">
          <Text className="text-sm text-foreground">
            Connect your Library once. Your existing threads and folders remain available.
          </Text>
          <MaterialButton
            label="Connect Library"
            tone="primary"
            onPress={() => navigation.navigate("LibrarySettings")}
          />
        </View>
      ) : (
        <>
          {!authority.connected ? (
            <LibraryNotice detail="Library offline. Saved projects remain available; reconnect to save changes." />
          ) : null}
          {authority.connected && !authority.ready ? (
            <LibraryNotice
              error={authority.info.error}
              detail={
                authority.info.error
                  ? null
                  : !authority.supported
                    ? "This computer needs a Loom update to manage shared projects."
                    : !authority.canRead
                      ? "Sign in to your Library to manage projects."
                      : "Connecting to your Library..."
              }
              onRetry={authority.info.refresh}
            />
          ) : authority.ready && !canCreate ? (
            <LibraryNotice detail="This connection can browse projects. Sign in with your owner account to create or edit them." />
          ) : null}
          <TextInput
            accessibilityLabel="Search projects"
            placeholder="Search projects"
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            className="min-h-[44px] rounded-xl bg-field px-4 text-base text-foreground"
          />
          <View className="flex-row gap-2">
            <MaterialButton
              label="Active"
              tone={archived ? "text" : "secondary"}
              onPress={() => setArchived(false)}
            />
            <MaterialButton
              label="Archived"
              tone={archived ? "secondary" : "text"}
              onPress={() => setArchived(true)}
            />
          </View>
          <LibraryNotice
            error={catalog.error}
            detail={catalog.isPending && catalog.data === null ? "Loading projects..." : null}
            onRetry={catalog.error ? catalog.refresh : undefined}
          />
          <SettingsSection>
            {projects.map((project, index) => (
              <ListChoiceRow
                key={project.id}
                label={project.title}
                selected={false}
                description={
                  project.resources
                    .filter((r) => r.kind !== "link")
                    .map((r) => r.title)
                    .join(", ") ||
                  project.brief ||
                  "No repositories added yet"
                }
                separated={index > 0}
                onPress={() => navigation.navigate("LibraryProject", { projectId: project.id })}
              />
            ))}
          </SettingsSection>
          {!catalog.isPending && !catalog.error && !projects.length ? (
            <View className="gap-3 py-4">
              <Text className="text-base font-t3-medium text-foreground">
                {query
                  ? "No matching projects"
                  : archived
                    ? "No archived projects"
                    : "Bring your work together"}
              </Text>
              <Text className="text-sm text-foreground-muted">
                {query
                  ? "Try another name or component."
                  : archived
                    ? "Archived projects keep their context and conversations."
                    : "Create a project with its brief and separate component repositories. Choose a computer when you start work."}
              </Text>
              {!query && !archived ? (
                <MaterialButton
                  label="New project"
                  tone="primary"
                  disabled={!authority.ready || !canCreate}
                  onPress={() => navigation.navigate("LibraryCreate")}
                />
              ) : null}
            </View>
          ) : null}
        </>
      )}
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
    <LibraryPage title="Connect your library" back={navigation.canGoBack()}>
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
                    if (result.value.isAuthority !== true)
                      throw new Error(
                        "Choose your Library server. This computer runs work and does not own the shared catalog.",
                      );
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
      environments.find((env) => env.environmentId === id)?.label ??
      authority.computers.find((entry) => entry.environmentId === id)?.label ??
      "Saved computer";
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
