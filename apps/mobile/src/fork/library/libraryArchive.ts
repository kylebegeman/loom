import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import type { LibraryReplicationStatus, LibraryThreadSummary } from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import {
  buildThreadFeed,
  type ThreadFeedActivity,
  type ThreadFeedEntry,
} from "../../lib/threadActivity";

export type LibraryArchiveRow =
  | Extract<ThreadFeedEntry, { type: "message" | "html-render" | "mcp-app" }>
  | { readonly type: "activity"; readonly id: string; readonly activity: ThreadFeedActivity };

/** Preserve the visible sequence, hydrating detail only from the captured archive. */
export function libraryArchiveRows(
  projection: Pick<
    OrchestrationV2ThreadProjection,
    "turnItems" | "visibleTurnItems" | "attempts" | "nodes" | "messages"
  >,
): LibraryArchiveRow[] {
  const fullItems = new Map(projection.turnItems.map((item) => [item.id, item]));
  const visible = projection.visibleTurnItems.map((row) => {
    const full = fullItems.get(row.sourceItemId);
    return full && full.threadId === row.sourceThreadId ? { ...row, item: full } : row;
  });
  return buildThreadFeed(visible, {
    attempts: projection.attempts,
    nodes: projection.nodes,
    anchoredMessages: projection.messages.map((message) => ({
      ...message,
      createdAt: DateTime.formatIso(message.createdAt),
      updatedAt: DateTime.formatIso(message.updatedAt),
    })),
  }).flatMap((entry): LibraryArchiveRow[] => {
    if (entry.type === "activity-group")
      return entry.activities.map((activity) => ({ type: "activity", id: activity.id, activity }));
    return entry.type === "message" || entry.type === "html-render" || entry.type === "mcp-app"
      ? [entry]
      : [];
  });
}

/**
 * The saved history item a row shows, as history search names it: the turn item's id, or the
 * message's own id in archives saved before turn items.
 */
export function libraryArchiveRowItemId(row: LibraryArchiveRow): string {
  switch (row.type) {
    case "message":
      return row.message.projectedItem?.item.id ?? row.message.id;
    case "activity":
      return row.activity.projectedItem.item.id;
    case "mcp-app":
      return row.itemId;
    case "html-render":
      // The feed names a saved page `html-render:<visibility>:<thread>:<item>` and keeps no item.
      return row.id.split(":").slice(3).join(":");
  }
}

export function libraryHistoryFreshness(
  summary: LibraryThreadSummary,
  sourceConnected: boolean,
  status: LibraryReplicationStatus | null,
) {
  if (!sourceConnected)
    return {
      state: "offline",
      detail:
        "The original computer is offline. This is its last saved history; newer work may still be on that computer.",
    } as const;
  if (!status)
    return {
      state: "checking",
      detail: "Checking for work waiting to upload from the original computer…",
    } as const;
  if (!status.enabled)
    return {
      state: "disabled",
      detail: "Automatic history upload is not configured on the original computer.",
    } as const;
  const thread = status.threads.find((value) => value.threadId === summary.threadId);
  if (!thread)
    return {
      state: "unknown",
      detail: "The original computer has no upload receipt for this saved conversation.",
    } as const;
  if (thread.acknowledgedSequence > summary.sequence)
    return {
      state: "reload",
      detail: "Newer history has reached the library. Reload this saved conversation.",
    } as const;
  if (thread.currentSequence > summary.sequence)
    return {
      state: "pending",
      detail: "Newer work is waiting to upload from the original computer.",
    } as const;
  if (thread.pending || thread.acknowledgedSequence < summary.sequence)
    return {
      state: "pending",
      detail: "The original computer is waiting for the library to confirm its history upload.",
    } as const;
  return {
    state: "saved",
    detail: "Saved history matches the latest known work on the original computer.",
  } as const;
}
