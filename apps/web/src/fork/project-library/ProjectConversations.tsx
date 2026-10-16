import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";
import type { LibraryProject, LibraryThreadSummary } from "@t3tools/contracts/fork";
import {
  AlarmClockIcon,
  ArchiveIcon,
  ArrowDownUpIcon,
  ArrowRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  FolderGit2Icon,
  ListFilterIcon,
  MessageSquareIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { useProjectHomeClock } from "~/fork/project-home/useProjectHomeClock";
import {
  resolveProjectThreadActivity,
  type ProjectThreadActivity,
} from "~/fork/project-navigation/activity";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { useServerConfigs, useThreadShellsForProjectRefs } from "~/state/entities";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { LIBRARY_ROW, LibraryErrorNotice, LibrarySearch, LibrarySection } from "./LibraryControls";
import { ProjectWash } from "./ProjectCollection";
import { ComputerLabel } from "./ProjectIdentity";
import { PROJECT_SORT_LABELS, PROJECT_SORTS, type ProjectSort } from "./projectList";
import {
  CONVERSATION_LANE_LABELS,
  CONVERSATION_LANES,
  conversationStatus,
  conversationTitle,
  filterConversations,
  sortConversations,
  type ConversationLane,
  type ConversationStatus,
  type LiveConversation,
} from "./conversationList";

/** Rows per step of "Show more". The whole list is already loaded, so paging only keeps it calm. */
const CONVERSATION_PAGE = 20;
/** A short list reads at a glance; search and sort arrive once there's something to look through. */
const TOOLS_AFTER = 5;
const SORT_KEY = "loom:library:project-conversations-sort:v1";
const SortSchema = Schema.Literals(PROJECT_SORTS);

/**
 * Conversations split the way the sidebar splits threads: active, settled and archived. The
 * latest active one leads, since picking it back up is the most common reason to be here.
 * Searching, narrowing or sorting another way turns the list plain, so the lead never misleads.
 */
export function ProjectConversations({
  project,
  threads,
  loading,
  error,
  onRetry,
  hostLabel,
  hostConnected,
}: {
  readonly project: LibraryProject;
  readonly threads: readonly LibraryThreadSummary[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly hostConnected: (id: EnvironmentId) => boolean;
}) {
  const live = useLiveConversations(threads, hostConnected);
  const statuses = new Map(
    threads.map((thread) => [
      thread.id,
      conversationStatus(thread, live.get(liveKey(thread.environmentId, thread.threadId)) ?? null),
    ]),
  );
  const laneOf = (thread: LibraryThreadSummary) => statuses.get(thread.id)?.lane ?? "active";
  // Opens wherever there's something to see first, and stays put once chosen.
  const [chosenLane, setLane] = useState<ConversationLane | null>(null);
  const lanes = CONVERSATION_LANES.filter(
    (entry) => entry === chosenLane || threads.some((thread) => laneOf(thread) === entry),
  );
  const lane = chosenLane ?? lanes[0] ?? "active";
  const [query, setQuery] = useState("");
  const [computer, setComputer] = useState<EnvironmentId | null>(null);
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [sort, setSort] = useLocalStorage<ProjectSort, ProjectSort>(
    SORT_KEY,
    "activity",
    SortSchema,
  );
  const narrowed = !!query.trim() || computer !== null || resourceId !== null;
  const matching = filterConversations(
    threads,
    project,
    { search: query, computer, resourceId },
    hostLabel,
  );
  const laneCount = (entry: ConversationLane) =>
    matching.filter((thread) => laneOf(thread) === entry).length;
  const listed = sortConversations(
    matching.filter((thread) => laneOf(thread) === lane),
    sort,
  );
  const featured = !narrowed && sort === "activity" && lane === "active" ? listed[0] : undefined;
  const rest = featured ? listed.slice(1) : listed;
  // Any change to what's listed starts paging over from the first page.
  const pageKey = JSON.stringify([lane, query, computer, resourceId, sort]);
  const [page, setPage] = useState({ key: pageKey, count: CONVERSATION_PAGE });
  const count = page.key === pageKey ? page.count : CONVERSATION_PAGE;
  const shown = rest.slice(0, count);
  const remaining = rest.length - shown.length;
  const computers = [...new Set(threads.map((thread) => thread.environmentId))];
  const repositories = project.resources.filter((resource) =>
    threads.some((thread) => thread.resourceIds.includes(resource.id)),
  );
  const repository = project.resources.find((resource) => resource.id === resourceId);
  const clear = () => {
    setQuery("");
    setComputer(null);
    setResourceId(null);
  };
  const otherMatches = CONVERSATION_LANES.filter((entry) => entry !== lane && laneCount(entry) > 0);
  const tools = threads.length > TOOLS_AFTER;
  return (
    <LibrarySection title="Conversations" count={threads.length}>
      {lanes.length > 1 ? (
        <ToggleGroup
          shape="pill"
          aria-label="Which conversations"
          variant="segmented"
          className="w-fit"
          value={[lane]}
          onValueChange={(value) => {
            const next = CONVERSATION_LANES.find((entry) => entry === value[0]);
            if (next) setLane(next);
          }}
        >
          {lanes.map((entry) => (
            <ToggleGroupItem key={entry} value={entry}>
              {CONVERSATION_LANE_LABELS[entry]}
              <span className="tabular-nums opacity-60">{laneCount(entry)}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : null}
      {tools ? (
        <div className="flex flex-wrap items-center gap-2 pb-2">
          <LibrarySearch
            value={query}
            onChange={setQuery}
            placeholder="Search titles, computers, repos"
            label="Search conversations"
          />
          <ConversationFilters
            computers={computers}
            repositories={repositories}
            computer={computer}
            resourceId={resourceId}
            hostLabel={hostLabel}
            onComputer={setComputer}
            onResource={setResourceId}
          />
          {computer ? (
            <Button
              shape="pill"
              size="xs"
              variant="secondary"
              aria-label={`Stop showing only conversations on ${hostLabel(computer)}`}
              onClick={() => setComputer(null)}
            >
              <ComputerLabel
                environmentId={computer}
                label={hostLabel(computer)}
                className="text-foreground"
              />
              <XIcon aria-hidden />
            </Button>
          ) : null}
          {repository ? (
            <Button
              shape="pill"
              size="xs"
              variant="secondary"
              aria-label={`Stop showing only conversations about ${repository.title}`}
              onClick={() => setResourceId(null)}
            >
              <FolderGit2Icon aria-hidden />
              {repository.title}
              <XIcon aria-hidden />
            </Button>
          ) : null}
          <div className="ms-auto">
            <Menu>
              <MenuTrigger render={<Button shape="pill" size="sm" variant="ghost" />}>
                <ArrowDownUpIcon />
                {PROJECT_SORT_LABELS[sort]}
              </MenuTrigger>
              <MenuPopup side="bottom" align="end">
                <MenuGroup>
                  <MenuGroupLabel>Sort by</MenuGroupLabel>
                  <MenuRadioGroup
                    value={sort}
                    onValueChange={(value) => {
                      const next = PROJECT_SORTS.find((entry) => entry === value);
                      if (next) setSort(next);
                    }}
                  >
                    {PROJECT_SORTS.map((entry) => (
                      <MenuRadioItem key={entry} value={entry}>
                        {PROJECT_SORT_LABELS[entry]}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
              </MenuPopup>
            </Menu>
          </div>
        </div>
      ) : null}
      <LibraryErrorNotice error={error} onRetry={onRetry} />
      {featured ? (
        <ConversationLink
          thread={featured}
          connected={hostConnected(featured.environmentId)}
          className="group/card relative isolate -mx-3 flex items-center gap-4 rounded-xl p-3 outline-none transition-colors duration-200 hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ProjectWash />
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-(--project-color)/12 text-(--project-color) dark:bg-(--project-color)/16">
            <MessageSquareIcon aria-hidden className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs text-muted-foreground">
              Pick up where you left off · {formatRelativeTimeLabel(featured.updatedAt)}
            </p>
            <p className="truncate text-base font-semibold tracking-tight">
              {conversationTitle(featured)}
            </p>
            <ConversationMeta
              project={project}
              thread={featured}
              status={statuses.get(featured.id)}
              hostLabel={hostLabel}
            />
          </div>
          <ArrowRightIcon
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover/card:translate-x-0.5 group-hover/card:text-foreground"
          />
        </ConversationLink>
      ) : null}
      {shown.length ? (
        <ul className={featured ? "pt-1" : undefined}>
          {shown.map((thread) => (
            <li key={thread.id}>
              <ConversationLink
                thread={thread}
                connected={hostConnected(thread.environmentId)}
                className={cn(
                  LIBRARY_ROW,
                  "-mx-3 flex items-center gap-3 px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                )}
              >
                <ConversationStatusIcon status={statuses.get(thread.id)} />
                <span className="min-w-0 flex-1 truncate text-sm">{conversationTitle(thread)}</span>
                <ConversationStatusLabel status={statuses.get(thread.id)} className="sm:hidden" />
                <ConversationMeta
                  project={project}
                  thread={thread}
                  status={statuses.get(thread.id)}
                  hostLabel={hostLabel}
                  className="hidden max-w-1/2 sm:flex"
                />
                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {formatRelativeTimeLabel(
                    sort === "created" ? thread.createdAt : thread.updatedAt,
                  )}
                </span>
              </ConversationLink>
            </li>
          ))}
        </ul>
      ) : null}
      {listed.length ? null : loading ? (
        <p role="status" className="text-xs text-muted-foreground">
          Loading conversations...
        </p>
      ) : error ? null : narrowed ? (
        <div className="flex flex-wrap items-center gap-2 py-2">
          <p className="me-1 text-sm text-muted-foreground">
            No {lanes.length > 1 ? CONVERSATION_LANE_LABELS[lane].toLocaleLowerCase() : ""}{" "}
            conversations match.
          </p>
          {otherMatches.map((entry) => (
            <Button
              key={entry}
              shape="pill"
              size="xs"
              variant="secondary"
              onClick={() => setLane(entry)}
            >
              {laneCount(entry)} {CONVERSATION_LANE_LABELS[entry].toLocaleLowerCase()}
            </Button>
          ))}
          <Button shape="pill" size="xs" variant="outline" onClick={clear}>
            Clear filters
          </Button>
        </div>
      ) : threads.length ? (
        <p className="text-xs text-muted-foreground">
          No {CONVERSATION_LANE_LABELS[lane].toLocaleLowerCase()} conversations.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          No conversations were saved in this project.
        </p>
      )}
      {remaining > 0 ? (
        <div className="flex items-center justify-center gap-3 pt-2 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {listed.length - remaining} of {listed.length}
          </span>
          <Button
            shape="pill"
            size="xs"
            variant="outline"
            onClick={() => setPage({ key: pageKey, count: count + CONVERSATION_PAGE })}
          >
            Show {Math.min(CONVERSATION_PAGE, remaining)} more
          </Button>
        </div>
      ) : null}
    </LibrarySection>
  );
}

/** Computer and repository, offered only when there's more than one place to narrow to. */
function ConversationFilters({
  computers,
  repositories,
  computer,
  resourceId,
  hostLabel,
  onComputer,
  onResource,
}: {
  readonly computers: readonly EnvironmentId[];
  readonly repositories: readonly LibraryProject["resources"][number][];
  readonly computer: EnvironmentId | null;
  readonly resourceId: string | null;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly onComputer: (id: EnvironmentId | null) => void;
  readonly onResource: (id: string | null) => void;
}) {
  const showComputers = computers.length > 1 || computer !== null;
  const showRepositories = repositories.length > 0 || resourceId !== null;
  if (!showComputers && !showRepositories) return null;
  const active = (computer ? 1 : 0) + (resourceId ? 1 : 0);
  return (
    <Menu>
      <MenuTrigger render={<Button shape="pill" size="sm" variant="outline" />}>
        <ListFilterIcon />
        Filters
        {active ? (
          <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
            {active}
          </span>
        ) : null}
      </MenuTrigger>
      <MenuPopup side="bottom" align="start">
        {showComputers ? (
          <MenuGroup>
            <MenuGroupLabel>Computer</MenuGroupLabel>
            <MenuRadioGroup
              value={computer ?? "all"}
              onValueChange={(value) => onComputer(computers.find((id) => id === value) ?? null)}
            >
              <MenuRadioItem value="all">Any computer</MenuRadioItem>
              {computers.map((id) => (
                <MenuRadioItem key={id} value={id}>
                  <ComputerLabel
                    environmentId={id}
                    label={hostLabel(id)}
                    className="text-foreground"
                  />
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        ) : null}
        {showComputers && showRepositories ? <MenuSeparator /> : null}
        {showRepositories ? (
          <MenuGroup>
            <MenuGroupLabel>Repository</MenuGroupLabel>
            <MenuRadioGroup
              value={resourceId ?? "all"}
              onValueChange={(value) =>
                onResource(repositories.find((entry) => entry.id === value)?.id ?? null)
              }
            >
              <MenuRadioItem value="all">Whole project</MenuRadioItem>
              {repositories.map((entry) => (
                <MenuRadioItem key={entry.id} value={entry.id}>
                  {entry.title}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

/**
 * What a conversation is doing when that needs a word, where it ran and what it was about, when
 * it was about one repository.
 */
function ConversationMeta({
  project,
  thread,
  status,
  hostLabel,
  className,
}: {
  readonly project: LibraryProject;
  readonly thread: LibraryThreadSummary;
  readonly status: ConversationStatus | undefined;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly className?: string;
}) {
  const scope =
    thread.resourceIds.length === 1
      ? project.resources.find((resource) => resource.id === thread.resourceIds[0])?.title
      : null;
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <ConversationStatusLabel status={status} />
      <ComputerLabel
        environmentId={thread.environmentId}
        label={hostLabel(thread.environmentId)}
        className="min-w-0 shrink"
      />
      {scope ? (
        <span className="inline-flex h-5 min-w-0 items-center gap-1 rounded-full bg-muted px-2 text-2xs font-medium text-foreground/80 dark:bg-accent">
          <FolderGit2Icon aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{scope}</span>
        </span>
      ) : null}
    </span>
  );
}

/**
 * The sidebar's vocabulary: color only for what needs you, what's moving and what broke. Ready
 * and settled stay quiet. Working never spins, so a long list of runs costs no repaints.
 */
const ACTIVITY_DISPLAY: Record<
  ProjectThreadActivity,
  { readonly icon: LucideIcon; readonly label: string | null; readonly className: string }
> = {
  attention: { icon: CircleAlertIcon, label: "Needs you", className: "text-warning-foreground" },
  working: { icon: CircleDashedIcon, label: "Working", className: "text-info-foreground" },
  failed: { icon: CircleAlertIcon, label: "Failed", className: "text-destructive-foreground" },
  snoozed: { icon: AlarmClockIcon, label: "Snoozed", className: "text-muted-foreground" },
  settled: { icon: CircleCheckIcon, label: null, className: "text-muted-foreground" },
  ready: { icon: MessageSquareIcon, label: null, className: "text-muted-foreground" },
};

function ConversationStatusLabel({
  status,
  className,
}: {
  readonly status: ConversationStatus | undefined;
  readonly className?: string;
}) {
  const display = status?.activity ? ACTIVITY_DISPLAY[status.activity] : null;
  if (!display?.label) return null;
  return (
    <span className={cn("shrink-0 text-xs font-medium", display.className, className)}>
      {display.label}
    </span>
  );
}

function ConversationStatusIcon({ status }: { readonly status: ConversationStatus | undefined }) {
  const display = status?.activity ? ACTIVITY_DISPLAY[status.activity] : null;
  const Icon = status?.lane === "archived" ? ArchiveIcon : (display?.icon ?? MessageSquareIcon);
  return (
    <Icon
      aria-hidden
      className={cn("size-3.5 shrink-0", display?.className ?? "text-muted-foreground")}
    />
  );
}

const liveKey = (environmentId: EnvironmentId, threadId: string) => `${environmentId}\0${threadId}`;

/**
 * Live state for conversations whose computer is connected, read from the same thread shells the
 * sidebar uses. Conversations on other computers fall back to the Library's saved copy.
 */
function useLiveConversations(
  threads: readonly LibraryThreadSummary[],
  hostConnected: (id: EnvironmentId) => boolean,
) {
  const refs = new Map<string, ScopedProjectRef>();
  for (const thread of threads)
    if (hostConnected(thread.environmentId))
      refs.set(liveKey(thread.environmentId, thread.localProjectId), {
        environmentId: thread.environmentId,
        projectId: thread.localProjectId,
      });
  const shells = useThreadShellsForProjectRefs([...refs.values()]);
  const configs = useServerConfigs();
  const now = useProjectHomeClock(shells);
  return new Map<string, LiveConversation>(
    shells.map((shell) => [
      liveKey(shell.environmentId, shell.id),
      {
        archived: shell.archivedAt !== null,
        activity: resolveProjectThreadActivity(shell, configs.get(shell.environmentId), now),
      },
    ]),
  );
}

/**
 * A connected computer opens the conversation itself, ready to continue. Otherwise the Library's
 * saved copy opens, readable until that computer is back or the work continues elsewhere.
 */
function ConversationLink({
  thread,
  connected,
  className,
  children,
}: {
  readonly thread: LibraryThreadSummary;
  readonly connected: boolean;
  readonly className: string;
  readonly children: ReactNode;
}) {
  return connected ? (
    <Link
      to="/$environmentId/$threadId"
      params={{ environmentId: thread.environmentId, threadId: thread.threadId }}
      className={className}
    >
      {children}
    </Link>
  ) : (
    <Link
      to="/library/conversations/$conversationId"
      params={{ conversationId: thread.id }}
      className={className}
    >
      {children}
    </Link>
  );
}
