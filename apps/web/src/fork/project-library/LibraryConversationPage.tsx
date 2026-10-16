import {
  libraryHistoryOffsetForItem,
  shouldRefreshLibraryArchive,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import {
  LIBRARY_BRIEF_PROPOSALS_FEATURE,
  LIBRARY_BRIEF_SUGGESTIONS_FEATURE,
} from "@t3tools/contracts/fork";
import type { TimelineEntry } from "~/session-logic";
import { turnItemOutputText, toolCallLines } from "@t3tools/client-runtime/work-log/item-detail";
import { ChevronRightIcon, ChevronDownIcon } from "lucide-react";
import { WorkLogBlock, WorkLogButton, WorkLogDetails } from "~/components/chat/WorkLog";
import { LibraryAttachment } from "./LibraryAttachment";
import { libraryArchiveTimeline, libraryEntryItemId } from "./libraryArchive";
import { LibraryUploadStatus } from "./LibraryUploadStatus";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import ChatMarkdown from "~/components/ChatMarkdown";
import { useEnvironmentQuery } from "~/state/query";
import {
  projectLibrary,
  useLibraryAuthority,
  useLibraryProject,
  useLibraryPermission,
  useSelectedLibraryProject,
} from "./state";
import { LibraryBackLink, LibraryPageFrame } from "./LibraryPageFrame";
import { LibraryErrorNotice } from "./LibraryControls";
import { NewConversationDialog } from "./NewConversationDialog";
import { BriefSuggestionOffer } from "./BriefSuggestionOffer";
import { SuggestBriefUpdates } from "./SuggestBriefUpdates";

/** Anchors each saved item, so a link can name the one to open at. */
export const libraryItemAnchor = (itemId: string) => `item-${itemId}`;

export function LibraryConversationPage({
  conversationId,
  target,
}: {
  readonly conversationId: string;
  /** A history search result's item and its position in saved history, oldest first. */
  readonly target?: { readonly item: string; readonly position: number };
}) {
  const authority = useLibraryAuthority();
  const [, selectProject] = useSelectedLibraryProject();
  const [historyOffset, setHistoryOffset] = useState(0);
  const [previousOffsets, setPreviousOffsets] = useState<readonly number[]>([]);
  // Paging toward the target item until a page shows it. Paging by hand stops the search.
  const [seeking, setSeeking] = useState(target !== undefined);
  const history = useEnvironmentQuery(
    authority.authorityId
      ? projectLibrary.history({
          environmentId: authority.authorityId,
          input: { id: conversationId, offset: historyOffset, limit: 100 },
        })
      : null,
  );
  const library = useLibraryProject(history.data?.summary.projectId ?? "");
  const canContinue = useLibraryPermission(projectLibrary.registerThread, authority.authorityId);
  const [continuing, setContinuing] = useState(false);
  const visibleMessages = 100;
  const archive = history.data;
  const timeline = useMemo(
    () => (archive ? libraryArchiveTimeline(archive.projection) : []),
    [archive],
  );
  const historyWindow = archive?.window;
  const targetItem = target?.item;
  const targetPosition = target?.position;
  // Adjusted while rendering, once each page arrives, so the next read starts without an extra pass.
  if (seeking && targetPosition !== undefined && historyWindow?.offset === historyOffset) {
    const offset = libraryHistoryOffsetForItem(targetPosition, historyWindow);
    if (offset === null) setSeeking(false);
    else if (offset !== historyOffset) setHistoryOffset(offset);
  }
  const shownTimeline = useMemo(() => timeline.slice(-visibleMessages), [timeline]);
  const matchedEntryId = targetItem
    ? shownTimeline.find((entry) => libraryEntryItemId(entry) === targetItem)?.id
    : undefined;
  const matchRef = useRef<HTMLElement | null>(null);
  const scrolledTo = useRef<string | null>(null);
  // Brings the matched item into view once, without moving the page again as history refreshes.
  useEffect(() => {
    if (!matchedEntryId || scrolledTo.current === matchedEntryId) return;
    scrolledTo.current = matchedEntryId;
    matchRef.current?.scrollIntoView({ block: "center" });
    matchRef.current?.focus({ preventScroll: true });
  }, [matchedEntryId]);
  const savedProjectId = archive?.summary.projectId;
  const listedThread = library.threads.data?.find((thread) => thread.id === conversationId);
  const refreshArchive = shouldRefreshLibraryArchive(archive?.summary ?? null, listedThread);
  const refreshSequence = refreshArchive
    ? `${conversationId}:${archive?.summary.sequence}:${listedThread?.sequence}`
    : null;
  const refreshHistory = history.refresh;
  useEffect(() => {
    if (refreshSequence !== null) refreshHistory();
  }, [refreshSequence, refreshHistory]);
  useEffect(() => {
    if (savedProjectId) selectProject(savedProjectId);
  }, [savedProjectId, selectProject]);
  const host = authority.environments.find(
    (entry) => entry.environmentId === archive?.summary.environmentId,
  );
  const hostLabel =
    host?.label ??
    authority.computers.find((entry) => entry.environmentId === archive?.summary.environmentId)
      ?.label ??
    "its original computer";
  if (!archive)
    return (
      <LibraryPageFrame>
        <LibraryErrorNotice error={history.error} onRetry={history.refresh} />
        <p role="status" className="text-sm text-muted-foreground">
          {history.isPending
            ? "Loading saved conversation..."
            : "This conversation is not saved on this device yet. Connect your Library to load its history."}
        </p>
      </LibraryPageFrame>
    );
  return (
    <LibraryPageFrame title={archive.summary.title}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <LibraryBackLink
            to="/library/$projectId"
            params={{ projectId: archive.summary.projectId }}
          >
            {library.project.data?.title ?? "Project"}
          </LibraryBackLink>
          <h1 className="text-xl font-semibold tracking-tight">{archive.summary.title}</h1>
          <p className="text-xs text-muted-foreground">
            Runs on {hostLabel}. Saved to Library{" "}
            {new Date(archive.summary.syncedAt).toLocaleString()}.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <SuggestBriefUpdates
            summary={archive.summary}
            projectArchived={library.project.data?.archived ?? false}
            libraryKeepsProposals={supportsLoomFeature(
              authority.environment?.serverConfig?.environment.capabilities,
              LIBRARY_BRIEF_PROPOSALS_FEATURE,
            )}
            hostLabel={hostLabel}
            hostConnected={host?.entry.enabled === true && host.connection.phase === "connected"}
            hostProposes={supportsLoomFeature(
              host?.serverConfig?.environment.capabilities,
              LIBRARY_BRIEF_PROPOSALS_FEATURE,
            )}
          />
          {host?.connection.phase === "connected" ? (
            <Button
              variant="outline"
              render={
                <Link
                  to="/$environmentId/$threadId"
                  params={{
                    environmentId: archive.summary.environmentId,
                    threadId: archive.summary.threadId,
                  }}
                />
              }
            >
              Open live conversation
            </Button>
          ) : null}
          <Button
            disabled={
              !canContinue ||
              !authority.connected ||
              !library.project.data ||
              library.project.data.archived
            }
            onClick={() => setContinuing(true)}
          >
            Continue elsewhere
          </Button>
        </div>
      </div>
      {host?.connection.phase !== "connected" ? (
        <p className="text-sm text-muted-foreground">
          The original computer is offline. You can read saved history here, reconnect it, or
          continue in a linked conversation on another computer.
        </p>
      ) : null}
      {archive.summary.continuationOf ? (
        <p className="text-xs text-muted-foreground">
          Linked continuation from conversation {archive.summary.continuationOf.threadId}.
        </p>
      ) : null}
      {host?.entry.enabled === true &&
      host.connection.phase === "connected" &&
      supportsLoomFeature(
        host.serverConfig?.environment.capabilities,
        LIBRARY_BRIEF_SUGGESTIONS_FEATURE,
      ) ? (
        <BriefSuggestionOffer
          environmentId={archive.summary.environmentId}
          threadId={archive.summary.threadId}
        />
      ) : null}
      {host?.connection.phase === "connected" ? (
        <LibraryUploadStatus
          environmentId={archive.summary.environmentId}
          threadId={archive.summary.threadId}
          onSynced={history.refresh}
        />
      ) : null}
      <LibraryErrorNotice error={history.error} onRetry={history.refresh} />
      {historyOffset > 0 || archive.window?.hasMore ? (
        <div className="flex items-center gap-3">
          {archive.window?.hasMore ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSeeking(false);
                setPreviousOffsets((offsets) => [...offsets, historyOffset]);
                setHistoryOffset(archive.window?.nextOffset ?? historyOffset + 100);
              }}
            >
              Earlier history
            </Button>
          ) : null}
          {historyOffset > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSeeking(false);
                setHistoryOffset(previousOffsets.at(-1) ?? 0);
                setPreviousOffsets((offsets) => offsets.slice(0, -1));
              }}
            >
              Newer history
            </Button>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {historyOffset > 0 ? "Earlier saved history" : "Latest saved history"}
          </p>
        </div>
      ) : null}
      <div className="divide-y divide-border">
        {shownTimeline.map((entry) => {
          const matched = entry.id === matchedEntryId;
          const anchor = {
            id: libraryItemAnchor(libraryEntryItemId(entry)),
            ...(matched
              ? {
                  ref: (node: HTMLElement | null) => {
                    matchRef.current = node;
                  },
                  tabIndex: -1,
                }
              : {}),
          };
          if (entry.kind !== "message")
            return (
              <div key={entry.id} {...anchor} className={cn(matched && MATCHED_ITEM)}>
                <LibrarySavedActivity entry={entry} expanded={matched} />
              </div>
            );
          const message = entry.message;
          return (
            <article
              key={entry.id}
              {...anchor}
              className={cn("space-y-3 py-5", matched && MATCHED_ITEM)}
            >
              <h2 className="text-xs font-semibold text-muted-foreground">
                {message.role === "user"
                  ? "You"
                  : message.role === "assistant"
                    ? "Agent"
                    : "Project context"}
              </h2>
              <ChatMarkdown text={message.text} cwd={undefined} />
              {authority.authorityId && (message.attachments?.length ?? 0) ? (
                <div className="flex flex-wrap gap-3">
                  {message.attachments?.map((attachment) => (
                    <LibraryAttachment
                      key={attachment.id}
                      authorityId={authority.authorityId!}
                      sourceEnvironmentId={archive.summary.environmentId}
                      attachment={attachment}
                    />
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      {timeline.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This page has no displayed messages or activity. Use Earlier history to keep reading, or
          open the live conversation.
        </p>
      ) : null}
      {continuing && library.project.data ? (
        <NewConversationDialog
          project={library.project.data}
          copies={library.copies.data ?? []}
          copiesQuery={library.copies}
          continuation={archive.summary}
          onChanged={library.refresh}
          onClose={() => setContinuing(false)}
        />
      ) : null}
    </LibraryPageFrame>
  );
}

/** A search result's item stands out with a still fill, so it is found again after scrolling. */
const MATCHED_ITEM = "-mx-3 rounded-xl bg-accent/50 px-3 outline-none";

/** Saved activity uses the same disclosure rows as live chat, with no execution controls. */
function LibrarySavedActivity({
  entry,
  expanded: initiallyExpanded = false,
}: {
  entry: Exclude<TimelineEntry, { kind: "message" }>;
  /** Opens the row, as for a proposed plan a history search matched. */
  expanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [visibleCharacters, setVisibleCharacters] = useState(12000);
  const item =
    entry.kind === "event"
      ? entry.projectedItem.item
      : entry.kind === "work"
        ? entry.entry.projectedItem?.item
        : undefined;
  const label =
    entry.kind === "work"
      ? entry.entry.label
      : entry.kind === "proposed-plan"
        ? "Proposed plan"
        : entry.kind === "html-render"
          ? "Saved page"
          : entry.kind === "mcp-app"
            ? "Saved app"
            : (item?.title ?? item?.type.replaceAll("_", " ") ?? "Agent activity");
  let call = "";
  if (expanded && item && (item.type === "command_execution" || item.type === "dynamic_tool")) {
    const input = toolCallLines(
      item.type === "command_execution" ? { command: item.input } : { args: item.input },
    );
    call =
      input.command ??
      input.argsText ??
      input.args?.map(([key, value]) => `${key}: ${value}`).join("\n") ??
      "";
  }
  const detail = !expanded
    ? ""
    : entry.kind === "proposed-plan"
      ? entry.proposedPlan.planMarkdown
      : item?.type === "reasoning"
        ? item.text
        : item
          ? (turnItemOutputText(item) ?? "")
          : "";
  const status = item?.status;
  return (
    <div className="py-2">
      <WorkLogBlock>
        <WorkLogButton
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          icon={
            expanded ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            )
          }
          label={label}
          trailing={
            status ? (
              <span className="text-xs text-muted-foreground">
                {status === "running" || status === "waiting" ? `${status} when saved` : status}
              </span>
            ) : null
          }
        />
        {expanded ? (
          <WorkLogDetails>
            {call ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                {call.slice(0, visibleCharacters)}
              </pre>
            ) : null}
            {detail ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                {detail.slice(0, visibleCharacters)}
              </pre>
            ) : (
              <p className="text-xs text-muted-foreground">
                No additional text was captured for this activity.
              </p>
            )}
            {Math.max(call.length, detail.length) > visibleCharacters ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() => setVisibleCharacters((value) => value + 12000)}
              >
                Show more
              </Button>
            ) : null}
          </WorkLogDetails>
        ) : null}
      </WorkLogBlock>
    </div>
  );
}
