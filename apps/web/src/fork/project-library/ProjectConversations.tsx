import {
  PROJECT_SORT_LABELS,
  PROJECT_SORTS,
  type ProjectSort,
  CONVERSATION_LANE_LABELS,
  CONVERSATION_LANES,
  conversationStatus,
  conversationTitle,
  filterConversations,
  sortConversations,
  type ConversationLane,
  type ConversationStatus,
  type LiveConversation,
} from "@t3tools/client-runtime/fork";
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
  MessagesSquareIcon,
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
import { ComputerLabel, ProjectGlow } from "./ProjectIdentity";

/** Rows per step of "Show more". The whole list is already loaded, so paging only keeps it calm. */
const CONVERSATION_PAGE = 20;
/** A short list reads at a glance; search and sort arrive once there's something to look through. */
const TOOLS_AFTER = 5;
/** Rows under the featured conversation on the overview. */
const RECENT_ROWS = 4;
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
    <LibrarySection title="Conversations" icon={MessagesSquareIcon} count={threads.length}>
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
              <span className="font-normal tabular-nums opacity-60">({laneCount(entry)})</span>
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
        <FeaturedConversation
          project={project}
          thread={featured}
          status={statuses.get(featured.id)}
          hostLabel={hostLabel}
          connected={hostConnected(featured.environmentId)}
        />
      ) : null}
      {shown.length ? (
        <ul className={featured ? "pt-1" : undefined}>
          {shown.map((thread) => (
            <li key={thread.id}>
              <ConversationRow
                project={project}
                thread={thread}
                status={statuses.get(thread.id)}
                hostLabel={hostLabel}
                connected={hostConnected(thread.environmentId)}
                at={sort === "created" ? thread.createdAt : thread.updatedAt}
              />
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

/**
 * The overview's slice of the list: the latest active conversation to pick back up, then the
 * next few, with the way to every conversation.
 */
export function RecentConversations({
  project,
  threads,
  loading,
  error,
  onRetry,
  hostLabel,
  hostConnected,
  onShowAll,
}: {
  readonly project: LibraryProject;
  readonly threads: readonly LibraryThreadSummary[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly hostConnected: (id: EnvironmentId) => boolean;
  readonly onShowAll: () => void;
}) {
  const live = useLiveConversations(threads, hostConnected);
  const statusOf = (thread: LibraryThreadSummary) =>
    conversationStatus(thread, live.get(liveKey(thread.environmentId, thread.threadId)) ?? null);
  // Threads arrive newest first, so the first active ones are the latest.
  const active = threads.filter((thread) => statusOf(thread).lane === "active");
  const [featured, ...rest] = active.length ? active : threads;
  const recent = rest.slice(0, RECENT_ROWS);
  return (
    <LibrarySection
      title="Recent conversations"
      icon={MessagesSquareIcon}
      action={
        threads.length > recent.length + 1 ? (
          <Button shape="pill" size="xs" variant="ghost" onClick={onShowAll}>
            All {threads.length}
            <ArrowRightIcon />
          </Button>
        ) : null
      }
    >
      <LibraryErrorNotice error={error} onRetry={onRetry} />
      {featured ? (
        <FeaturedConversation
          project={project}
          thread={featured}
          status={statusOf(featured)}
          hostLabel={hostLabel}
          connected={hostConnected(featured.environmentId)}
        />
      ) : loading ? (
        <p role="status" className="text-xs text-muted-foreground">
          Loading conversations...
        </p>
      ) : null}
      {recent.length ? (
        <ul className="pt-1">
          {recent.map((thread) => (
            <li key={thread.id}>
              <ConversationRow
                project={project}
                thread={thread}
                status={statusOf(thread)}
                hostLabel={hostLabel}
                connected={hostConnected(thread.environmentId)}
                at={thread.updatedAt}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </LibrarySection>
  );
}

function FeaturedConversation({
  project,
  thread,
  status,
  hostLabel,
  connected,
}: {
  readonly project: LibraryProject;
  readonly thread: LibraryThreadSummary;
  readonly status: ConversationStatus | undefined;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly connected: boolean;
}) {
  return (
    <ConversationLink
      thread={thread}
      connected={connected}
      className="group/card relative isolate flex items-center gap-4 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-xs/5 outline-none transition-shadow duration-200 hover:shadow-md/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-5"
    >
      <ProjectGlow strength="strong" />
      <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-(--project-color) text-background shadow-sm">
        <MessageSquareIcon aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-2xs font-semibold tracking-wider text-(--project-color) uppercase">
          Pick up where you left off
          <span className="ms-1.5 font-medium tracking-normal text-muted-foreground normal-case">
            {formatRelativeTimeLabel(thread.updatedAt)}
          </span>
        </p>
        <p className="truncate text-lg font-semibold tracking-tight">{conversationTitle(thread)}</p>
        <ConversationMeta project={project} thread={thread} status={status} hostLabel={hostLabel} />
      </div>
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors duration-200 group-hover/card:bg-(--project-color) group-hover/card:text-background dark:bg-accent">
        <ArrowRightIcon aria-hidden className="size-4" />
      </span>
    </ConversationLink>
  );
}

function ConversationRow({
  project,
  thread,
  status,
  hostLabel,
  connected,
  at,
}: {
  readonly project: LibraryProject;
  readonly thread: LibraryThreadSummary;
  readonly status: ConversationStatus | undefined;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly connected: boolean;
  readonly at: string;
}) {
  return (
    <ConversationLink
      thread={thread}
      connected={connected}
      className={cn(
        LIBRARY_ROW,
        "-mx-3 flex items-center gap-3 px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
      )}
    >
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted dark:bg-accent">
        <ConversationStatusIcon status={status} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {conversationTitle(thread)}
      </span>
      <ConversationStatusLabel status={status} className="sm:hidden" />
      <ConversationMeta
        project={project}
        thread={thread}
        status={status}
        hostLabel={hostLabel}
        className="hidden max-w-1/2 sm:flex"
      />
      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {formatRelativeTimeLabel(at)}
      </span>
    </ConversationLink>
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
