import type { LibraryThreadSummary } from "@t3tools/contracts/fork";
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { deriveTimelineEntriesFromVisibleTurnItems, type TimelineEntry } from "~/session-logic";
import type { ChatMessage } from "~/types";

/** Read the captured visible conversation, including the parent's history in a fork. */
export function libraryArchiveTimeline(
  projection: Pick<OrchestrationV2ThreadProjection, "messages" | "visibleTurnItems" | "turnItems">,
): readonly TimelineEntry[] {
  if (projection.visibleTurnItems.length === 0) {
    return projection.messages.map(({ scheduledTaskId, senderThreadId, ...message }) => ({
      id: message.id,
      kind: "message" as const,
      createdAt: DateTime.formatIso(message.createdAt),
      message: {
        ...message,
        ...(scheduledTaskId === undefined ? {} : { scheduledTaskId }),
        ...(senderThreadId === undefined ? {} : { senderThreadId }),
        createdAt: DateTime.formatIso(message.createdAt),
        updatedAt: DateTime.formatIso(message.updatedAt),
      },
    }));
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

/** Cheap summary updates reload only the conversation currently being read. */
export function shouldRefreshLibraryArchive(
  archive: Pick<LibraryThreadSummary, "id" | "sequence"> | null,
  listed: Pick<LibraryThreadSummary, "id" | "sequence"> | undefined,
) {
  return archive !== null && listed?.id === archive.id && listed.sequence > archive.sequence;
}
