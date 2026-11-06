import { describe, expect, it } from "vite-plus/test";

import { restoreSettingsLinkState, settingsNavigationState } from "../settings/settings-navigation";
import {
  workspaceSelectionsIn,
  workspaceTabColumns,
  workspaceTabNavigationState,
} from "./workspace-tab-navigation";
import { workspacePrimaryTab } from "./workspace-primary-navigation";

const home = { key: "home", name: "Home" };
const thread = {
  key: "thread",
  name: "Thread",
  params: { environmentId: "env", threadId: "thread-a" },
};
const pullRequest = {
  key: "pr",
  name: "PullRequest",
  params: { environmentId: "env", projectId: "project", repository: "o/r", number: 7 },
};
const settings = { key: "settings", name: "Settings" };
const available = { thread: () => true, pullRequest: () => true };
const names = (state: { routes: readonly { name: string }[] }) =>
  state.routes.map((route) => route.name);

describe("workspace tab selections", () => {
  it("remembers the chat, pull request and Settings page each tab showed", () => {
    const afterThread = workspaceSelectionsIn([home, thread], {});
    const afterPullRequest = workspaceSelectionsIn([home, pullRequest], afterThread);
    expect(afterPullRequest).toMatchObject({
      threads: thread.params,
      pullRequests: pullRequest.params,
    });
    const afterSettings = workspaceSelectionsIn(
      [home, settings, { key: "appearance", name: "SettingsAppearance" }],
      afterPullRequest,
    );
    expect(afterSettings.settings).toBe("SettingsAppearance");
    expect(workspaceSelectionsIn([home, thread], afterSettings)).toBe(afterSettings);
  });

  it("doesn't remember pages a Settings row doesn't open", () => {
    for (const name of ["SettingsEnvironmentNew", "SettingsProjectOverview", "SettingsAuth"]) {
      expect(workspaceSelectionsIn([home, settings, { key: name, name }], {}).settings).toBe(
        undefined,
      );
    }
  });
});

