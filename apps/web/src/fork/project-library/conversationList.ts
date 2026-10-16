import type { EnvironmentId } from "@t3tools/contracts";
import type { LibraryProject, LibraryThreadSummary } from "@t3tools/contracts/fork";
import type { ProjectThreadActivity } from "~/fork/project-navigation/activity";
import type { ProjectSort } from "./projectList";

export const UNTITLED_CONVERSATION = "Untitled conversation";

/** Active is everything still in play, the same split the sidebar makes. */
export const CONVERSATION_LANES = ["active", "settled", "archived"] as const;
export type ConversationLane = (typeof CONVERSATION_LANES)[number];
export const CONVERSATION_LANE_LABELS: Record<ConversationLane, string> = {
  active: "Active",
  settled: "Settled",
  archived: "Archived",
};

/** What a connected computer reports right now about one of its threads. */
export type LiveConversation = {
  readonly archived: boolean;
  readonly activity: ProjectThreadActivity;
};

export type ConversationStatus = {
  readonly lane: ConversationLane;
  /** Null when there's nothing worth flagging, or nothing current to go on. */
  readonly activity: ProjectThreadActivity | null;
};

/**
 * A connected computer knows the live state, so it wins. Otherwise the Library's saved copy says
 * where the conversation was filed. A run that was in flight when the copy was saved is no
 * longer known to be running, so only a failure or a settle carries over.
 */
export function conversationStatus(
  thread: LibraryThreadSummary,
  live: LiveConversation | null,
): ConversationStatus {
  if (live)
    return {
      lane: live.archived ? "archived" : live.activity === "settled" ? "settled" : "active",
      activity: live.activity,
    };
  return {
    lane: thread.archived ? "archived" : thread.settled ? "settled" : "active",
    activity: thread.status === "failed" ? "failed" : thread.settled ? "settled" : null,
  };
}

export type ConversationFilter = {
  readonly search: string;
  readonly computer: EnvironmentId | null;
  readonly resourceId: string | null;
};

export const conversationTitle = (thread: LibraryThreadSummary) =>
  thread.title || UNTITLED_CONVERSATION;

/** Search reads what each row shows: its title, the computer it ran on and the repository it was about. */
export function filterConversations(
  threads: readonly LibraryThreadSummary[],
  project: LibraryProject,
  filter: ConversationFilter,
  computerLabel: (id: EnvironmentId) => string,
) {
  const search = filter.search.trim().toLocaleLowerCase();
  return threads.filter((thread) => {
    if (filter.computer && thread.environmentId !== filter.computer) return false;
    if (filter.resourceId && !thread.resourceIds.includes(filter.resourceId)) return false;
    if (!search) return true;
    return [
      conversationTitle(thread),
      computerLabel(thread.environmentId),
      ...project.resources
        .filter((resource) => thread.resourceIds.includes(resource.id))
        .map((resource) => resource.title),
    ].some((text) => text.toLocaleLowerCase().includes(search));
  });
}

/** The same three orders the projects page offers, so both lists sort the same way. */
export function sortConversations(threads: readonly LibraryThreadSummary[], sort: ProjectSort) {
  const compare = {
    activity: (a: LibraryThreadSummary, b: LibraryThreadSummary) =>
      b.updatedAt.localeCompare(a.updatedAt),
    name: (a: LibraryThreadSummary, b: LibraryThreadSummary) =>
      conversationTitle(a).localeCompare(conversationTitle(b), undefined, { sensitivity: "base" }),
    created: (a: LibraryThreadSummary, b: LibraryThreadSummary) =>
      b.createdAt.localeCompare(a.createdAt),
  }[sort];
  return threads.toSorted(compare);
}
