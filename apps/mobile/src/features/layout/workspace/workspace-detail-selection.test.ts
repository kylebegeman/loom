import * as NodeModule from "node:module";
import { describe, expect, it } from "vite-plus/test";
import {
  selectWorkspaceDetail,
  setNativelyPoppingWorkspaceRoute,
  shouldPreserveWorkspaceDetailOrigin,
  workspaceDetailLinkAction,
  workspaceDetailRouter,
  type WorkspaceDetail,
} from "./workspace-detail-selection";
import { workspacePrimaryTab, workspaceSearchReturnTab } from "./workspace-primary-navigation";

const require = NodeModule.createRequire(import.meta.url);
const requireFromNative = NodeModule.createRequire(
  require.resolve("@react-navigation/native/package.json"),
);
const requireFromCore = NodeModule.createRequire(
  requireFromNative.resolve("@react-navigation/core/package.json"),
);
const { StackActions, StackRouter } = requireFromCore("@react-navigation/routers") as {
  readonly StackActions: typeof import("@react-navigation/native").StackActions;
  readonly StackRouter: typeof import("@react-navigation/native").StackRouter;
};

const base = StackRouter({});
const router = { ...base, ...workspaceDetailRouter(base) };
const primaryRouter = { ...base, ...workspaceDetailRouter(base, { primaryTabs: true }) };
const options = {
  routeNames: [
    "Home",
    "Thread",
    "ThreadFiles",
    "PullRequest",
    "PullRequests",
    "PullRequestReviewers",
    "Settings",
    "SettingsAppearance",
    "GitOverview",
    "Library",
    "LibraryProject",
    "ProjectHome",
  ],
  routeParamList: {},
  routeGetIdList: {},
};
type State = ReturnType<typeof base.getInitialState>;
type RouterAction = Parameters<typeof base.getStateForAction>[1];

const threadA = { name: "Thread", params: { environmentId: "env", threadId: "a" } } as const;
const threadB = { name: "Thread", params: { environmentId: "env", threadId: "b" } } as const;
const pullRequest = {
  name: "PullRequest",
  params: { environmentId: "env", projectId: "p", repository: "o/r", number: 1, host: "h" },
} as const;

function apply(
  state: State,
  action: Parameters<typeof base.getStateForAction>[1],
  primaryTabs = false,
) {
  const next = (primaryTabs ? primaryRouter : router).getStateForAction(state, action, options);
  if (!next) throw new Error(`Router rejected ${action.type}`);
  // React Navigation rehydrates every state a router returns, as a stale RESET needs.
  return base.getRehydratedState(next as State, options);
}

function select(
  state: State,
  detail: WorkspaceDetail,
  sheet?: Parameters<typeof selectWorkspaceDetail>[1],
  options?: Parameters<typeof selectWorkspaceDetail>[2],
) {
  return apply(state, selectWorkspaceDetail(detail, sheet, options) as unknown as RouterAction);
}

function push(state: State, name: string, params?: object) {
  return apply(state, StackActions.push(name, params));
}

const home = () => base.getInitialState(options);
const page = (state: State) => ({
  names: state.routes.map((route) => route.name),
  index: state.index,
});

