import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRightIcon,
  ChevronRightIcon,
  FolderIcon,
  PlusIcon,
  SquarePenIcon,
} from "lucide-react";
import {
  createLibrarySidebarProjectKey,
  groupSidebarThreadsByProject,
  sidebarProjectsByLocalProject,
  type LibrarySidebarProject,
  type SidebarThreadProject,
} from "@t3tools/client-runtime/fork";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { ProjectFavicon } from "~/components/ProjectFavicon";
import { resolveSidebarThreadStatus, type SidebarSection } from "~/components/Sidebar.logic";
import { Button } from "~/components/ui/button";
import { CollapsibleSectionHeader } from "~/components/ui/collapsible-section-header";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";
import { useEnvironmentQuery } from "~/state/query";
import { onForkCommand } from "../keybindings/forkCommandBus";
import { openLibraryAction } from "../project-library/actions";
import { ProjectTile } from "../project-library/ProjectIdentity";
import { projectLibrary, useLibraryPermission, useLibraryProjects } from "../project-library/state";
import { useProjectNavigationExpansion } from "./expansion";
import { ProjectNavigationSwitch } from "./ProjectNavigationSwitch";
import { useProjectNavigationView } from "./preference";
import { useProjectNavigationScroll } from "./scroll";

type LocalGroup = SidebarThreadProject & { readonly group: SidebarProjectSnapshot };
type Group = LibrarySidebarProject<LocalGroup>;

// Settled history can be long; a group shows it a page at a time, like the Threads view's tail.
const SETTLED_PAGE = 25;
const NEEDS_YOU = new Set(["approval", "input", "working"]);

/**
 * The sidebar's Threads/Projects view, persisted per device. Each view keeps its own scroll
 * position, and `loom.navigation.toggleView` switches between them.
 */
export function useSidebarNavigationView() {
  const [view, saveView] = useProjectNavigationView();
  const { contentRef, changeView } = useProjectNavigationScroll(view, saveView);
  useEffect(
    () =>
      onForkCommand("loom.navigation.toggleView", () =>
        changeView(view === "threads" ? "projects" : "threads"),
      ),
    [changeView, view],
  );
  return {
    view,
    /** Attach inside the sidebar's scroll viewport. */
    contentRef,
    switcher: <ProjectNavigationSwitch view={view} onViewChange={changeView} />,
  };
}

/**
 * The sidebar's Projects view: the same threads, already filtered by the project scope, grouped
 * under their Library project across every computer. Without a Library it groups by upstream's
 * logical project instead. Rows come from the sidebar so they behave exactly like Threads view rows.
 */
export function SidebarProjectsView({
  threads,
  sectionByThreadKey,
  projectGroups,
  leading,
  renderThread,
}: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly sectionByThreadKey: ReadonlyMap<string, SidebarSection>;
  readonly projectGroups: ReadonlyArray<SidebarProjectSnapshot>;
  /** Rendered above the groups, for unsent drafts. */
  readonly leading?: ReactNode;
  readonly renderThread: (thread: EnvironmentThreadShell, section: SidebarSection) => ReactNode;
}) {
  // The same keyed queries the sidebar's scope filter reads, so nothing is fetched twice.
  const catalog = useLibraryProjects(true);
  const authorityId = catalog.authorityId;
  const index = useEnvironmentQuery(
    authorityId
      ? projectLibrary.threadIndex({ environmentId: authorityId, input: { limit: 200 } })
      : null,
  );
  const copies = useEnvironmentQuery(
    authorityId ? projectLibrary.copies({ environmentId: authorityId, input: {} }) : null,
  );
  const canStart =
    useLibraryPermission(projectLibrary.registerThread, authorityId) && catalog.connected;

  const sectionOf = useCallback(
    (thread: EnvironmentThreadShell): SidebarSection =>
      sectionByThreadKey.get(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))) ??
      "active",
    [sectionByThreadKey],
  );
  const local = useMemo(() => sidebarProjectsByLocalProject(projectGroups), [projectGroups]);
  const projects = catalog.query.data;
  const indexThreads = index.data?.threads;
  const copyList = copies.data;
  const grouped = useMemo(() => {
    // Until the Library has answered, group the way the sidebar does without one.
    const library =
      projects && indexThreads && copyList
        ? { projects, threads: indexThreads, copies: copyList }
        : null;
    return groupSidebarThreadsByProject(
      threads,
      createLibrarySidebarProjectKey({ library, local }),
      {
        rankOf: (thread) => {
          const section = sectionOf(thread);
          if (section === "settled") return 3;
          if (section === "snoozed") return 2;
          return NEEDS_YOU.has(resolveSidebarThreadStatus(thread)) ? 0 : 1;
        },
      },
    );
  }, [threads, sectionOf, local, projects, indexThreads, copyList]);

  return (
    <div
      id="loom-project-navigation-panel"
      role="tabpanel"
      aria-labelledby="loom-navigation-projects-tab"
      className="flex flex-col gap-1"
    >
      {leading ? (
        <ul role="presentation" className="flex flex-col gap-px">
          {leading}
        </ul>
      ) : null}
      {grouped.groups.map(({ project, threads: groupThreads }) => (
        <ProjectGroup
          key={project.key}
          project={project}
          threads={groupThreads}
          sectionOf={sectionOf}
          canStart={canStart}
          renderThread={renderThread}
        />
      ))}
      {grouped.unclaimed.length > 0 ? (
        <ThreadGroup
          expansionKey="unclaimed"
          title="Not in a project"
          mark={
            <FolderIcon aria-hidden className="size-4 shrink-0 text-sidebar-muted-foreground" />
          }
          threads={grouped.unclaimed}
          sectionOf={sectionOf}
          renderThread={renderThread}
        />
      ) : null}
    </div>
  );
}