describe("opening a workspace tab", () => {
  const columns = { columns: true, check: available };

  it("opens Android Settings beside its default page only in a wide window", () => {
    const open = (wide: boolean) =>
      workspaceTabNavigationState(
        { routes: [home, thread] },
        "settings",
        {},
        {
          columns: workspaceTabColumns("android", "settings", wide),
          check: available,
        },
      );
    expect(names(open(false))).toEqual(["Home", "Settings"]);
    expect(names(open(true))).toEqual(["Home", "Settings", "SettingsEnvironments"]);
  });

  it("keeps Android list tabs and iOS remembered-detail navigation unchanged", () => {
    const open = (platform: string) =>
      workspaceTabNavigationState(
        { routes: [home, thread] },
        "threads",
        { threads: thread.params },
        {
          columns: workspaceTabColumns(platform, "threads", true),
          check: available,
        },
      );
    expect(names(open("android"))).toEqual(["Home"]);
    expect(names(open("ios"))).toEqual(["Home", "Thread"]);
  });

  it("opens the remembered page beside the list with columns, and the list without", () => {
    const state = { routes: [home, thread] };
    const selections = { threads: thread.params, pullRequests: pullRequest.params };
    expect(names(workspaceTabNavigationState(state, "pullRequests", selections, columns))).toEqual([
      "Home",
      "PullRequest",
    ]);
    expect(
      names(
        workspaceTabNavigationState(state, "pullRequests", selections, {
          columns: false,
          check: available,
        }),
      ),
    ).toEqual(["Home"]);
    expect(names(workspaceTabNavigationState(state, "settings", {}, columns))).toEqual([
      "Home",
      "Settings",
      "SettingsEnvironments",
    ]);
  });

  it("keeps the route that is already open, so re-selecting a tab doesn't rebuild it", () => {
    const next = workspaceTabNavigationState(
      { routes: [home, thread] },
      "threads",
      { threads: thread.params },
      columns,
    );
    expect(next.routes.map((route) => route.key)).toEqual(["home", "thread"]);
  });

  it("reopens a tab's page under the key it had, so its kept screen is reused", () => {
    const columnsAvailable = { columns: true, check: available };
    let selections = workspaceSelectionsIn([home, thread], {});
    const away = workspaceTabNavigationState(
      { routes: [home, thread] },
      "pullRequests",
      selections,
      {
        columns: false,
        check: available,
      },
    );
    selections = workspaceSelectionsIn(away.routes, selections);
    const back = workspaceTabNavigationState(away, "threads", selections, columnsAvailable);
    expect(back.routes.at(-1)).toMatchObject({ key: "thread", params: thread.params });
  });

  it("reopens a draft the tab showed after its last chat, until another chat opens", () => {
    const columns = { columns: true, check: available };
    const draft = { key: "draft", name: "Thread", params: { draft: { requestId: "r" } } };
    const withDraft = workspaceSelectionsIn(
      [home, draft],
      workspaceSelectionsIn([home, thread], {}),
    );
    const back = workspaceTabNavigationState(
      { routes: [home, settings] },
      "threads",
      withDraft,
      columns,
    );
    expect(back.routes.at(-1)).toEqual(draft);
    const afterChat = workspaceSelectionsIn([home, thread], withDraft);
    const again = workspaceTabNavigationState(
      { routes: [home, settings] },
      "threads",
      afterChat,
      columns,
    );
    expect(again.routes.at(-1)).toMatchObject({ key: "thread", params: thread.params });
  });

  it("falls back to the list for a chat that no longer exists, or an unknown Settings page", () => {
    const missing = { thread: () => false, pullRequest: () => true };
    expect(
      names(
        workspaceTabNavigationState(
          { routes: [home] },
          "threads",
          { threads: thread.params },
          {
            columns: true,
            check: missing,
          },
        ),
      ),
    ).toEqual(["Home"]);
    expect(
      names(
        workspaceTabNavigationState(
          { routes: [home] },
          "settings",
          { settings: "SettingsGone" },
          columns,
        ),
      ),
    ).toEqual(["Home", "Settings", "SettingsEnvironments"]);
  });

  it("keeps an open sheet on top", () => {
    const sheet = { key: "sheet", name: "ConnectOnboarding" };
    const next = workspaceTabNavigationState(
      { routes: [home] },
      "threads",
      { threads: thread.params },
      {
        ...columns,
        overlays: [sheet],
      },
    );
    expect(names(next)).toEqual(["Home", "Thread", "ConnectOnboarding"]);
    expect(next.index).toBe(2);
  });

  it("restores a tab's full route chain, including its contextual conversation", () => {
    const site = { key: "site", name: "Sites", params: { siteId: "s" } };
    const history = { results: [home, site, thread] };
    const next = workspaceTabNavigationState(
      { routes: [home, pullRequest] },
      "results",
      {},
      { columns: false, check: available, history },
    );
    expect(next.routes).toEqual(history.results);
    expect(next.index).toBe(2);
  });

  it("returns to the surviving parent when a remembered conversation is unavailable", () => {
    const project = { key: "project", name: "ProjectHome", params: { projectId: "p" } };
    const next = workspaceTabNavigationState(
      { routes: [home] },
      "threads",
      {},
      {
        columns: false,
        check: { thread: () => false, pullRequest: () => true },
        history: { threads: [home, project, thread, { key: "files", name: "ThreadFiles" }] },
      },
    );
    expect(next.routes).toEqual([home, project]);
  });

  it("records the destination primary tab without changing the root route key", () => {
    const options = { columns: false, check: available, primaryTabs: true };
    const results = workspaceTabNavigationState({ routes: [home] }, "results", {}, options);
    expect(workspacePrimaryTab(results.routes)).toBe("results");
    expect(results.routes[0]?.key).toBe(home.key);
    const restored = workspaceTabNavigationState(
      results,
      "threads",
      {},
      {
        ...options,
        history: { threads: results.routes },
      },
    );
    expect(workspacePrimaryTab(restored.routes)).toBe("threads");
    expect(restored.routes[0]?.key).toBe(home.key);
  });
});

describe("Settings links", () => {
  it("preserves the originating page when opening and changing a secondary Settings page", () => {
    const state = { routes: [home, thread], index: 1 };
    const opened = settingsNavigationState(state, "SettingsAppearance", undefined, undefined, {
      preserveOrigin: true,
    });
    expect(names(opened)).toEqual(["Home", "Thread", "Settings", "SettingsAppearance"]);
    const next = settingsNavigationState(opened, "SettingsKeyboard", undefined, undefined, {
      preserveOrigin: true,
    });
    expect(names(next)).toEqual(["Home", "Thread", "Settings", "SettingsKeyboard"]);
    expect(next.routes[1]).toBe(thread);
    expect(next.routes[2]).toBe(opened.routes[2]);
  });

  it("puts the Settings list under a linked page, and a page beside a bare link with columns", () => {
    const linked = restoreSettingsLinkState(
      { routes: [{ name: "Home" }, { name: "SettingsKeyboard" }] },
      undefined,
    );
    expect(names(linked!)).toEqual(["Home", "Settings", "SettingsKeyboard"]);
    const bare = { routes: [{ name: "Home" }, { name: "Settings" }] };
    expect(names(restoreSettingsLinkState(bare, "SettingsAppearance")!)).toEqual([
      "Home",
      "Settings",
      "SettingsAppearance",
    ]);
    expect(restoreSettingsLinkState(bare, undefined)).toBe(bare);
  });

  it("opens the sign-in link as a modal over the workspace", () => {
    const state = { routes: [{ name: "Home" }, { name: "SettingsAuth" }] };
    expect(restoreSettingsLinkState(state, "SettingsAppearance")).toBe(state);
  });
});
