import { useId, useMemo, type RefObject } from "react";
import { useNavigate } from "@tanstack/react-router";
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
  MonitorIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";
import { buildProjectNavigationEntries } from "@t3tools/client-runtime/fork";
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
import { SidebarInput } from "~/components/ui/sidebar";
import { SidebarHeaderIconButton } from "~/components/sidebar/SidebarThreadHeader";
import { ProjectFavicon } from "~/components/ProjectFavicon";
import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";
import { useEnvironmentsWithScope } from "~/state/session";
import { resolveProjectLibraryNewThreadTarget } from "./actions";
import { useProjectLibraryExpansion } from "./expansion";
import { resolveProjectThreadActivity } from "./activity";
import { cn } from "~/lib/utils";

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
  serverConfigs: ReadonlyMap<EnvironmentId, ServerConfig>;
  now: string;
} & LibraryActions) {
  const [expanded, toggleExpanded] = useProjectLibraryExpansion(entry.key);
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
  const computerLabels = project.memberProjects
    .map((member) => ({
      label: environmentLabels.get(member.environmentId) ?? member.environmentLabel ?? "Computer",
      connected: connectedEnvironmentIds.has(member.environmentId),
    }))
    .filter(
      (member, index, members) =>
        members.findIndex(
          (candidate) =>
            candidate.label === member.label && candidate.connected === member.connected,
        ) === index,
    )
    .map((member) => `${member.label}${member.connected ? "" : " (offline)"}`)
    .join(", ");
  const activity = [
    entry.attentionCount > 0 ? `${entry.attentionCount} need attention` : null,
    entry.failedCount > 0 ? `${entry.failedCount} failed` : null,
    entry.workingCount > 0 ? `${entry.workingCount} working` : null,
    entry.readyCount > 0 ? `${entry.readyCount} ready` : null,
    entry.snoozedCount > 0 ? `${entry.snoozedCount} snoozed` : null,
    entry.settledCount > 0 ? `${entry.settledCount} settled` : null,
    entry.offlineCount > 0 ? `${entry.offlineCount} last known` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <li className="min-w-0 rounded-lg [content-visibility:auto] [contain-intrinsic-size:auto_88px]">
      <div className="flex min-w-0 items-start rounded-lg hover:bg-sidebar-row-hover">
        <button
          type="button"
          onClick={() => onOpenProject(project)}
          aria-label={`Open project ${entry.title}`}
          className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span className="pt-0.5">
            <ProjectFavicon project={project} className="size-4 shrink-0" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-sidebar-foreground">
              {entry.title}
            </span>
            <span id={detailsId} className="block">
              <span className="mt-1 flex min-w-0 items-center gap-1 text-2xs text-sidebar-muted-foreground">
                <MonitorIcon aria-hidden="true" className="size-3 shrink-0" />
                <span className="truncate">{computerLabels}</span>
              </span>
              <span className="mt-1 block text-2xs leading-relaxed text-sidebar-muted-foreground">
                {entry.threadCount === 0
                  ? "No threads yet"
                  : `${entry.threadCount} ${entry.threadCount === 1 ? "thread" : "threads"}`}
                {activity ? <span className="block">{activity}</span> : null}
              </span>
            </span>
          </span>
        </button>
        <button
          type="button"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${entry.title}`}
          aria-expanded={expanded}
          aria-describedby={detailsId}
          onClick={toggleExpanded}
          className="mt-1.5 mr-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              "mt-1 size-3.5 shrink-0 text-sidebar-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
              expanded && "rotate-180",
            )}
          />
        </button>
      </div>
      {expanded ? (
        <div className="ml-3 mr-1 px-1 pb-2">
          {entry.previewThreads.length > 0 ? (
            <ul aria-label={`Threads in ${entry.title}`} className="mb-1 flex flex-col gap-0.5">
              {entry.previewThreads.map((thread) => {
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
                      aria-label={`${thread.title}, ${label}`}
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
                          {project.memberProjects.length > 1
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
          {targetComputerLabel && project.memberProjects.length > 1 ? (
            <p className="px-2 pb-1 text-2xs text-sidebar-muted-foreground">
              New threads on {targetComputerLabel}
            </p>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <Button variant="ghost-muted" size="xs" onClick={() => onViewThreads(project)}>
              {entry.hiddenThreadCount > 0
                ? `View all ${entry.threadCount} threads`
                : "View threads"}
              <ArrowRightIcon aria-hidden="true" className="size-3" />
            </Button>
            <div className="ml-auto flex items-center gap-1">
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
          </div>
        </div>
      ) : null}
    </li>
  );
}
