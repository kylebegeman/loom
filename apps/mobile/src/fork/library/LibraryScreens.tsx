import { useNewTaskLibraryProjects, useLibraryProjectStarts } from "./NewTaskLibraryProjects";
import {
  useLibraryStartProjects,
  useLibraryStartProject,
  useLibraryStartCopies,
} from "./libraryState";
import { LibraryWorkflows, LibraryPreservationCenter } from "./LibraryWorkflows";
import { ProjectSites } from "../sites/ProjectSites";
import { useAtomValue } from "@effect/atom-react";
import {
  useIsFocused,
  useFocusEffect,
  useNavigation,
  useRoute,
  type StaticScreenProps,
} from "@react-navigation/native";
import {
  filterProjectEntries,
  libraryActiveCopies,
  libraryStartIntent,
  libraryStartRepositoryProjects,
  libraryResourceLocation,
  projectEntries,
  sortProjectEntries,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  LibraryProject,
  LibraryProjectColor,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useState, type ReactNode } from "react";
import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResolveClassNames } from "uniwind";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { Button } from "../../components/ui/Button";
import { RowPressable } from "../../components/ui/RowPressable";
import { AppBar } from "../../components/ui/AppBar";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { cn } from "../../lib/cn";
import { uuidv4 } from "../../lib/uuid";
import { relativeTime } from "../../lib/time";
import { useHardwareKeyboardCommand } from "../../features/keyboard/hardwareKeyboardCommands";
import {
  library,
  refreshLibraryProject,
  refreshLibraryWork,
  useLibraryAuthority,
} from "./libraryState";
import { libraryListState, libraryRepositories, libraryScopeLabel } from "./libraryLogic";
import { LibraryCopySection } from "./LibraryCopySection";
import { LibraryRestingProjects } from "./LibraryTidy";
import { LibraryProjectTile } from "./libraryProjectColors";
import { LibraryBriefProposalsRow } from "./LibraryBriefProposalsRow";
import { LibraryHistorySearchEntry } from "./LibraryHistorySearch";
import { LibraryTimelinePreview } from "./LibraryTimeline";

const RECENT_CONVERSATIONS = 5;
const ANY_COLOR: ReadonlySet<LibraryProjectColor> = new Set();
const ago = (iso: string) => `${relativeTime(iso)} ago`;

export function LibraryPage(props: {
  title: string;
  children: ReactNode;
  back?: boolean;
  scroll?: boolean;
  actions?: Parameters<typeof AppBar>[0]["actions"];
}) {
  const navigation = useNavigation();
  const focused = useIsFocused();
  const route = useRoute();
  useHardwareKeyboardCommand(
    "newTask",
    useCallback(() => {
      if (!focused) return false;
      const params = route.params;
      // A project in view only leads the picker, as on web; the others and No project follow it.
      if (params && "projectId" in params && typeof params.projectId === "string")
        navigation.navigate("NewTaskProject", { libraryProjectId: params.projectId });
      else navigation.navigate("NewTaskProject");
      return true;
    }, [focused, route.params, navigation]),
  );
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-screen">
      <AppBar
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
          automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
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
      {props.onRetry ? <Button label="Reload library" tone="text" onPress={props.onRetry} /> : null}
    </View>
  );
}

