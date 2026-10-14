import { useId, useMemo, type RefObject } from "react";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import {
  AlarmClockIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  EllipsisIcon,
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
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  Menu,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
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
        label="Manage working files"
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
  const childrenId = useId();
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
  const priority =
    presentation.status &&
    (presentation.status.kind === "attention" ||
      presentation.status.kind === "failed" ||
      presentation.status.kind === "working")
      ? presentation.status
      : null;
  const PriorityIcon = priority?.kind === "working" ? CircleDashedIcon : CircleAlertIcon;
  const canReachComputer = entry.environmentIds.some((id) => connectedEnvironmentIds.has(id));
  const threadsViewLabel = `Open in Threads view, ${entry.threadCount} ${entry.threadCount === 1 ? "thread" : "threads"} for ${entry.title}`;

  return (
    <li className="min-w-0 [content-visibility:auto] [contain-intrinsic-size:auto_60px]">
      <span id={detailsId} className="sr-only">
        {accessibilitySummary}
      </span>
      <div
        className={cn(
          "flex min-w-0 items-start gap-0.5 rounded-md px-1 hover:bg-sidebar-row-hover",
          current && "bg-sidebar-row-hover",
        )}
      >
        {previewForcedOpen ? (
          <span
            aria-hidden="true"
            className="mt-2 flex h-6 w-5 shrink-0 items-center justify-center"
          >
            <ChevronRightIcon className="size-3 rotate-90 text-sidebar-muted-foreground" />
          </span>
        ) : (
          <button
            type="button"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${entry.title}`}
            aria-expanded={expanded}
            aria-controls={expanded ? childrenId : undefined}
            aria-describedby={detailsId}
            onClick={toggleExpanded}
            className="mt-2 flex h-6 w-5 shrink-0 cursor-pointer items-center justify-center rounded-sm outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <ChevronRightIcon
              aria-hidden="true"
              className={cn(
                "size-3 shrink-0 text-sidebar-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
                expanded && "rotate-90",
              )}
            />
          </button>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={() => onOpenProject(project)}
                aria-label={`Open project ${entry.title}`}
                aria-current={current ? "true" : undefined}
                aria-describedby={detailsId}
                className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-md py-2 pl-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              />
            }
          >
            <span className="pt-0.5">
              <ProjectFavicon project={project} className="size-3.5 shrink-0" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-sidebar-foreground">
                  {entry.title}
                </span>
                {priority ? (
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 text-2xs",
                      priority.kind === "attention"
                        ? "text-warning-foreground"
                        : priority.kind === "failed"
                          ? "text-destructive-foreground"
                          : "text-sidebar-muted-foreground",
                    )}
                  >
                    <PriorityIcon aria-hidden="true" className="size-3" />
                    {priority.label}
                  </span>
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
        <div className="mt-1.5 shrink-0">
          <Menu>
            <MenuTrigger render={<SidebarHeaderIconButton label={`Actions for ${entry.title}`} />}>
              <EllipsisIcon className="size-3.5" />
            </MenuTrigger>
            <MenuPopup side="bottom" align="end">
              <MenuItem
                disabled={targetProject === null}
                onClick={() => {
                  if (targetProject)
                    onNewThread({
                      environmentId: targetProject.environmentId,
                      projectId: targetProject.id,
                    });
                }}
              >
                <SquarePenIcon />
                <MenuItemLabel>
                  {targetComputerLabel ? `New thread on ${targetComputerLabel}` : "New thread"}
                </MenuItemLabel>
              </MenuItem>
              {targetProject === null ? (
                <p className="max-w-56 px-2 py-1 text-xs text-muted-foreground">
                  {canReachComputer
                    ? "These connections are read only. Connect with access to start work."
                    : "Reconnect a computer to start new work."}
                </p>
              ) : null}
              <MenuItem onClick={() => onViewThreads(project)} aria-label={threadsViewLabel}>
                <MessageCircleIcon />
                <MenuItemLabel>Open in Threads</MenuItemLabel>
              </MenuItem>
              <MenuSeparator />
              <MenuItem onClick={() => onOpenSettings(project)}>
                <SettingsIcon />
                <MenuItemLabel>Project settings</MenuItemLabel>
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </div>
      {expanded ? (
        <ul
          id={childrenId}
          aria-label={`Threads in ${entry.title}`}
          className="ml-10 mr-1 flex min-w-0 flex-col gap-0.5 pb-2"
        >
          {previewThreads.length === 0 ? (
            <li className="px-2 py-2 text-2xs text-sidebar-muted-foreground">No threads yet.</li>
          ) : null}
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
              ? "Offline, last known"
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
            const computer =
              entry.environmentIds.length > 1
                ? `, ${environmentLabels.get(thread.environmentId) ?? "Computer"}`
                : "";
            return (
              <li key={threadKey}>
                <button
                  type="button"
                  aria-label={`${thread.title}, ${label}${computer}`}
                  aria-current={activeThreadKey === threadKey ? "page" : undefined}
                  onClick={() => onOpenThread(threadRef)}
                  className={cn(
                    "flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    activeThreadKey === threadKey && "bg-sidebar-row-hover",
                  )}
                >
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 size-3 shrink-0",
                      connected && activity === "attention"
                        ? "text-warning-foreground"
                        : connected && activity === "failed"
                          ? "text-destructive-foreground"
                          : "text-sidebar-muted-foreground",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-sidebar-foreground">
                      {thread.title}
                    </span>
                    <span className="mt-0.5 block truncate text-2xs text-sidebar-muted-foreground">
                      {label}
                      {computer}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => onViewThreads(project)}
              aria-label={threadsViewLabel}
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-2xs text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <ArrowRightIcon aria-hidden="true" className="size-3 shrink-0" />
              {entry.threadCount > 0 ? `Open in Threads (${entry.threadCount})` : "Open in Threads"}
            </button>
          </li>
        </ul>
      ) : null}
    </li>
  );
}
