import { useMemo, useRef, useState } from "react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ProjectHomeSectionId, ProjectHomeThreadRow } from "@t3tools/client-runtime/fork";
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
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { resolveSidebarThreadStatus } from "~/components/Sidebar.logic";
import { useEnvironmentScope } from "~/state/session";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { projectHomeThreadAction, type ProjectHomeThreadAction } from "./threadActions";
import { Input } from "~/components/ui/input";

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
  const [limits, setLimits] = useState<Partial<Record<ProjectHomeSectionId, number>>>({});
  const matchingSections = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return sections.map((section) => ({
      ...section,
      rows: search
        ? section.rows.filter(({ thread }) => thread.title.toLocaleLowerCase().includes(search))
        : section.rows,
    }));
  }, [query, sections]);
  const matchingCount = matchingSections.reduce((count, section) => count + section.rows.length, 0);
  return (
    <section aria-labelledby="project-home-conversations" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="project-home-conversations" className="text-base font-medium">
          Conversations
        </h2>
        <div className="w-full sm:w-64">
          <ThreadSearch
            query={query}
            onQueryChange={(value) => {
              setQuery(value);
              setLimits({});
            }}
          />
        </div>
      </div>
      {matchingCount === 0 ? (
        <p role="status" className="py-3 text-sm text-muted-foreground">
          {query.trim()
            ? "No conversations match this search."
            : "Start a thread on a connected computer to begin working on this project."}
        </p>
      ) : (
        matchingSections.map((section) => {
          if (section.rows.length === 0) return null;
          const limit = limits[section.id] ?? PAGE_SIZE;
          return (
            <section
              key={section.id}
              aria-labelledby={`project-home-${section.id}`}
              className="space-y-2"
            >
              <h3
                id={`project-home-${section.id}`}
                className="flex items-center gap-2 text-sm font-medium text-muted-foreground"
              >
                {section.title}
                <span className="text-xs font-normal">{section.rows.length}</span>
              </h3>
              {section.id === "offline" ? (
                <p className="text-xs text-muted-foreground">
                  These are saved snapshots. Reconnect their computers to see current activity and
                  continue work.
                </p>
              ) : null}
              <ul
                aria-label={section.title}
                className="divide-y divide-border rounded-lg border border-border"
              >
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
                <Button
                  variant="ghost-muted"
                  size="xs"
                  onClick={() =>
                    setLimits((current) => ({ ...current, [section.id]: limit + PAGE_SIZE }))
                  }
                >
                  Show {Math.min(PAGE_SIZE, section.rows.length - limit)} more{" "}
                  {section.id === "history" ? "settled conversations" : "conversations"}
                </Button>
              ) : null}
            </section>
          );
        })
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
      placeholder="Search conversations"
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
      ? status === "approval"
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
    try {
      const result = await onThreadAction(action.action, threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(
          failure instanceof Error
            ? failure.message
            : "This computer could not update the conversation. Try again.",
        );
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "This computer could not update the conversation. Try again.",
      );
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  return (
    <li className="px-3 py-2 [content-visibility:auto] [contain-intrinsic-size:auto_70px]">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onOpenThread(threadRef)}
          aria-label={`Open ${thread.title}, ${label}, ${computer}`}
          className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-md py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-icon-muted" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{thread.title}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {label}, {computer}
            </span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {formatRelativeTimeLabel(thread.updatedAt)}
              {thread.branch ? `, ${thread.branch}` : ""}
            </span>
          </span>
        </button>
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
      {error ? (
        <p role="alert" className="pb-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}
