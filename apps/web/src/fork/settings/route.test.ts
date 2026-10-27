import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";
import {
  retainSettingsScope,
  validateSettingsRouteSearch,
} from "~/components/settings/settingsScopeNavigation";
import { redirectLegacyLoomSettings } from "../../routes/_chat.settings.loom";
import { FORK_SETTINGS_SECTIONS } from "./registry";

const HOMES = [...new Set(FORK_SETTINGS_SECTIONS.map((section) => section.home))];

async function follow(initialEntry: string) {
  const root = createRootRoute();
  // Mirrors the app tree, where Settings sits under the pathless chat layout.
  const chat = createRoute({ getParentRoute: () => root, id: "_chat" });
  const settings = createRoute({
    getParentRoute: () => chat,
    path: "settings",
    validateSearch: validateSettingsRouteSearch,
    search: { middlewares: [retainSettingsScope] },
  });
  const loom = createRoute({
    getParentRoute: () => settings,
    path: "loom",
    beforeLoad: redirectLegacyLoomSettings,
  });
  const homes = HOMES.map((home) =>
    createRoute({ getParentRoute: () => settings, path: home.replace("/settings/", "") }),
  );
  const router = createRouter({
    routeTree: root.addChildren([chat.addChildren([settings.addChildren([loom, ...homes])])]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  expect(router.state.redirect).toBeDefined();
  await router.navigate(router.state.redirect!.options);
  const { pathname, search, hash } = router.state.location;
  return { pathname, search, hash };
}

describe("retired Loom settings links", () => {
  it("opens every topic named by section on its new page", async () => {
    for (const section of FORK_SETTINGS_SECTIONS) {
      expect(await follow(`/settings/loom?section=${section.id}`)).toEqual({
        pathname: section.home,
        search: {},
        hash: `loom-${section.id}`,
      });
    }
  });

  it("opens a topic named by hash without dropping the computer or project", async () => {
    expect(
      await follow("/settings/loom?machine=computer&project=project#loom-vault-access"),
    ).toEqual({
      pathname: "/settings/vault",
      search: { machine: "computer", project: "project" },
      hash: "loom-vault-access",
    });
  });

  it("opens Lanes for the bare page and for topics that no longer exist", async () => {
    expect(await follow("/settings/loom")).toEqual({
      pathname: "/settings/worktrees",
      search: {},
      hash: "loom-project-lifecycle",
    });
    expect(await follow("/settings/loom?section=retired&checkout=c&project=p&from=agent")).toEqual({
      pathname: "/settings/worktrees",
      search: { checkout: "c", project: "p", from: "agent" },
      hash: "loom-project-lifecycle",
    });
  });

  it("keeps the repair query of the Vault GitHub link the server sends to agents", async () => {
    const id = "0123456789abcdef0123456789abcdef";
    // Same shape as apps/server/src/fork/vault/VaultGitHub.ts builds for repository-denied repairs.
    const settingsPath = `/settings/loom?machine=${encodeURIComponent("env 1")}&section=vault-github#loom-vault-github?connection=${id}&repository=${encodeURIComponent("Owner/Repo")}`;
    const target = await follow(settingsPath);
    expect(target.pathname).toBe("/settings/vault");
    expect(target.search).toEqual({ machine: "env 1" });
    expect(target.hash.split("?")[0]).toBe("loom-vault-github");
    const repair = new URLSearchParams(target.hash.split("?")[1] ?? "");
    expect(repair.get("connection")).toBe(id);
    expect(repair.get("repository")).toBe("Owner/Repo");
  });
});