export function LibraryRouteScreen() {
  const navigation = useNavigation();
  const authority = useLibraryAuthority();
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const catalog = useLibraryStartProjects(true);
  const canCreate = useAtomValue(library.createProject.permissionAtom(authority.environmentId));
  const refreshCatalog = catalog.refresh;
  const refreshInfo = authority.info.refresh;
  useFocusEffect(
    useCallback(() => {
      if (authority.connected) {
        refreshCatalog();
        refreshInfo();
      }
    }, [authority.connected, refreshCatalog, refreshInfo]),
  );
  const starts = useNewTaskLibraryProjects({ searchText: "" });
  const query = search.trim();
  const intent = libraryStartIntent(search);
  const associated =
    intent.kind === "repository"
      ? libraryStartRepositoryProjects(catalog.data ?? [], intent.url)
      : [];
  // The list carries no copies, so search reads names, briefs and repositories, never computers.
  const projects = sortProjectEntries(
    filterProjectEntries(
      projectEntries(
        (catalog.data ?? []).filter((p) => p.archived === archived),
        [],
        null,
      ),
      { search, colors: ANY_COLOR, computer: null },
      () => "",
    ),
    "activity",
  ).map((entry) => entry.project);
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
      {!authority.environmentId ? (
        <View className="gap-3">
          <Text className="text-sm text-foreground">
            Connect your Library once. Your existing threads and folders remain available.
          </Text>
          <Button
            label="Connect Library"
            tone="primary"
            onPress={() => navigation.navigate("LibrarySettings")}
          />
        </View>
      ) : (
        <>
          {!authority.connected ? (
            <LibraryNotice detail="Library offline. Projects with registered files on connected computers remain available; new conversations sync when it reconnects." />
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
          {authority.info.data?.features?.includes("project-workflows") ? (
            <LibraryPreservationCenter environmentId={authority.environmentId} />
          ) : null}
          <TextInput
            accessibilityLabel="Search projects"
            placeholder="Search projects"
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            className="min-h-[44px] rounded-xl bg-field px-4 text-base text-foreground"
          />
          {intent.kind !== "search" ? (
            <View className="gap-2">
              {associated.map((project) => (
                <Button
                  key={project.id}
                  label={`Continue ${project.title}`}
                  onPress={() => {
                    const start = starts.choices.find(
                      (entry) => entry.project.id === project.id,
                    )?.start;
                    navigation.navigate("LibraryStart", {
                      projectId: project.id,
                      startNow: true,
                      ...(start
                        ? { reuseEnvironmentId: start.environmentId, initialCopyId: start.copyId }
                        : {}),
                    });
                  }}
                />
              ))}
              <Button
                label={
                  intent.kind === "folder"
                    ? `Use folder: ${intent.title}`
                    : associated.length
                      ? `Create another project from ${intent.title}`
                      : `Start from repository: ${intent.title}`
                }
                disabled={!canCreate || !authority.ready}
                onPress={() =>
                  navigation.navigate("LibraryCreate", { initialInput: search.trim() })
                }
              />
            </View>
          ) : null}
          <View className="flex-row gap-2">
            <Button
              label="Active"
              tone={archived ? "text" : "secondary"}
              onPress={() => setArchived(false)}
            />
            <Button
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
              <LibraryProjectRow
                key={project.id}
                project={project}
                separated={index > 0}
                onPress={() => navigation.navigate("LibraryProject", { projectId: project.id })}
              />
            ))}
          </SettingsSection>
          {!archived && !query ? <LibraryRestingProjects /> : null}
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
                    : "Add a project or an existing folder. Choose a computer when you start a conversation."}
              </Text>
              {!query && !archived ? (
                <Button
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
      <LibraryHistorySearchEntry />
      <Button label="Sites and activity" tone="text" onPress={() => navigation.navigate("Sites")} />
    </LibraryPage>
  );
}

function LibraryProjectRow(props: {
  project: LibraryProject;
  separated: boolean;
  onPress: () => void;
}) {
  const rippleStyle = useResolveClassNames("bg-subtle-strong");
  const description =
    libraryRepositories(props.project)
      .map((r) => r.title)
      .join(", ") ||
    props.project.brief ||
    "Conversations, files and project context";
  return (
    <RowPressable
      accessibilityRole="button"
      accessibilityLabel={props.project.title}
      accessibilityHint={description}
      onPress={props.onPress}
      android_ripple={{ color: rippleStyle.backgroundColor }}
      unstable_pressDelay={Platform.OS === "android" ? 50 : undefined}
      className={cn("bg-grouped-card", props.separated && "border-t border-border-subtle")}
    >
      <View className="min-h-18 flex-row items-center gap-3 px-4 py-3">
        <LibraryProjectTile project={props.project} />
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-base text-foreground">{props.project.title}</Text>
          <Text className="text-sm text-foreground-muted" numberOfLines={2}>
            {description}
          </Text>
        </View>
      </View>
    </RowPressable>
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
      <Button
        label="Sign in to library"
        tone="primary"
        onPress={() =>
          navigation.navigate(
            "LibrarySignIn",
            authority.environmentId ? { environmentId: authority.environmentId } : {},
          )
        }
      />
      <Button
        label="Manage computer connections"
        tone="text"
        onPress={() => navigation.navigate("Connections")}
      />
      <Button
        label="T3 Connect account settings"
        tone="text"
        onPress={() => navigation.navigate("SettingsAuth")}
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
  const project = useLibraryStartProject(projectId);
  const threads = useEnvironmentQuery(
    target ? library.threads({ environmentId: target, input: { projectId } }) : null,
  );
  const copies = useLibraryStartCopies(projectId, true);
  const starts = useLibraryProjectStarts(
    project.data ? [project.data] : [],
    copies.data ?? [],
    threads.data ?? [],
  );
  const start = starts.get(projectId);
  const copiesState = libraryListState(copies);
  const copiesReady = copiesState === "ready" || copiesState === "empty";
  // Info and copies are cached separately, so a newer cached lastSeenAt could make older cached
  // health look recent. Only copies read live from the connected authority may be aged by it, and
  // they stay trusted while a refresh is in flight so the age does not jump back and forth.
  const [liveCopies, setLiveCopies] = useState<typeof copies.data>(null);
  const nextLiveCopies = !authority.ready ? null : copiesReady ? copies.data : liveCopies;
  if (nextLiveCopies !== liveCopies) setLiveCopies(nextLiveCopies);
  const copiesLive = liveCopies !== null && copies.data === liveCopies;
  const threadsState = libraryListState(threads);
  const threadListNotice =
    threadsState === "loading"
      ? !authority.connected
        ? "Reconnect the selected library to load conversation history."
        : threads.data === null
          ? "Loading conversation history…"
          : "Refreshing conversation history…"
      : null;
  const [showAllThreads, setShowAllThreads] = useState(false),
    [showHistory, setShowHistory] = useState(false);
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
                ? "Looking for registered project files on connected computers. Reconnect the Library to load other projects."
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
      "Saved computer",
    lastSeenAt = (id: string) =>
      copiesLive
        ? authority.computers.find((entry) => entry.environmentId === id)?.lastSeenAt
        : undefined;
  const showThread = (thread: LibraryThreadSummary) =>
    navigation.navigate("LibraryHistory", { projectId: p.id, archiveId: thread.id });
  const reuseFolder = (copy: LibraryWorkingCopy) =>
    navigation.navigate("LibraryStart", {
      projectId: p.id,
      reuseEnvironmentId: copy.environmentId,
      reuseRootPath: copy.rootPath,
    });
  const repositories = libraryRepositories(p),
    links = p.resources.length - repositories.length;
  const activeCopies = libraryActiveCopies(copies.data ?? []),
    removedCopies = (copies.data ?? [])
      .filter((copy) => !activeCopies.includes(copy))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const visibleThreads = (threads.data ?? [])
    .filter((thread) => !thread.deleted)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <LibraryPage
      title={p.title}
      back
      actions={[
        {
          icon: "pencil",
          accessibilityLabel: "Edit project",
          disabled: !authority.ready,
          onPress: () => navigation.navigate("LibraryEdit", { projectId: p.id }),
        },
      ]}
    >
      {!authority.connected ? (
        <LibraryNotice detail="Library offline. Start from a computer's registered copy, or reconnect to edit the project and prepare files." />
      ) : null}
      <View className="gap-3">
        <Text className="text-sm text-foreground-muted">
          {[
            `Edited ${ago(p.updatedAt)}`,
            repositories.length
              ? `${repositories.length} ${repositories.length === 1 ? "repository" : "repositories"}`
              : null,
            links ? `${links} ${links === 1 ? "link" : "links"}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        {p.archived ? (
          <LibraryNotice detail="Archived. Conversations stay readable; reopen the project to change it or start new work." />
        ) : null}
        <Button
          label="New conversation"
          tone="primary"
          disabled={
            p.archived || (!authority.ready && !activeCopies.some((copy) => copy.state === "ready"))
          }
          onPress={() =>
            navigation.navigate("LibraryStart", {
              projectId: p.id,
              startNow: true,
              ...(start
                ? { reuseEnvironmentId: start.environmentId, initialCopyId: start.copyId }
                : {}),
            })
          }
        />
      </View>
      {authority.info.data?.features?.includes("project-workflows") ? (
        <LibraryWorkflows
          key={`${target}:${p.id}`}
          environmentId={target}
          project={p}
          copies={activeCopies}
          threads={visibleThreads}
        />
      ) : null}
      <SettingsSection
        title={
          showAllThreads || visibleThreads.length <= RECENT_CONVERSATIONS
            ? "Conversations"
            : "Recent conversations"
        }
      >
        {(showAllThreads ? visibleThreads : visibleThreads.slice(0, RECENT_CONVERSATIONS)).map(
          (thread) => (
            <LibraryThreadRow
              key={thread.id}
              thread={thread}
              project={p}
              computerLabel={hostLabel(thread.environmentId)}
              onPress={() => showThread(thread)}
            />
          ),
        )}
        {visibleThreads.length > RECENT_CONVERSATIONS ? (
          <Button
            label={showAllThreads ? "Show recent only" : `Show all ${visibleThreads.length}`}
            tone="text"
            onPress={() => setShowAllThreads((current) => !current)}
          />
        ) : null}
        {threadsState === "empty" ? (
          <Text className="p-4 text-sm text-foreground-muted">
            No conversations yet. Start one about the whole project or a single repository.
          </Text>
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
      <LibraryHistorySearchEntry projectId={p.id} />
      <View className="gap-3">
        <Text className="text-base font-t3-medium text-foreground">Project files</Text>
        <Button
          label="Tidy..."
          tone="secondary"
          onPress={() => navigation.navigate("LibraryTidy", { projectId: p.id })}
        />
        {activeCopies.map((copy) => (
          <LibraryCopySection
            key={copy.id}
            project={p}
            copy={copy}
            lastSeenAt={lastSeenAt(copy.environmentId)}
            authorityEnvironmentId={target}
            authorityReady={authority.ready && copiesReady}
            computerLabel={hostLabel(copy.environmentId)}
            onReuseFolder={() => reuseFolder(copy)}
            onChanged={() => refreshLibraryWork(target, projectId)}
          />
        ))}
        {copiesReady && activeCopies.length === 0 ? (
          <Text className="text-sm text-foreground-muted">
            Start work to prepare files on your chosen computer. Your project and conversations stay
            saved when the files are removed.
          </Text>
        ) : null}
        {copiesState === "loading" ? (
          <LibraryNotice
            detail={
              !authority.connected
                ? "Reconnect the selected library to check your computers."
                : "Checking your computers…"
            }
          />
        ) : null}
        {copies.error ? <LibraryNotice error={copies.error} onRetry={copies.refresh} /> : null}
        <Button
          label="Work on another computer"
          tone="secondary"
          disabled={
            p.archived || (!authority.ready && !activeCopies.some((copy) => copy.state === "ready"))
          }
          onPress={() => navigation.navigate("LibraryStart", { projectId: p.id })}
        />
      </View>
      {removedCopies.length ? (
        <View className="gap-3">
          <Button
            label={showHistory ? "Hide removed file locations" : "Removed file locations"}
            tone="text"
            onPress={() => setShowHistory((current) => !current)}
          />
          {showHistory ? (
            <>
              <Text className="text-sm text-foreground-muted">
                Your project and conversations stay saved. Restore files here or reopen a
                conversation to continue. Existing folders stay on disk until you remove them
                yourself.
              </Text>
              {removedCopies.map((copy) => (
                <LibraryCopySection
                  key={copy.id}
                  project={p}
                  copy={copy}
                  lastSeenAt={lastSeenAt(copy.environmentId)}
                  authorityEnvironmentId={target}
                  authorityReady={authority.ready && copiesReady}
                  computerLabel={`${hostLabel(copy.environmentId)} · removed ${ago(copy.updatedAt)}`}
                  onReuseFolder={() => reuseFolder(copy)}
                  onChanged={() => refreshLibraryWork(target, projectId)}
                />
              ))}
            </>
          ) : null}
        </View>
      ) : null}
      <LibraryTimelinePreview projectId={p.id} />
      <SettingsSection title="Brief">
        <View className="p-4">
          <Text selectable className="text-sm leading-normal text-foreground">
            {p.brief ||
              "Every conversation in this project starts with the brief. Say what you're building and what matters."}
          </Text>
        </View>
        <LibraryBriefProposalsRow project={p} authorityId={target} hostLabel={hostLabel} />
      </SettingsSection>
      <ProjectSites environmentId={target} projectId={p.id} />
      <SettingsSection title="Repositories and links">
        {p.resources.map((resource) => (
          <View key={resource.id} className="gap-1 px-4 py-3">
            <Text className="text-sm font-t3-medium text-foreground">{resource.title}</Text>
            <Text selectable className="text-xs text-foreground-muted">
              {libraryResourceLocation(resource)}
            </Text>
          </View>
        ))}
        {p.resources.length === 0 ? (
          <Text className="p-4 text-sm text-foreground-muted">
            Add the repositories this project is made of, plus any links worth keeping close.
          </Text>
        ) : null}
        <Button
          label={p.resources.length ? "Edit project" : "Add repositories or links"}
          tone="text"
          disabled={!authority.ready || p.archived}
          onPress={() => navigation.navigate("LibraryEdit", { projectId: p.id })}
        />
      </SettingsSection>
      {project.error ? <LibraryNotice error={project.error} onRetry={project.refresh} /> : null}
      {error ? <LibraryNotice error={error} /> : null}
      <Button
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
        {props.thread.archived
          ? "Archived · "
          : props.thread.settled
            ? "Settled · "
            : props.thread.status === "failed"
              ? "Last run failed · "
              : ""}
        Saved {ago(props.thread.syncedAt)}
      </Text>
    </Pressable>
  );
}
