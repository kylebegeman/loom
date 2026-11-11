import { LibraryProjectEcosystem } from "./LibraryProjectEcosystem";
import { useNowAfter } from "../../lib/clock";
import { useNewTaskLibraryProjects, useLibraryProjectStarts } from "./NewTaskLibraryProjects";
import {
  useLibraryStartProjects,
  useLibraryStartProject,
  useLibraryStartCopies,
} from "./libraryState";
import {
  LibraryWorkflows,
  LibraryPreservationCenter,
  LibraryOperationHistory,
} from "./LibraryWorkflows";
import { ProjectSites } from "../sites/ProjectSites";
import { useAtomValue } from "@effect/atom-react";
import { useFocusEffect, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  filterProjectEntries,
  libraryActiveCopies,
  libraryProjectHomeLocation,
  LIBRARY_PROJECT_HOME_HEALTH_MAX_AGE_MS,
  libraryProjectRequestHosts,
  selectLibraryProjectHomeCopies,
  libraryStartIntent,
  libraryStartRepositoryProjects,
  libraryResourceLocation,
  projectEntries,
  sortProjectEntries,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { LIBRARY_COPY_HEALTH_FEATURE, LIBRARY_DELETED_FEATURE } from "@t3tools/contracts/fork";
import type {
  LibraryProject,
  LibraryProjectColor,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { useResolveClassNames } from "uniwind";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SymbolView } from "../../components/ui/AppSymbol";
import { RowPressable } from "../../components/ui/RowPressable";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { cn } from "../../lib/cn";
import { uuidv4 } from "../../lib/uuid";
import { relativeTime } from "../../lib/time";
import {
  library,
  refreshLibraryProject,
  refreshLibraryWork,
  useLibraryAuthority,
  useLoomFeature,
} from "./libraryState";
import { libraryListState, libraryRepositories, libraryScopeLabel } from "./libraryLogic";
import { LibraryStateBadge } from "./LibraryStateBadge";
import { LibraryCopySection } from "./LibraryCopySection";
import { LibraryRestingProjects } from "./LibraryTidy";
import { LibraryProjectTile } from "./libraryProjectColors";
import { LibraryBriefProposalsRow } from "./LibraryBriefProposalsRow";
import { LibraryHistorySearchEntry } from "./LibraryHistorySearch";
import { LibraryTimelinePreview } from "./LibraryTimeline";
import { LibraryAuthorityScreen, LibraryNotice, LibraryPage } from "./LibraryPage";

const RECENT_CONVERSATIONS = 5;
const ANY_COLOR: ReadonlySet<LibraryProjectColor> = new Set();
const ago = (iso: string) => `${relativeTime(iso)} ago`;

function LibraryHomeLocation({
  project,
  copy,
  label,
  connected,
  onReview,
  onStart,
}: {
  readonly project: LibraryProject;
  readonly copy: LibraryWorkingCopy;
  readonly label: string;
  readonly connected: boolean;
  readonly onReview: () => void;
  readonly onStart: () => void;
}) {
  const supported = useLoomFeature(copy.environmentId, LIBRARY_COPY_HEALTH_FEATURE);
  const health = useEnvironmentQuery(
    connected && supported && copy.state === "ready"
      ? library.copyHealth({ environmentId: copy.environmentId, input: { workingCopyId: copy.id } })
      : null,
  );
  const healthDeadline = health.data
    ? Date.parse(health.data.checkedAt) + LIBRARY_PROJECT_HOME_HEALTH_MAX_AGE_MS
    : null;
  const now = useNowAfter(healthDeadline);
  const location = libraryProjectHomeLocation({
    project,
    copy,
    connected,
    liveHealth: health.isSuccess ? health.data : null,
    readFailed: health.error !== null,
    readPending: health.isPending,
    now: Math.max(now, health.successResult?.timestamp ?? 0),
  });
  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="font-t3-medium text-foreground">{label}</Text>
        <LibraryStateBadge tone={location.tone} label={location.label} />
      </View>
      <Text selectable className="text-sm text-foreground">
        {copy.rootPath}
      </Text>
      <Text className="text-xs text-foreground-muted">{location.detail}</Text>
      {location.checkedAt ? (
        <Text className="text-xs text-foreground-muted">
          {location.observation} {ago(location.checkedAt)}
        </Text>
      ) : null}
      {location.attention.length ? (
        <Text className="text-xs text-warning-foreground">{location.attention.join(". ")}.</Text>
      ) : null}
      {health.error ? (
        <Text accessibilityLiveRegion="polite" className="text-xs text-foreground-muted">
          {health.error}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        {supported ? (
          <Button
            label={health.isPending ? "Checking files..." : "Check files"}
            tone="text"
            disabled={!connected || health.isPending || copy.state !== "ready"}
            onPress={health.refresh}
          />
        ) : null}
        <Button label="Review files" tone="text" onPress={onReview} />
        {location.status === "available" ? (
          <Button label="Start here" disabled={project.archived} onPress={onStart} />
        ) : null}
      </View>
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
          <View>
            {projects.map((project, index) => (
              <LibraryProjectRow
                key={project.id}
                project={project}
                separated={index > 0}
                onPress={() => navigation.navigate("LibraryProject", { projectId: project.id })}
              />
            ))}
          </View>
          {!archived && !query ? <LibraryRestingProjects /> : null}
          {!catalog.isPending && !catalog.error && !projects.length ? (
            <View className="gap-3 py-4">
              <Text textRole="title" className="font-t3-semibold text-foreground">
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
      className={cn(props.separated && "border-t border-border-subtle")}
    >
      <View className="min-h-20 flex-row items-center gap-4 py-4">
        <LibraryProjectTile project={props.project} />
        <View className="min-w-0 flex-1 gap-1">
          <Text textRole="body" className="font-t3-semibold text-foreground">
            {props.project.title}
          </Text>
          <Text textRole="footnote" className="text-foreground-muted" numberOfLines={2}>
            {description}
          </Text>
        </View>
        <SymbolView name="chevron.right" size={14} tintColorClassName="accent-chevron" />
      </View>
    </RowPressable>
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
  const supportsDeleted = useLoomFeature(target, LIBRARY_DELETED_FEATURE);
  const [deletedFilter, setDeleted] = useState(false);
  const deleted = supportsDeleted && deletedFilter;
  const [threadPage, setThreadPage] = useState({ environmentId: target, offset: 0 });
  const threadOffset = threadPage.environmentId === target ? threadPage.offset : 0;
  const setThreadOffset = (offset: number) => setThreadPage({ environmentId: target, offset });
  const threadIndex = useEnvironmentQuery(
    target && supportsDeleted
      ? library.threadIndex({
          environmentId: target,
          input: { projectId, deleted, limit: 25, offset: threadOffset },
        })
      : null,
  );
  const conversations = supportsDeleted
    ? { ...threadIndex, data: threadIndex.data?.threads ?? null }
    : threads;
  const refreshConversations = supportsDeleted ? threadIndex.refresh : threads.refresh;
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
  const threadsState = libraryListState(conversations);
  const threadListNotice =
    threadsState === "loading"
      ? !authority.connected
        ? "Reconnect the selected library to load conversation history."
        : conversations.data === null
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
      refreshConversations();
    }, [target, projectId, authority.connected, authority.canRead, refreshConversations]),
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
  const connectedHosts = environments
    .filter((entry) => entry.entry.enabled && entry.connection.phase === "connected")
    .map((entry) => entry.environmentId);
  const homeCopies = selectLibraryProjectHomeCopies(
    p.id,
    copies.data ?? [],
    new Set(connectedHosts),
  );
  const requestHosts = libraryProjectRequestHosts(target, copies.data ?? [], connectedHosts);
  const activeCopies = libraryActiveCopies(copies.data ?? []),
    removedCopies = (copies.data ?? [])
      .filter((copy) => !activeCopies.includes(copy))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const visibleThreads = (conversations.data ?? [])
    .filter((thread) => Boolean(thread.deleted) === deleted)
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
        <View className="flex-row items-center gap-4">
          <LibraryProjectTile project={p} prominent />
          <Text textRole="footnote" className="min-w-0 flex-1 text-foreground-muted">
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
        </View>
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
      <SettingsSection title="Where to work">
        <View className="gap-4 p-4">
          {homeCopies.map((copy) => (
            <LibraryHomeLocation
              key={`${copy.environmentId}:${copy.id}`}
              project={p}
              copy={copy}
              label={hostLabel(copy.environmentId)}
              connected={connectedHosts.includes(copy.environmentId)}
              onReview={() => reuseFolder(copy)}
              onStart={() =>
                navigation.navigate("LibraryStart", {
                  projectId: p.id,
                  reuseEnvironmentId: copy.environmentId,
                  initialCopyId: copy.id,
                })
              }
            />
          ))}
          {!homeCopies.length && copiesReady ? (
            <Text className="text-sm text-foreground-muted">
              No registered file locations are shown. Prepare files on a computer to start work.
            </Text>
          ) : null}
          {!copiesReady ? (
            <LibraryNotice
              detail="File locations are saved observations. Reconnect and check your computers before starting."
              error={copies.error}
              onRetry={copies.refresh}
            />
          ) : null}
          <Button
            label="Prepare on a computer"
            disabled={!authority.ready || p.archived}
            onPress={() =>
              navigation.navigate("LibraryPrepare", {
                projectId: p.id,
                authorityEnvironmentId: target,
              })
            }
          />
        </View>
      </SettingsSection>
      <SettingsSection title="Repository components">
        {repositories.map((resource) => (
          <View key={resource.id} className="gap-1 px-4 py-3">
            <Text className="font-t3-medium text-foreground">{resource.title}</Text>
            <Text selectable className="text-xs text-foreground-muted">
              {resource.relativePath || "."} · {libraryResourceLocation(resource)}
            </Text>
          </View>
        ))}
        {!repositories.length ? (
          <Text className="p-4 text-sm text-foreground-muted">
            This project has no repository components saved.
          </Text>
        ) : null}
      </SettingsSection>
      <SettingsSection title="Request history">
        <View className="gap-3 p-4">
          <Text className="text-sm text-foreground-muted">
            Saved requests explain completed and remaining outcomes. Check a computer before
            retrying uncertain work.
          </Text>
          {requestHosts.map((environmentId) => (
            <LibraryOperationHistory
              key={environmentId}
              environmentId={environmentId}
              projectId={p.id}
              computerLabel={hostLabel(environmentId)}
            />
          ))}
        </View>
      </SettingsSection>
      {authority.info.data?.features?.includes("project-workflows") ? (
        <LibraryWorkflows
          key={`${target}:${p.id}`}
          environmentId={target}
          project={p}
          copies={activeCopies}
          threads={(threads.data ?? []).filter((thread) => !thread.deleted)}
        />
      ) : null}
      <SettingsSection
        title={
          deleted
            ? "Recently deleted"
            : supportsDeleted || showAllThreads || visibleThreads.length <= RECENT_CONVERSATIONS
              ? "Conversations"
              : "Recent conversations"
        }
      >
        {supportsDeleted ? (
          <View className="flex-row flex-wrap gap-2 p-4">
            <Button
              label="Active"
              tone={deleted ? "text" : "secondary"}
              onPress={() => {
                setDeleted(false);
                setThreadOffset(0);
              }}
            />
            <Button
              label="Recently deleted"
              tone={deleted ? "secondary" : "text"}
              onPress={() => {
                setDeleted(true);
                setThreadOffset(0);
              }}
            />
          </View>
        ) : null}
        {(supportsDeleted || showAllThreads
          ? visibleThreads
          : visibleThreads.slice(0, RECENT_CONVERSATIONS)
        ).map((thread) => (
          <LibraryThreadRow
            key={thread.id}
            thread={thread}
            project={p}
            computerLabel={hostLabel(thread.environmentId)}
            onPress={() => showThread(thread)}
          />
        ))}
        {!supportsDeleted && visibleThreads.length > RECENT_CONVERSATIONS ? (
          <Button
            label={showAllThreads ? "Show recent only" : `Show all ${visibleThreads.length}`}
            tone="text"
            onPress={() => setShowAllThreads((current) => !current)}
          />
        ) : null}
        {threadsState === "empty" ? (
          <Text className="p-4 text-sm text-foreground-muted">
            {deleted
              ? "No recently deleted conversations."
              : "No conversations yet. Start one about the whole project or a single repository."}
          </Text>
        ) : null}
        {supportsDeleted && (threadOffset > 0 || threadIndex.data?.nextOffset != null) ? (
          <View className="flex-row gap-2 p-4">
            <Button
              label="Previous"
              disabled={!threadOffset || threadIndex.isPending}
              onPress={() => setThreadOffset(Math.max(0, threadOffset - 25))}
            />
            <Button
              label="Next"
              disabled={
                threadIndex.data?.nextOffset == null ||
                threadIndex.isPending ||
                !authority.connected
              }
              onPress={() => setThreadOffset(threadIndex.data?.nextOffset ?? threadOffset)}
            />
          </View>
        ) : null}
        {threadListNotice || conversations.error ? (
          <View className="p-4">
            <LibraryNotice
              detail={threadListNotice}
              error={conversations.error}
              onRetry={conversations.error ? conversations.refresh : undefined}
            />
          </View>
        ) : null}
      </SettingsSection>
      {target ? (
        <LibraryProjectEcosystem project={p} authorityId={target} connected={authority.connected} />
      ) : null}
      <LibraryHistorySearchEntry projectId={p.id} />
      <View className="gap-3">
        <Text textRole="body" className="font-t3-semibold text-foreground">
          Project files
        </Text>
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
            Prepare files on your chosen computer. Start a conversation when you are ready.
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
          label="Prepare project files"
          tone="secondary"
          disabled={
            p.archived || (!authority.ready && !activeCopies.some((copy) => copy.state === "ready"))
          }
          onPress={() =>
            navigation.navigate("LibraryPrepare", {
              projectId: p.id,
              authorityEnvironmentId: target,
            })
          }
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
          <Text selectable textRole="body" className="text-foreground">
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
            <Text textRole="body" className="font-t3-medium text-foreground">
              {resource.title}
            </Text>
            <Text selectable textRole="footnote" className="text-foreground-muted">
              {libraryResourceLocation(resource)}
            </Text>
            {resource.kind !== "link" ? (
              <Text className="text-xs text-foreground-muted">
                {resource.defaultBranch
                  ? `Override: ${resource.defaultBranch}`
                  : "Follows repository default"}
              </Text>
            ) : null}
          </View>
        ))}
        {p.resources.length === 0 ? (
          <Text className="p-4 text-sm text-foreground-muted">
            Add the repositories this project is made of, plus any links worth keeping close.
          </Text>
        ) : null}
        <Button
          label={p.resources.length ? "Edit repositories and links" : "Add repositories or links"}
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
      className="gap-1.5 px-5 py-4 active:opacity-70"
    >
      <Text textRole="body" className="font-t3-medium text-foreground">
        {props.thread.title}
      </Text>
      <Text textRole="footnote" className="text-foreground-muted">
        {libraryScopeLabel(props.project, props.thread.resourceIds)} · {props.computerLabel}
      </Text>
      <Text className="text-xs text-foreground-muted">
        {props.thread.deleted
          ? "Recently deleted · "
          : props.thread.archived
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
