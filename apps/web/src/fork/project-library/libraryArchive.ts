import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { deriveTimelineEntriesFromVisibleTurnItems, type TimelineEntry } from "~/session-logic";
import type { ChatMessage } from "~/types";

/** Read the captured visible conversation, including the parent's history in a fork. */
export function libraryArchiveTimeline(
  projection: Pick<OrchestrationV2ThreadProjection, "messages" | "visibleTurnItems" | "turnItems">,
): readonly TimelineEntry[] {
  if (projection.visibleTurnItems.length === 0) {
    return projection.messages.map(
      ({ scheduledTaskId, senderThreadId, idleCompaction, ...message }) => ({
        id: message.id,
        kind: "message" as const,
        createdAt: DateTime.formatIso(message.createdAt),
        message: {
          ...message,
          ...(scheduledTaskId === undefined ? {} : { scheduledTaskId }),
          ...(senderThreadId === undefined ? {} : { senderThreadId }),
          ...(idleCompaction === undefined ? {} : { idleCompaction }),
          createdAt: DateTime.formatIso(message.createdAt),
          updatedAt: DateTime.formatIso(message.updatedAt),
        },
      }),
    );
  }
  const fullItems = new Map(projection.turnItems.map((item) => [item.id, item]));
  const visibleTurnItems = projection.visibleTurnItems.map((row) => {
    const full = fullItems.get(row.sourceItemId);
    return full && full.threadId === row.sourceThreadId ? { ...row, item: full } : row;
  });
  return deriveTimelineEntriesFromVisibleTurnItems({
    visibleTurnItems,
    optimisticMessages: [],
  });
}

export function libraryArchiveMessages(
  projection: Pick<OrchestrationV2ThreadProjection, "messages" | "visibleTurnItems" | "turnItems">,
): readonly ChatMessage[] {
  return libraryArchiveTimeline(projection).flatMap((entry) =>
    entry.kind === "message" ? [entry.message] : [],
  );
}

/**
 * The saved history item an entry shows, as history search names it: the turn item's id, or the
 * message's own id in archives saved before turn items.
 */
export function libraryEntryItemId(entry: TimelineEntry): string {
  switch (entry.kind) {
    case "message":
      return entry.projectedItem?.item.id ?? entry.id;
    case "event":
      return entry.projectedItem.item.id;
    case "work":
      return entry.entry.projectedItem?.item.id ?? entry.id;
    default:
      return entry.id;
  }
}