function ProjectGroup({
  project,
  canStart,
  ...props
}: {
  readonly project: Group;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly sectionOf: (thread: EnvironmentThreadShell) => SidebarSection;
  readonly canStart: boolean;
  readonly renderThread: (thread: EnvironmentThreadShell, section: SidebarSection) => ReactNode;
}) {
  if (project.kind === "local") {
    return (
      <ThreadGroup
        {...props}
        expansionKey={project.key}
        title={project.title}
        mark={<ProjectFavicon project={project.local.group} className="size-4 shrink-0" />}
      />
    );
  }
  const library = project.project;
  return (
    <ThreadGroup
      {...props}
      expansionKey={project.key}
      title={project.title}
      mark={<ProjectTile project={library} size="sm" />}
      actions={
        <>
          {canStart ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={`New conversation in ${project.title}`}
                    onClick={() => openLibraryAction("new-conversation", library.id)}
                  />
                }
              >
                <SquarePenIcon />
              </TooltipTrigger>
              <TooltipPopup>New conversation</TooltipPopup>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={`Open ${project.title}`}
                  render={<Link to="/library/$projectId" params={{ projectId: library.id }} />}
                />
              }
            >
              <ArrowUpRightIcon />
            </TooltipTrigger>
            <TooltipPopup>Open project</TooltipPopup>
          </Tooltip>
        </>
      }
    />
  );
}

/** One collapsible group: open by default, with its settled threads behind their own toggle. */
function ThreadGroup({
  expansionKey,
  title,
  mark,
  actions,
  threads,
  sectionOf,
  renderThread,
}: {
  readonly expansionKey: string;
  readonly title: string;
  readonly mark: ReactNode;
  readonly actions?: ReactNode;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly sectionOf: (thread: EnvironmentThreadShell) => SidebarSection;
  readonly renderThread: (thread: EnvironmentThreadShell, section: SidebarSection) => ReactNode;
}) {
  const [expanded, toggleExpanded] = useProjectNavigationExpansion(expansionKey, true);
  const [settledExpanded, toggleSettled] = useProjectNavigationExpansion(`settled:${expansionKey}`);
  const [settledShown, setSettledShown] = useState(SETTLED_PAGE);
  const listId = useId();
  // Ranked: settled threads are always the tail.
  const firstSettled = threads.findIndex((thread) => sectionOf(thread) === "settled");
  const open = firstSettled === -1 ? threads : threads.slice(0, firstSettled);
  const settled = firstSettled === -1 ? [] : threads.slice(firstSettled);
  const count = threads.length;

  return (
    <section aria-label={title} className="flex flex-col">
      <div className="flex h-8 min-w-0 items-center gap-0.5 rounded-md pe-1 hover:bg-sidebar-row-hover">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          onClick={toggleExpanded}
          className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md ps-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ChevronRightIcon
            aria-hidden
            className={cn("size-3 shrink-0 text-sidebar-muted-foreground", expanded && "rotate-90")}
          />
          {mark}
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-sidebar-foreground">
            {title}
          </span>
          <span className="shrink-0 text-2xs tabular-nums text-sidebar-muted-foreground">
            {count}
            <span className="sr-only">{count === 1 ? " thread" : " threads"}</span>
          </span>
        </button>
        {actions}
      </div>
      {expanded ? (
        <ul id={listId} role="presentation" className="flex flex-col gap-px">
          {open.map((thread) => renderThread(thread, sectionOf(thread)))}
          {settled.length > 0 ? (
            <li className="list-none">
              <CollapsibleSectionHeader expanded={settledExpanded} onClick={toggleSettled}>
                {settledExpanded ? "Settled" : `Settled (${settled.length})`}
              </CollapsibleSectionHeader>
            </li>
          ) : null}
          {settledExpanded
            ? settled.slice(0, settledShown).map((thread) => renderThread(thread, "settled"))
            : null}
          {settledExpanded && settled.length > settledShown ? (
            <li className="list-none">
              <Button
                size="sm"
                variant="ghost-muted"
                onClick={() => setSettledShown((shown) => shown + SETTLED_PAGE)}
              >
                <PlusIcon aria-hidden />
                Show {Math.min(settled.length - settledShown, SETTLED_PAGE)} more
              </Button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}
