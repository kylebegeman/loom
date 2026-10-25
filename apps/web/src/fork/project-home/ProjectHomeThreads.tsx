import { useMemo, useRef, useState } from "react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  PROJECT_CONVERSATION_VIEWS,
  selectProjectHomeConversations,
  type ProjectConversationView,
  type ProjectHomeSectionId,
  type ProjectHomeThreadRow,
} from "@t3tools/client-runtime/fork";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ScopedThreadRef,
  type ServerConfig,
} from "@t3tools/contracts";
import {
  AlarmClockIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  MessageSquareIcon,
  MonitorOffIcon,
  XIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { resolveSidebarThreadStatus } from "~/components/Sidebar.logic";
import { useEnvironmentScope } from "~/state/session";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { projectHomeThreadAction, type ProjectHomeThreadAction } from "./threadActions";
import { Input } from "~/components/ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

const PAGE_SIZE = 12;

type Section = {
  readonly id: ProjectHomeSectionId;
  readonly title: string;
  readonly rows: readonly ProjectHomeThreadRow<EnvironmentThreadShell>[];
};

export function ProjectHomeThreads({
  sections,
  environmentLabels,
  serverConfigs,
  onOpenThread,
  onThreadAction,
}: {
  sections: readonly Section[];
  environmentLabels: ReadonlyMap<EnvironmentId, string>;
  serverConfigs: ReadonlyMap<EnvironmentId, ServerConfig>;
  onOpenThread: (thread: ScopedThreadRef) => void;
  onThreadAction: (
    action: ProjectHomeThreadAction,
    thread: ScopedThreadRef,
  ) => Promise<AtomCommandResult<unknown, unknown>>;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ProjectConversationView | null>(null);
  const [limits, setLimits] = useState<Partial<Record<ProjectHomeSectionId, number>>>({});
  const selection = useMemo(
    () => selectProjectHomeConversations({ sections, view, query }),
    [sections, view, query],
  );
  // Choose once after the catalog arrives; settling the last open thread keeps its view in place.
  if (view === null && selection.counts.all > 0) setView(selection.view);
  const visibleSections = selection.sections.filter((section) => section.rows.length > 0);
  const changeQuery = (value: string) => {
    setQuery(value);
    setLimits({});
  };
  const emptyMessage = selection.searching
    ? "No threads match this search."
    : selection.counts.all === 0
      ? "Start a new thread to begin working on this project."
      : selection.view === "snoozed"
        ? "No snoozed threads."
        : selection.view === "history"
          ? "Settled threads will appear here."
          : "No open threads. Your past work is in History.";
  return (
    <section
      aria-labelledby="project-home-conversations"
      className="@container/project-threads space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="project-home-conversations" className="text-base font-semibold">
          Threads
        </h2>
        <div className="flex w-full items-center gap-1 sm:w-64">
          <div className="min-w-0 flex-1">
            <ThreadSearch query={query} onQueryChange={changeQuery} />
          </div>
          {selection.searching ? (
            <Button
              variant="ghost-muted"
              size="icon-xs"
              aria-label="Clear thread search"
              onClick={() => changeQuery("")}
            >
              <XIcon aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>
      {selection.searching ? (
        <p role="status" className="py-1 text-xs text-muted-foreground">
          {selection.matchingCount} {selection.matchingCount === 1 ? "thread" : "threads"} matching
          across this project
        </p>
      ) : (
        <div role="group" aria-label="Thread view" className="flex flex-wrap items-center gap-1">
          {PROJECT_CONVERSATION_VIEWS.map((item) => (
            <Button
              key={item.id}
              variant={selection.view === item.id ? "secondary" : "ghost-muted"}
              size="xs"
              aria-pressed={selection.view === item.id}
              onClick={() => {
                setView(item.id);
                setLimits({});
              }}
            >
              {item.label}
              <span className="ml-1 tabular-nums opacity-60">{selection.counts[item.id]}</span>
            </Button>
          ))}
        </div>
      )}
      {selection.matchingCount === 0 ? (
        <div className="flex min-h-36 items-center justify-center rounded-xl bg-muted px-5 py-8">
          <p
            role="status"
            className="max-w-sm text-center text-sm leading-relaxed text-muted-foreground"
          >
            {emptyMessage}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {visibleSections.map((section) => {
            const limit = limits[section.id] ?? PAGE_SIZE;
            const showHeading =
              visibleSections.length > 1 || section.id === "attention" || section.id === "offline";
            return (
              <section key={section.id} aria-label={section.title} className="space-y-2">
                {showHeading ? (
                  <div className="flex items-center gap-2">
                    <h3
                      className={cn(
                        "text-xs font-medium",
                        section.id === "attention"
                          ? "text-warning-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {section.id === "offline" ? "Offline computers" : section.title}
                    </h3>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {section.rows.length}
                    </span>
                  </div>
                ) : null}
                {section.id === "offline" ? (
                  <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
                    Last known activity. Reconnect these computers to see current status and
                    continue work.
                  </p>
                ) : null}
                <ul aria-label={section.title} className="divide-y divide-border">
                  {section.rows.slice(0, limit).map((row) => (
                    <ProjectThreadRow
                      key={scopedThreadKey(scopeThreadRef(row.thread.environmentId, row.thread.id))}
                      row={row}
                      computer={environmentLabels.get(row.thread.environmentId) ?? "Computer"}
                      config={serverConfigs.get(row.thread.environmentId)}
                      onOpenThread={onOpenThread}
                      onThreadAction={onThreadAction}
                    />
                  ))}
                </ul>
                {section.rows.length > limit ? (
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {Math.min(limit, section.rows.length)} of {section.rows.length}
                    </span>
                    <Button
                      variant="ghost-muted"
                      size="xs"
                      onClick={() =>
                        setLimits((current) => ({ ...current, [section.id]: limit + PAGE_SIZE }))
                      }
                    >
                      Show {Math.min(PAGE_SIZE, section.rows.length - limit)} more{" "}
                      {section.id === "history" ? "settled threads" : "threads"}
                    </Button>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ThreadSearch({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (value: string) => void;
}) {
  return (
    <Input
      nativeInput
      type="search"
      size="sm"
      aria-label="Search project conversations"
      placeholder="Search threads"
      value={query}
      onChange={(event) => onQueryChange(event.currentTarget.value)}
    />
  );
}

function ProjectThreadRow({
  row,
  computer,
  config,
  onOpenThread,
  onThreadAction,
}: {
  row: ProjectHomeThreadRow<EnvironmentThreadShell>;
  computer: string;
  config: ServerConfig | undefined;
  onOpenThread: (thread: ScopedThreadRef) => void;
  onThreadAction: (
    action: ProjectHomeThreadAction,
    thread: ScopedThreadRef,
  ) => Promise<AtomCommandResult<unknown, unknown>>;
}) {
  const { thread, connected, activity } = row;
  const canOperate = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  const action = projectHomeThreadAction({
    activity,
    connected,
    canOperate,
    supportsSettlement: config?.environment.capabilities.threadSettlement === true,
    supportsSnooze: config?.environment.capabilities.threadSnooze === true,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const status = resolveSidebarThreadStatus(thread);
  const label = !connected
    ? "Last known, computer offline"
    : activity === "attention"
      ? status === "paused"
        ? "Queue paused"
        : status === "approval"
          ? "Approval requested"
          : "Response requested"
      : activity === "failed"
        ? status === "limited"
          ? "Usage limit reached"
          : "Failed"
        : activity === "working"
          ? status === "waiting"
            ? "Waiting for background work"
            : "Working"
          : activity === "snoozed"
            ? "Snoozed"
            : activity === "settled"
              ? "Settled"
              : "Ready to continue";
  const displayLabel = !connected
    ? "Offline"
    : activity === "working" && status === "waiting"
      ? "Waiting"
      : activity === "ready"
        ? "Ready"
        : label;
  const Icon = !connected
    ? MonitorOffIcon
    : activity === "attention" || activity === "failed"
      ? CircleAlertIcon
      : activity === "working"
        ? CircleDashedIcon
        : activity === "settled"
          ? CircleCheckIcon
          : activity === "snoozed"
            ? AlarmClockIcon
            : MessageSquareIcon;
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const runAction = async () => {
    if (!action || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    const updateThread = async () => {
      const result = await onThreadAction(action.action, threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(
          failure instanceof Error
            ? failure.message
            : "This computer could not update the conversation. Try again.",
        );
      }
    };
    await updateThread()
      .catch((failure) => {
        setError(
          failure instanceof Error
            ? failure.message
            : "This computer could not update the conversation. Try again.",
        );
      })
      .finally(() => {
        pendingRef.current = false;
        setPending(false);
      });
  };
  return (
    <li className="group rounded-lg [content-visibility:auto] [contain-intrinsic-size:auto_68px]">
      <div className="flex items-center gap-2 rounded-lg px-2 hover:bg-accent/50 focus-within:bg-accent/50">
        <button
          type="button"
          onClick={() => onOpenThread(threadRef)}
          aria-label={`Open ${thread.title}, ${label}, ${computer}`}
          className="grid min-w-0 flex-1 cursor-pointer grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring @3xl/project-threads:grid-cols-[1rem_minmax(0,1fr)_9.5rem_7rem_3.5rem]"
        >
          <Icon
            aria-hidden="true"
            className={cn(
              "col-start-1 row-start-1 size-4 shrink-0 self-start mt-0.5",
              connected && activity === "failed"
                ? "text-destructive-foreground"
                : connected && activity === "attention"
                  ? "text-warning-foreground"
                  : "text-icon-muted",
            )}
          />
          <span className="col-start-2 row-start-1 min-w-0 @3xl/project-threads:row-span-2">
            <Tooltip>
              <TooltipTrigger render={<span className="block truncate text-sm font-medium" />}>
                {thread.title}
              </TooltipTrigger>
              <TooltipPopup>{thread.title}</TooltipPopup>
            </Tooltip>
            {thread.branch ? (
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {thread.branch}
              </span>
            ) : null}
          </span>
          <span
            className={cn(
              "col-start-2 row-start-2 min-w-0 truncate text-xs @3xl/project-threads:col-start-3 @3xl/project-threads:row-span-2 @3xl/project-threads:row-start-1",
              !connected
                ? "text-muted-foreground"
                : activity === "failed"
                  ? "text-destructive-foreground"
                  : activity === "attention"
                    ? "text-warning-foreground"
                    : activity === "working"
                      ? "text-info-foreground"
                      : "text-muted-foreground",
            )}
          >
            <Tooltip>
              <TooltipTrigger render={<span />}>{displayLabel}</TooltipTrigger>
              <TooltipPopup>{label}</TooltipPopup>
            </Tooltip>
          </span>
          <span className="col-start-2 row-start-3 truncate text-xs text-muted-foreground @3xl/project-threads:col-start-4 @3xl/project-threads:row-span-2 @3xl/project-threads:row-start-1">
            {computer}
          </span>
          <span className="col-start-3 row-span-3 row-start-1 text-right text-xs tabular-nums text-muted-foreground @3xl/project-threads:col-start-5 @3xl/project-threads:row-span-2">
            {formatRelativeTimeLabel(thread.updatedAt)}
          </span>
        </button>
        <div className="flex w-14 shrink-0 justify-end">
          {action ? (
            <Button
              variant="ghost-muted"
              size="xs"
              aria-label={`${action.label} ${thread.title}`}
              disabled={pending}
              onClick={() => void runAction()}
            >
              {pending ? "Saving..." : action.label}
            </Button>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="alert" className="px-2 pb-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}
