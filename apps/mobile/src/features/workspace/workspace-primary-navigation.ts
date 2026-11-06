type Route = { readonly name: string; readonly params?: object };

export type WorkspaceRegularTab = "threads" | "sites";
export type WorkspacePrimaryTab = WorkspaceRegularTab | "search";

function homeParams(routes: readonly Route[]) {
  return routes.find((route) => route.name === "Home")?.params;
}

export function workspacePrimaryTab(routes: readonly Route[]): WorkspacePrimaryTab {
  const params = homeParams(routes);
  const tab = params && "workspaceTab" in params ? params.workspaceTab : undefined;
  if (tab === "sites" || tab === "results") return "sites";
  return tab === "search" ? "search" : "threads";
}

export function workspaceSearchReturnTab(routes: readonly Route[]): WorkspaceRegularTab {
  const tab = workspacePrimaryTab(routes);
  if (tab !== "search") return tab;
  const params = homeParams(routes);
  const previous = params && "searchReturnTab" in params ? params.searchReturnTab : undefined;
  return previous === "sites" || previous === "results" ? "sites" : "threads";
}

export function withWorkspacePrimaryTab<R extends Route>(
  route: R,
  tab: WorkspacePrimaryTab,
  searchReturnTab = workspaceSearchReturnTab([route]),
) {
  const params = route.params;
  if (
    params &&
    "workspaceTab" in params &&
    params.workspaceTab === tab &&
    (tab !== "search" ||
      ("searchReturnTab" in params && params.searchReturnTab === searchReturnTab))
  )
    return route;
  return {
    ...route,
    params: {
      ...params,
      workspaceTab: tab,
      ...(tab === "search" ? { searchReturnTab } : {}),
    },
  };
}
