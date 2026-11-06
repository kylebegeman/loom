type Route = { readonly name: string; readonly params?: object };

export type WorkspacePrimaryTab = "threads" | "results";

export function workspacePrimaryTab(routes: readonly Route[]): WorkspacePrimaryTab {
  const params = routes.find((route) => route.name === "Home")?.params;
  return params && "workspaceTab" in params && params.workspaceTab === "results"
    ? "results"
    : "threads";
}

export function withWorkspacePrimaryTab<R extends Route>(route: R, tab: WorkspacePrimaryTab) {
  return { ...route, params: { ...route.params, workspaceTab: tab } };
}
