import { useId, useMemo, type RefObject } from "react";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import {
  AlarmClockIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  FolderPlusIcon,
  HardDriveIcon,
  MessageCircleIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";
import {
  buildProjectNavigationEntries,
  createProjectLibraryPresentation,
  PROJECT_LIBRARY_PREVIEW_LIMIT,
} from "@t3tools/client-runtime/fork";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ServerConfig,
  type ScopedProjectRef,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { SidebarInput } from "~/components/ui/sidebar";
import { SidebarHeaderIconButton } from "~/components/sidebar/SidebarThreadHeader";
import { ProjectFavicon } from "~/components/ProjectFavicon";
import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";
import { useComposerDraftStore } from "~/composerDraftStore";
import { resolveThreadRouteTarget } from "~/threadRoutes";
import { useEnvironmentsWithScope } from "~/state/session";
import { resolveProjectLibraryNewThreadTarget } from "./actions";
import { useProjectLibraryExpansion } from "./expansion";
import { resolveProjectThreadActivity } from "./activity";
import { cn } from "~/lib/utils";
import { resolveProjectHomeGroup } from "~/fork/project-home/groupResolution";
import {
  projectHomeDestinationFromSearch,
  validateProjectHomeSearch,
} from "~/fork/project-home/routeSearch";

function buildLibraryEntries(input: {
  groups: readonly SidebarProjectSnapshot[];
  threads: readonly EnvironmentThreadShell[];
  query: string;
  serverConfigs: ReadonlyMap<EnvironmentId, ServerConfig>;
  connectedEnvironmentIds: ReadonlySet<EnvironmentId>;
  now: string;
}) {
  return buildProjectNavigationEntries({
    groups: input.groups.map((group) => ({
      key: group.projectKey,
      title: group.displayName,
      projectRefs: group.memberProjectRefs,
      originalGroup: group,
    })),
    threads: input.threads,
    searchQuery: input.query,
    getThreadActivity: (thread) =>
      resolveProjectThreadActivity(
        thread,
        input.serverConfigs.get(thread.environmentId),
        input.now,
      ),
    connectedEnvironmentIds: input.connectedEnvironmentIds,
  });
}

type LibraryEntry = ReturnType<typeof buildLibraryEntries>[number];

type LibraryActions = {
  onViewThreads: (project: SidebarProjectSnapshot) => void;
  onOpenProject: (project: SidebarProjectSnapshot) => void;
  onOpenSettings: (project: SidebarProjectSnapshot) => void;
  onNewThread: (projectRef: ScopedProjectRef) => void;
  onOpenThread: (threadRef: ScopedThreadRef) => void;
};

export function ProjectLibraryHeader({
  query,
  onQueryChange,
  onAddProject,
  searchInputRef,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  onAddProject: () => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
}) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-1">
      <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground">
        <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-(--sidebar-icon-color)" />
        <SidebarInput
          ref={searchInputRef}
          nativeInput
          type="search"
          placeholder="Search projects"
          aria-label="Search project library"
          className="min-w-0 flex-1"
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
        />
        {query ? (
          <Button
            type="button"
            size="icon-micro"
            variant="ghost-muted"
            aria-label="Clear project search"
            onClick={() => {
              onQueryChange("");
              searchInputRef.current?.focus();
            }}
          >
            <XIcon className="size-3" />
          </Button>
        ) : null}
      </div>
      <SidebarHeaderIconButton
        label="Review project storage"
        onClick={() => void navigate({ to: "/projects/storage" })}
      >
        <HardDriveIcon />
      </SidebarHeaderIconButton>
      <SidebarHeaderIconButton label="Add project" onClick={onAddProject}>
        <FolderPlusIcon />
      </SidebarHeaderIconButton>
    </div>
  );
}

