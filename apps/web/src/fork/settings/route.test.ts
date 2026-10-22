import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  retainSearchParams,
} from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";
import {
  retainSettingsScope,
  validateSettingsRouteSearch,
} from "~/components/settings/settingsScopeNavigation";
import { beforeLoomSettingsLoad, validateLoomSettingsSearch } from "../../routes/settings.loom";

function settingsRouter(
  initialEntry: string,
  beforeLoad: typeof beforeLoomSettingsLoad = beforeLoomSettingsLoad,
) {
  const root = createRootRoute();
  const settings = createRoute({
    getParentRoute: () => root,
    path: "settings",
    validateSearch: validateSettingsRouteSearch,
    search: { middlewares: [retainSettingsScope] },
  });
  const loom = createRoute({
    getParentRoute: () => settings,
    path: "loom",
    validateSearch: validateLoomSettingsSearch,
    search: { middlewares: [retainSearchParams(["section"])] },
    beforeLoad,
  });
  return createRouter({
    routeTree: root.addChildren([settings.addChildren([loom])]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
}

describe("Loom topic navigation", () => {
  it("canonicalizes topic preloads without looping or changing the selected topic", async () => {
    let loads = 0;
    const router = settingsRouter("/settings/loom?section=vault-health", (input) => {
      loads += 1;
      if (loads > 4) throw new Error("Repeated topic preload redirect");
      return beforeLoomSettingsLoad(input);
    });
    await router.load();
    loads = 0;
    await router.preloadRoute({
      to: "/settings/loom",
      search: { section: "vault-health" },
      hash: "loom-vault-profiles",
    });
    expect(loads).toBeLessThanOrEqual(2);
    expect(router.state.location.search.section).toBe("vault-health");
    expect(router.state.location.hash).toBe("");
    loads = 0;
    await router.navigate({
      to: "/settings/loom",
      search: { section: "vault-health" },
      hash: "loom-vault-profiles",
    });
    expect(router.state.redirect).toBeDefined();
    await router.navigate(router.state.redirect!.options);
    expect(router.state.location.search.section).toBe("vault-profiles");
    expect(router.state.matches.at(-1)?.status).toBe("success");
  });

  it("converts an existing section link without dropping its computer or project", async () => {
    const router = settingsRouter(
      "/settings/loom?machine=computer&project=project#loom-vault-github",
    );
    await router.load();
    expect(router.state.redirect).toBeDefined();
    await router.navigate(router.state.redirect!.options);
    expect(router.state.location.search).toEqual({
      machine: "computer",
      project: "project",
      section: "vault-github",
    });
    expect(router.state.location.hash).toBe("loom-vault-github");
    await router.navigate({ hash: "", replace: true, resetScroll: false });
    expect(router.state.location.search.section).toBe("vault-github");
    expect(router.state.location.hash).toBe("");
    expect(router.state.matches.at(-1)?.status).toBe("success");
  });

  it("keeps topic and scope through history and reload, while allowing a new target", async () => {
    const router = settingsRouter("/settings/loom?machine=first&section=vault-github");
    await router.load();
    await router.navigate({
      to: "/settings/loom",
      search: (current) => ({ ...current, section: "panel-picker" }),
    });
    expect(router.state.location.search).toEqual({ machine: "first", section: "panel-picker" });
    // The outer settings layout keys form state by its own scope, not the topic.
    expect(
      validateSettingsRouteSearch({
        ...router.state.matches.find((match) => match.routeId === "/settings")!.search,
      }),
    ).toEqual({ machine: "first" });
    const reloaded = settingsRouter(router.state.location.href);
    await reloaded.load();
    expect(reloaded.state.matches.at(-1)?.search).toEqual({
      machine: "first",
      section: "panel-picker",
    });
    router.history.back();
    await router.load();
    expect(router.state.location.search.section).toBe("vault-github");
    await router.navigate({ to: "/settings/loom", search: { machine: "second" } });
    expect(router.state.location.search).toEqual({ machine: "second", section: "vault-github" });
    await router.navigate({ hash: "loom-vault-health" });
    expect(router.state.redirect).toBeDefined();
    await router.navigate(router.state.redirect!.options);
    expect(router.state.location.search).toEqual({ machine: "second", section: "vault-health" });
  });
});
