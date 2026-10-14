import type { ProjectHomeSectionId, ProjectHomeThreadRow } from "./project-home.ts";
import type { ProjectNavigationThread } from "./project-navigation.ts";

export type ProjectConversationView = "open" | "snoozed" | "history" | "all";
export const PROJECT_CONVERSATION_VIEWS = [
  { id: "open", label: "Open" },
  { id: "snoozed", label: "Snoozed" },
  { id: "history", label: "History" },
  { id: "all", label: "All" },
] as const;

export interface ProjectConversationSection<TThread extends ProjectNavigationThread> {
  readonly id: ProjectHomeSectionId;
  readonly title: string;
  readonly rows: readonly ProjectHomeThreadRow<TThread>[];
}

function conversationView(activity: ProjectHomeThreadRow<ProjectNavigationThread>["activity"]) {
  return activity === "settled" ? "history" : activity === "snoozed" ? "snoozed" : "open";
}

/** View filters retain cached rows; global title search never hides history behind a view. */
export function selectProjectHomeConversations<TThread extends ProjectNavigationThread>(input: {
  readonly sections: readonly ProjectConversationSection<TThread>[];
  readonly view: ProjectConversationView | null;
  readonly query?: string;
}) {
  const counts = { open: 0, snoozed: 0, history: 0, all: 0 };
  for (const section of input.sections) {
    for (const row of section.rows) {
      counts[conversationView(row.activity)]++;
      counts.all++;
    }
  }
  const view =
    input.view ??
    (counts.open > 0
      ? "open"
      : counts.history > 0
        ? "history"
        : counts.snoozed > 0
          ? "snoozed"
          : "open");
  const query = input.query?.trim().toLocaleLowerCase() ?? "";
  const searching = query.length > 0;
  const sections = input.sections.map((section) => ({
    ...section,
    rows: section.rows.filter((row) =>
      searching
        ? row.thread.title.toLocaleLowerCase().includes(query)
        : view === "all" || conversationView(row.activity) === view,
    ),
  }));
  const matchingCount = sections.reduce((count, section) => count + section.rows.length, 0);
  return { sections, counts, view, searching, matchingCount };
}
