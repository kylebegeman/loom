// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ pullRequestsSupported: true }));
vi.mock("~/hooks/useSettings", () => ({ useEnvironmentIdentificationMode: () => "off" }));
vi.mock("~/hooks/useMediaQuery", () => ({ useIsMobile: () => false }));
vi.mock("~/state/environments", () => ({
  usePullRequestsSupported: () => state.pullRequestsSupported,
}));
vi.mock("~/fork/bots/BotsFooterEntry", () => ({
  useBotsFooterEntry: () => ({ icon: null, label: "Bots, attention needed" }),
}));
vi.mock("~/components/SidebarStageBackdrop", () => ({
  resolveEnvironmentIdentificationPillLabel: () => null,
  resolveSidebarStageBackdropVariant: () => null,
  SidebarStageBackdrop: () => null,
  useEnvironmentStageLabel: () => "Dev",
}));
vi.mock("~/components/sidebar/SidebarThreadUndoNotice", () => ({
  SidebarThreadUndoNotice: () => null,
}));
vi.mock("~/components/sidebar/SidebarProviderUpdatePill", () => ({
  SidebarProviderUpdatePill: () => null,
}));
vi.mock("~/components/sidebar/SidebarUpdatePill", () => ({
  SidebarUpdateArchitectureWarning: () => null,
  SidebarUpdatePill: () => null,
}));

import { SidebarProvider } from "~/components/ui/sidebar";
import { SidebarUtilityMenu } from "~/components/sidebar/SidebarChrome";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  state.pullRequestsSupported = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderMenu(pathname: string) {
  const layout = createRootRoute({
    component: () => (
      <SidebarProvider>
        <SidebarUtilityMenu />
        <Outlet />
      </SidebarProvider>
    ),
  });
  const routes = [
    "/",
    "/settings",
    "/settings/$section",
    "/usage",
    "/projects",
    "/projects/$projectKey",
    "/sites",
    "/loom/bots",
    "/pull-requests",
  ].map((path) => createRoute({ getParentRoute: () => layout, path, component: () => null }));
  const router = createRouter({
    routeTree: layout.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [pathname] }),
    defaultPendingMinMs: 0,
  });
  await router.load();
  await act(async () => root.render(<RouterProvider router={router} />));
  return router;
}
const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
const activeLabel = () =>
  container.querySelector('[aria-current="page"]')?.getAttribute("aria-label");

it("keeps every destination reachable while switching between top-level pages", async () => {
  const router = await renderMenu("/usage");
  expect(activeLabel()).toBe("Usage");
  const destinations = [
    ["Settings", "/settings"],
    ["Projects", "/projects"],
    ["Sites", "/sites"],
    ["Bots, attention needed", "/loom/bots"],
    ["Pull Requests", "/pull-requests"],
    ["Usage", "/usage"],
  ] as const;
  for (const [label, path] of destinations) {
    for (const [other] of destinations) expect(button(other)).not.toBeNull();
    await act(async () => button(label)!.click());
    expect(router.state.location.pathname).toBe(path);
    expect(activeLabel()).toBe(label);
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  }
});

it("retains the active section on its detail pages without marking conversations active", async () => {
  const router = await renderMenu("/settings/connections");
  expect(activeLabel()).toBe("Settings");
  expect(button("Sites")).not.toBeNull();
  await act(async () =>
    router.navigate({ to: "/projects/$projectKey", params: { projectKey: "test" } }),
  );
  expect(activeLabel()).toBe("Projects");
  await act(async () => router.navigate({ to: "/" }));
  expect(activeLabel()).toBeUndefined();
  expect(button("Settings")).not.toBeNull();
});

it("keeps capability-gated destinations hidden without hiding the rest of navigation", async () => {
  state.pullRequestsSupported = false;
  await renderMenu("/settings");
  expect(button("Pull Requests")).toBeNull();
  expect(button("Projects")).not.toBeNull();
  expect(button("Bots, attention needed")).not.toBeNull();
  expect(activeLabel()).toBe("Settings");
});
