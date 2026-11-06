import type {
  NavigationAction,
  ParamListBase,
  PartialState,
  NavigationState,
  Router,
  StackNavigationState,
} from "@react-navigation/native";
import { workspaceRoutesOf } from "../layout/workspace-overlay-routes";
import { withWorkspacePrimaryTab, workspacePrimaryTab } from "./workspace-primary-navigation";

type RootParams = ReactNavigation.RootParamList;

/** A page the workspace's detail column shows on its own: what a list row selects. */
export type WorkspaceDetail =
  | { readonly name: "Thread"; readonly params: RootParams["Thread"] }
  | { readonly name: "PullRequest"; readonly params: RootParams["PullRequest"] };

/** Android opens the reviewers sheet over the pull request in the same step. */
export type WorkspaceDetailSheet = {
  readonly name: "PullRequestReviewers";
  readonly params: RootParams["PullRequestReviewers"];
};

const SELECT_WORKSPACE_DETAIL = "SELECT_WORKSPACE_DETAIL";

export interface SelectWorkspaceDetailAction {
  readonly type: typeof SELECT_WORKSPACE_DETAIL;
  readonly payload: {
    readonly detail: WorkspaceDetail;
    readonly sheet?: WorkspaceDetailSheet;
    readonly preserveOrigin?: boolean;
  };
}

/** Selects a detail in place, optionally retaining its originating project's return path. */
export function selectWorkspaceDetail(
  detail: WorkspaceDetail,
  sheet?: WorkspaceDetailSheet,
  options?: { readonly preserveOrigin?: boolean },
): SelectWorkspaceDetailAction {
  return {
    type: SELECT_WORKSPACE_DETAIL,
    payload: {
      detail,
      ...(sheet ? { sheet } : {}),
      ...(options?.preserveOrigin ? { preserveOrigin: true } : {}),
    },
  };
}

const IDENTITY = {
  Thread: ["environmentId", "threadId"],
  PullRequest: ["environmentId", "projectId", "repository", "number", "host"],
} as const;

type RouteLike = { readonly name: string; readonly key?: string; readonly params?: object };

function detailOrigin(routes: readonly RouteLike[]) {
  const lastContext = routes.findLastIndex(
    ({ name }) =>
      name === "PullRequests" ||
      !(
        name.startsWith("Thread") ||
        name.startsWith("PullRequest") ||
        name.startsWith("Settings") ||
        name.startsWith("Git")
      ),
  );
  return routes.slice(0, lastContext + 1);
}

function hasWorkspaceDetailOrigin(routes: readonly RouteLike[]) {
  return detailOrigin(routes).some((route) => route.name !== "Home");
}

// fork: mobile-navigation
export function shouldPreserveWorkspaceDetailOrigin(
  platform: string,
  routes: readonly RouteLike[],
) {
  return (
    platform === "ios" &&
    (workspacePrimaryTab(routes) !== "threads" || hasWorkspaceDetailOrigin(routes))
  );
}

function showsDetail(route: RouteLike, detail: WorkspaceDetail) {
  if (route.name !== detail.name) return false;
  const current = route.params as Readonly<Record<string, unknown>> | undefined;
  const target = detail.params as Readonly<Record<string, unknown>> | undefined;
  return IDENTITY[detail.name].every((key) => current?.[key] === target?.[key]);
}

// UIKit pops a card by native Back before the router hears of it, so a row tapped meanwhile
// must not reuse the card on its way out.
let nativelyPoppingRoute: string | null = null;

export function setNativelyPoppingWorkspaceRoute(key: string | null) {
  nativelyPoppingRoute = key;
}

/** Reuses the detail controller and retains the origin only for a contextual selection. */
function workspaceDetailState<
  State extends { readonly index: number; readonly routes: readonly RouteLike[] },
>(
  state: State,
  detail: WorkspaceDetail,
  sheet?: WorkspaceDetailSheet,
  popping?: string | null,
  preserveOrigin = false,
  primaryTabs = false,
) {
  const { workspace } = workspaceRoutesOf(state.routes.slice(0, state.index + 1));
  const leaving = workspace.findIndex((route) => route.key !== undefined && route.key === popping);
  const live = leaving < 0 ? workspace : workspace.slice(0, leaving);
  const existingHome = live.find((route) => route.name === "Home") ?? { name: "Home" };
  const home = primaryTabs
    ? withWorkspacePrimaryTab(existingHome, preserveOrigin ? workspacePrimaryTab(live) : "threads")
    : existingHome;
  const origin = preserveOrigin ? detailOrigin(live) : [];
  const prefix = origin.some((route) => route.name === "Home")
    ? origin.map((route) => (route.name === "Home" ? home : route))
    : [home, ...origin];
  const replacing = preserveOrigin ? live.slice(origin.length) : live;
  const page = replacing.find((route) => route.name === detail.name);
  const reused =
    replacing.findLast((route) => showsDetail(route, detail)) ??
    (page?.name === detail.name ? page : undefined);
  const routes = [
    ...prefix,
    reused ? { ...reused, params: detail.params } : { name: detail.name, params: detail.params },
    ...(sheet ? [sheet] : []),
  ];
  return { ...state, index: routes.length - 1, routes };
}

/** Root stack router overrides that handle `selectWorkspaceDetail`. */
export function workspaceDetailRouter<Action extends NavigationAction>(
  original: Router<StackNavigationState<ParamListBase>, Action>,
  configuration?: { readonly primaryTabs?: boolean },
): Partial<Router<StackNavigationState<ParamListBase>, Action>> {
  return {
    getStateForAction(state, action, options) {
      if (action.type !== SELECT_WORKSPACE_DETAIL) {
        return original.getStateForAction(state, action, options);
      }
      const { detail, sheet, preserveOrigin } = (action as unknown as SelectWorkspaceDetailAction)
        .payload;
      const next = workspaceDetailState(
        state,
        detail,
        sheet,
        nativelyPoppingRoute,
        preserveOrigin,
        configuration?.primaryTabs,
      );
      const reset = { type: "RESET", payload: { ...next, stale: false } };
      return original.getStateForAction(state, reset as unknown as Action, options);
    },
  };
}

/** A link to a single thread or pull request selects it, like its list row would. */
export function workspaceDetailLinkAction(
  state: PartialState<NavigationState> | NavigationState,
): SelectWorkspaceDetailAction | undefined {
  const pages = state.routes.filter((route) => route.name !== "Home");
  const [page] = pages;
  if (pages.length !== 1 || !page || page.state) return undefined;
  if (page.name !== "Thread" && page.name !== "PullRequest") return undefined;
  return selectWorkspaceDetail({ name: page.name, params: page.params } as WorkspaceDetail);
}