export function ProjectLibrary({
  groups,
  threads,
  query,
  serverConfigs,
  connectedEnvironmentIds,
  environmentLabels,
  activeThreadKey,
  snapshotsReady,
  now,
  onAddProject,
  ...actions
}: {
  groups: readonly SidebarProjectSnapshot[];
  threads: readonly EnvironmentThreadShell[];
  query: string;
  serverConfigs: ReadonlyMap<EnvironmentId, ServerConfig>;
  connectedEnvironmentIds: ReadonlySet<EnvironmentId>;
  environmentLabels: ReadonlyMap<EnvironmentId, string>;
  activeThreadKey: string | null;
  snapshotsReady: boolean;
  now: string;
  onAddProject: () => void;
} & LibraryActions) {
  const entries = useMemo(
    () =>
      buildLibraryEntries({ groups, threads, query, serverConfigs, connectedEnvironmentIds, now }),
    [groups, threads, query, serverConfigs, connectedEnvironmentIds, now],
  );
  const previewForcedOpen = query.trim().length > 0;
  const homeProjectKey = useParams({
    strict: false,
    select: (params) => (typeof params.projectKey === "string" ? params.projectKey : null),
  });
  const homeSearch = useLocation({ select: (location) => location.search });
  const routeDraftId = useParams({
    strict: false,
    select: (params) => {
      const target = resolveThreadRouteTarget(params);
      return target?.kind === "draft" ? target.draftId : null;
    },
  });
  const routeDraft = useComposerDraftStore((state) =>
    routeDraftId ? state.getDraftSession(routeDraftId) : null,
  );
  const currentProjectKey = useMemo(() => {
    if (homeProjectKey !== null) {
      return (
        resolveProjectHomeGroup({
          groups,
          projectKey: homeProjectKey,
          projectRef: projectHomeDestinationFromSearch(validateProjectHomeSearch(homeSearch)),
        }).group?.projectKey ?? null
      );
    }
    const activeThread = activeThreadKey
      ? threads.find(
          (thread) =>
            scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === activeThreadKey,
        )
      : null;
    const activeProject = activeThread ?? routeDraft;
    return activeProject
      ? (groups.find((group) =>
          group.memberProjectRefs.some(
            (ref) =>
              ref.environmentId === activeProject.environmentId &&
              ref.projectId === activeProject.projectId,
          ),
        )?.projectKey ?? null)
      : null;
  }, [groups, homeProjectKey, homeSearch, activeThreadKey, threads, routeDraft]);

  if (entries.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-3 px-3 py-8 text-center text-xs text-sidebar-muted-foreground"
        role="status"
      >
        <p>
          {query.trim()
            ? "No projects or threads match your search."
            : !snapshotsReady
              ? "Loading projects..."
              : "Add a project to keep its conversations together."}
        </p>
        {!query.trim() && snapshotsReady ? (
          <Button variant="outline" size="sm" onClick={onAddProject}>
            <FolderPlusIcon aria-hidden="true" />
            Add project
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <div aria-live="polite" className="px-2.5 pb-2 pt-1 text-2xs text-sidebar-muted-foreground">
        {entries.length} {entries.length === 1 ? "project" : "projects"}
        {query.trim() ? " found" : ""}
      </div>
      <ul aria-label="Project library" className="flex flex-col gap-1">
        {entries.map((entry) => (
          <ProjectLibraryRow
            key={entry.key}
            entry={entry}
            environmentLabels={environmentLabels}
            connectedEnvironmentIds={connectedEnvironmentIds}
            activeThreadKey={activeThreadKey}
            current={currentProjectKey === entry.key}
            previewForcedOpen={previewForcedOpen}
            serverConfigs={serverConfigs}
            now={now}
            {...actions}
          />
        ))}
      </ul>
    </div>
  );
}

function ProjectLibraryRow({
  entry,
  environmentLabels,
  connectedEnvironmentIds,
  activeThreadKey,
  current,
  previewForcedOpen,
  serverConfigs,
  now,
  onViewThreads,
  onOpenProject,
  onOpenSettings,
  onNewThread,
  onOpenThread,
}: {
  entry: LibraryEntry;
  environmentLabels: ReadonlyMap<EnvironmentId, string>;
  connectedEnvironmentIds: ReadonlySet<EnvironmentId>;
  activeThreadKey: string | null;
  current: boolean;
  previewForcedOpen: boolean;
  serverConfigs: ReadonlyMap<EnvironmentId, ServerConfig>;
  now: string;
} & LibraryActions) {
  const [savedExpanded, toggleExpanded] = useProjectLibraryExpansion(entry.key);
  const expanded = savedExpanded || previewForcedOpen;
  const detailsId = useId();
  const project = entry.group.originalGroup;
  const permittedEnvironmentIds = useEnvironmentsWithScope(
    project.memberProjects,
    AuthOrchestrationOperateScope,
  );
  const targetProject = resolveProjectLibraryNewThreadTarget({
    memberProjects: project.memberProjects,
    representative: project,
    connectedEnvironmentIds,
    permittedEnvironmentIds,
  });
  const targetComputerLabel = targetProject
    ? (environmentLabels.get(targetProject.environmentId) ??
      targetProject.environmentLabel ??
      "Computer")
    : null;
  const presentation = createProjectLibraryPresentation(
    entry,
    environmentLabels,
    connectedEnvironmentIds,
  );
  const accessibilitySummary = `${presentation.accessibilitySummary}${previewForcedOpen ? ". Matching thread previews are shown while searching." : ""}`;
  const previewThreads = entry.previewThreads.slice(0, PROJECT_LIBRARY_PREVIEW_LIMIT);
  const statusVariant =
    presentation.status?.kind === "attention"
      ? "warning"
      : presentation.status?.kind === "failed"
        ? "error"
        : presentation.status?.kind === "working"
          ? "info"
          : "secondary";

  return (
    <li className="min-w-0 rounded-lg [content-visibility:auto] [contain-intrinsic-size:auto_64px]">
      <span id={detailsId} className="sr-only">
        {accessibilitySummary}
      </span>
      <div
        className={cn(
          "flex min-w-0 items-start rounded-lg hover:bg-sidebar-row-hover",
          current && "bg-sidebar-row-hover",
        )}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={() => onOpenProject(project)}
                aria-label={`Open project ${entry.title}`}
                aria-current={current ? "true" : undefined}
                aria-describedby={detailsId}
                className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              />
            }
          >
            <span className="pt-0.5">
              <ProjectFavicon project={project} className="size-4 shrink-0" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-sidebar-foreground">
                  {entry.title}
                </span>
                {presentation.status ? (
                  <Badge size="sm" variant={statusVariant}>
                    {presentation.status.label}
                  </Badge>
                ) : null}
              </span>
              <span className="mt-0.5 block truncate text-2xs text-sidebar-muted-foreground">
                {presentation.metadata}
              </span>
            </span>
          </TooltipTrigger>
          <TooltipPopup side="right" align="start">
            <div className="max-w-72">
              <p className="font-medium">{entry.title}</p>
              <p className="mt-1">{accessibilitySummary}</p>
            </div>
          </TooltipPopup>
        </Tooltip>
        {previewForcedOpen ? (
          <span
            aria-hidden="true"
            className="mt-1 mr-1 flex size-8 shrink-0 items-center justify-center"
          >
            <ChevronDownIcon className="size-3.5 rotate-180 text-sidebar-muted-foreground" />
          </span>
        ) : (
          <button
            type="button"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${entry.title}`}
            aria-expanded={expanded}
            aria-describedby={detailsId}
            onClick={toggleExpanded}
            className="mt-1 mr-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <ChevronDownIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 text-sidebar-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
                expanded && "rotate-180",
              )}
            />
          </button>
        )}
      </div>
      {expanded ? (
        <div className="ml-8 mr-1 pb-2">
          <div className="mb-1 flex min-w-0 items-center gap-1">
            {targetComputerLabel && entry.environmentIds.length > 1 ? (
              <p className="min-w-0 flex-1 truncate text-2xs text-sidebar-muted-foreground">
                New threads on {targetComputerLabel}
              </p>
            ) : (
              <span className="flex-1" />
            )}
            <SidebarHeaderIconButton
              label={`Project settings for ${entry.title}`}
              tooltip="Project settings"
              onClick={() => onOpenSettings(project)}
            >
              <SettingsIcon className="size-3.5" />
            </SidebarHeaderIconButton>
            <SidebarHeaderIconButton
              label={`New thread in ${entry.title}`}
              tooltip={
                targetProject
                  ? `New thread on ${targetComputerLabel}`
                  : "Connect to this computer with permission to start a thread"
              }
              disabled={targetProject === null}
              onClick={() => {
                if (targetProject)
                  onNewThread({
                    environmentId: targetProject.environmentId,
                    projectId: targetProject.id,
                  });
              }}
            >
              <SquarePenIcon className="size-3.5" />
            </SidebarHeaderIconButton>
          </div>
          {previewThreads.length > 0 ? (
            <ul aria-label={`Threads in ${entry.title}`} className="mb-1 flex flex-col gap-0.5">
              {previewThreads.map((thread) => {
                const threadRef = scopeThreadRef(thread.environmentId, thread.id);
                const threadKey = scopedThreadKey(threadRef);
                const connected = connectedEnvironmentIds.has(thread.environmentId);
                const activity = resolveProjectThreadActivity(
                  thread,
                  serverConfigs.get(thread.environmentId),
                  now,
                );
                const label = !connected
                  ? "Last known, computer offline"
                  : activity === "attention"
                    ? "Needs attention"
                    : activity === "failed"
                      ? "Failed"
                      : activity === "working"
                        ? "Working"
                        : activity === "settled"
                          ? "Settled"
                          : activity === "snoozed"
                            ? "Snoozed"
                            : "Ready";
                const Icon = !connected
                  ? MessageCircleIcon
                  : activity === "attention" || activity === "failed"
                    ? CircleAlertIcon
                    : activity === "working"
                      ? CircleDashedIcon
                      : activity === "settled"
                        ? CircleCheckIcon
                        : activity === "snoozed"
                          ? AlarmClockIcon
                          : MessageCircleIcon;
                return (
                  <li key={threadKey}>
                    <button
                      type="button"
                      aria-label={`${thread.title}, ${label}${entry.environmentIds.length > 1 ? `, ${environmentLabels.get(thread.environmentId) ?? "Computer"}` : ""}`}
                      aria-current={activeThreadKey === threadKey ? "page" : undefined}
                      onClick={() => onOpenThread(threadRef)}
                      className={cn(
                        "flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        activeThreadKey === threadKey && "bg-sidebar-row-hover",
                      )}
                    >
                      <Icon
                        aria-hidden="true"
                        className={cn(
                          "mt-0.5 size-3.5 shrink-0",
                          connected && (activity === "attention" || activity === "failed")
                            ? "text-warning-foreground"
                            : "text-sidebar-muted-foreground",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-sidebar-foreground">
                          {thread.title}
                        </span>
                        <span className="mt-0.5 block truncate text-2xs text-sidebar-muted-foreground">
                          {label}
                          {entry.environmentIds.length > 1
                            ? `, ${environmentLabels.get(thread.environmentId) ?? "Computer"}`
                            : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <div className="flex items-center pt-0.5">
            <Button variant="ghost-muted" size="xs" onClick={() => onViewThreads(project)}>
              {entry.threadCount > previewThreads.length
                ? `View all ${entry.threadCount} threads`
                : "View threads"}
              <ArrowRightIcon aria-hidden="true" className="size-3" />
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
