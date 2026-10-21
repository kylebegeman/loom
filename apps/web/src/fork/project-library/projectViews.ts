export const PROJECT_VIEWS = [
  "overview",
  "conversations",
  "timeline",
  "computers",
  "repositories",
  "setup",
] as const;

export type ProjectViewName = (typeof PROJECT_VIEWS)[number];

export const PROJECT_VIEW_LABELS: Record<ProjectViewName, string> = {
  overview: "Overview",
  conversations: "Conversations",
  timeline: "Timeline",
  computers: "Files",
  repositories: "Files",
  setup: "Preferences",
};

export type ProjectViewSearch = { readonly view?: ProjectViewName };

/** Overview is the page itself, so it never appears in the address. */
export function validateProjectViewSearch(raw: Record<string, unknown>): ProjectViewSearch {
  const view = PROJECT_VIEWS.find((entry) => entry === raw.view);
  return view && view !== "overview" ? { view } : {};
}

export const projectViewSearch = (view: ProjectViewName): ProjectViewSearch =>
  view === "overview" ? {} : { view };