describe("selectWorkspaceDetail", () => {
  it("swaps the open thread in place instead of pushing another", () => {
    const first = select(home(), threadA);
    const second = select(first, threadB);
    expect(page(second)).toEqual({ names: ["Home", "Thread"], index: 1 });
    expect(second.routes[1]?.key).toBe(first.routes[1]?.key);
    expect(second.routes[1]?.params).toEqual(threadB.params);
  });

  it.each([
    ["a page drilled into from the thread", (state: State) => push(state, "ThreadFiles")],
    ["a linked thread", (state: State) => push(state, "Thread", threadB.params)],
    ["a pull request opened from the thread", (state: State) => push(state, "PullRequest")],
    ["a sheet", (state: State) => push(state, "GitOverview")],
  ])("leaves only the selection when %s is on top", (_, drillIn) => {
    const thread = select(home(), threadA);
    const selected = select(drillIn(thread), threadA);
    expect(page(selected)).toEqual({ names: ["Home", "Thread"], index: 1 });
    expect(selected.routes[1]?.key).toBe(thread.routes[1]?.key);
  });

  it("replaces another tab's page and Settings with the selection", () => {
    const settings = push(push(select(home(), threadA), "Settings"), "SettingsAppearance");
    const selected = select(settings, pullRequest);
    expect(page(selected)).toEqual({ names: ["Home", "PullRequest"], index: 1 });
    expect(selected.routes[0]?.key).toBe(settings.routes[0]?.key);
  });

  it("puts Home under a cold-linked page and a sheet over the selection", () => {
    const cold = apply(home(), { type: "RESET", payload: { index: 0, routes: [pullRequest] } });
    const selected = select(cold, pullRequest, {
      name: "PullRequestReviewers",
      params: pullRequest.params,
    });
    expect(page(selected)).toEqual({
      names: ["Home", "PullRequest", "PullRequestReviewers"],
      index: 2,
    });
  });

  it("never reuses the page native Back is popping", () => {
    const thread = select(home(), threadA);
    setNativelyPoppingWorkspaceRoute(thread.routes[1]!.key);
    try {
      const selected = select(thread, threadA);
      expect(page(selected)).toEqual({ names: ["Home", "Thread"], index: 1 });
      expect(selected.routes[1]?.key).not.toBe(thread.routes[1]?.key);
    } finally {
      setNativelyPoppingWorkspaceRoute(null);
    }
  });

  it("keeps a project's route chain when selecting its conversation", () => {
    const project = push(push(home(), "Library"), "LibraryProject", { projectId: "project" });
    const first = select(project, threadA, undefined, { preserveOrigin: true });
    expect(page(first)).toEqual({
      names: ["Home", "Library", "LibraryProject", "Thread"],
      index: 3,
    });
    expect(first.routes.slice(0, 3)).toEqual(project.routes);
    const second = select(push(first, "ThreadFiles"), threadB, undefined, { preserveOrigin: true });
    expect(page(second)).toEqual({
      names: ["Home", "Library", "LibraryProject", "Thread"],
      index: 3,
    });
    expect(second.routes[3]?.key).toBe(first.routes[3]?.key);
    expect(page(apply(second, StackActions.pop()))).toEqual({
      names: ["Home", "Library", "LibraryProject"],
      index: 2,
    });
    const coldProject = apply(home(), {
      type: "RESET",
      payload: { index: 0, routes: [{ name: "ProjectHome", params: { projectId: "p" } }] },
    });
    expect(page(select(coldProject, threadA, undefined, { preserveOrigin: true }))).toEqual({
      names: ["Home", "ProjectHome", "Thread"],
      index: 2,
    });
  });

  it("keeps root selection and deep links independent of a contextual detail", () => {
    const project = push(home(), "ProjectHome", { environmentId: "env", projectId: "p" });
    const contextual = select(project, threadA, undefined, { preserveOrigin: true });
    expect(page(select(contextual, threadB))).toEqual({ names: ["Home", "Thread"], index: 1 });
    const selected = apply(
      contextual,
      workspaceDetailLinkAction({ routes: [threadB] }) as unknown as RouterAction,
    );
    expect(page(selected)).toEqual({ names: ["Home", "Thread"], index: 1 });
  });

  it("returns to a project opened over an existing chat without reusing that chat's key", () => {
    const existing = select(home(), threadA);
    const project = push(push(existing, "Library"), "LibraryProject", { projectId: "p" });
    expect(shouldPreserveWorkspaceDetailOrigin("ios", project.routes)).toBe(true);
    const opened = select(project, threadB, undefined, { preserveOrigin: true });
    expect(page(opened)).toEqual({
      names: ["Home", "Thread", "Library", "LibraryProject", "Thread"],
      index: 4,
    });
    expect(opened.routes[1]?.key).toBe(existing.routes[1]?.key);
    expect(opened.routes[4]?.key).not.toBe(existing.routes[1]?.key);
    const replaced = select(push(opened, "ThreadFiles"), threadA, undefined, {
      preserveOrigin: true,
    });
    expect(page(replaced)).toEqual(page(opened));
    expect(replaced.routes[4]?.key).toBe(opened.routes[4]?.key);
    expect(page(apply(replaced, StackActions.pop()))).toEqual(page(project));
  });

  it("returns to a pull request list opened over an existing chat", () => {
    const list = push(select(home(), threadA), "PullRequests");
    const opened = select(list, pullRequest, undefined, { preserveOrigin: true });
    expect(page(opened)).toEqual({
      names: ["Home", "Thread", "PullRequests", "PullRequest"],
      index: 3,
    });
    expect(page(apply(opened, StackActions.pop()))).toEqual(page(list));
  });

  it.each(["sites", "search"] as const)(
    "keeps contextual %s selections there, but opens external links in Threads",
    (tab) => {
      const results = apply(home(), {
        type: "RESET",
        payload: {
          index: 0,
          routes: [{ name: "Home", params: { workspaceTab: tab, searchReturnTab: "sites" } }],
        },
      });
      expect(shouldPreserveWorkspaceDetailOrigin("ios", results.routes)).toBe(true);
      expect(shouldPreserveWorkspaceDetailOrigin("android", results.routes)).toBe(false);
      expect(shouldPreserveWorkspaceDetailOrigin("ios", home().routes)).toBe(false);
      const contextual = apply(
        results,
        selectWorkspaceDetail(threadA, undefined, {
          preserveOrigin: true,
        }) as unknown as RouterAction,
        true,
      );
      expect(workspacePrimaryTab(contextual.routes)).toBe(tab);
      const returned = apply(contextual, StackActions.pop());
      expect(workspacePrimaryTab(returned.routes)).toBe(tab);
      expect(workspaceSearchReturnTab(returned.routes)).toBe("sites");
      const linked = apply(
        contextual,
        workspaceDetailLinkAction({ routes: [threadB] }) as unknown as RouterAction,
        true,
      );
      expect(workspacePrimaryTab(linked.routes)).toBe("threads");
      expect(linked.routes[0]?.key).toBe(results.routes[0]?.key);
      expect(workspacePrimaryTab([])).toBe("threads");
    },
  );
});

describe("workspaceDetailLinkAction", () => {
  it("selects a linked thread or pull request, and leaves other links alone", () => {
    expect(workspaceDetailLinkAction({ routes: [{ name: "Home" }, threadA] })).toEqual(
      selectWorkspaceDetail(threadA),
    );
    expect(workspaceDetailLinkAction({ routes: [pullRequest] })).toEqual(
      selectWorkspaceDetail(pullRequest),
    );
    expect(
      workspaceDetailLinkAction({
        routes: [{ name: "Home" }, { name: "Settings" }, { name: "SettingsAppearance" }],
      }),
    ).toBeUndefined();
  });
});
