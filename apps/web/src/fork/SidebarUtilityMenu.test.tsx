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
import { startMainAppLocationTracking } from "~/components/sidebar/mainAppLocation";

let root: Root;
let stopTracking = () => {};
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
  stopTracking();
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
    "/draft/$draftId",
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
  stopTracking = startMainAppLocationTracking(router);
  await act(async () => root.render(<RouterProvider router={router} />));
  return router;
}
const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
const activeLabel = () =>
  container.querySelector('[aria-current="page"]')?.getAttribute("aria-label");

const backButton = () =>
  Array.from(container.querySelectorAll("button")).find((entry) => entry.textContent === "Back");

it.each([
  ["Settings", "/settings", "/settings/connections"],
  ["Pull requests", "/pull-requests", "/pull-requests"],
  ["Usage", "/usage", "/usage"],
])("returns from %s to the previous conversation", async (label, path, detail) => {
  const router = await renderMenu("/draft/retained?view=diff#latest");
  await act(async () => button(label)!.click());
  expect(router.state.location.pathname).toBe(path);
  await act(async () => router.navigate({ href: detail }));
  expect(backButton()).toBeDefined();
  expect(button("Settings")).toBeNull();
  expect(button("Projects")).toBeNull();
  expect(button("Sites")).toBeNull();
  expect(button("Bots, attention needed")).toBeNull();
  await act(async () => backButton()!.click());
  expect(router.state.location.href).toBe("/draft/retained?view=diff#latest");
  expect(button("Settings")).not.toBeNull();
});

it("keeps highlighted navigation across Projects, Sites and Bots", async () => {
  const router = await renderMenu("/projects");
  const destinations = [
    ["Projects", "/projects"],
    ["Sites", "/sites"],
    ["Bots, attention needed", "/loom/bots"],
  ] as const;
  for (const [label, path] of destinations) {
    for (const other of [
      "Settings",
      "Pull requests",
      "Usage",
      ...destinations.map(([name]) => name),
    ])
      expect(button(other)).not.toBeNull();
    expect(backButton()).toBeUndefined();
    await act(async () => button(label)!.click());
    expect(router.state.location.pathname).toBe(path);
    expect(activeLabel()).toBe(label);
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  }
});

it("retains project selection on detail pages without marking conversations active", async () => {
  const router = await renderMenu("/projects/test");
  expect(activeLabel()).toBe("Projects");
  expect(button("Sites")).not.toBeNull();
  expect(backButton()).toBeUndefined();
  await act(async () => router.navigate({ to: "/" }));
  expect(activeLabel()).toBeUndefined();
  expect(button("Settings")).not.toBeNull();
});

it("keeps capability-gated destinations hidden without hiding the rest of navigation", async () => {
  state.pullRequestsSupported = false;
  await renderMenu("/projects");
  expect(button("Pull requests")).toBeNull();
  expect(button("Projects")).not.toBeNull();
  expect(button("Bots, attention needed")).not.toBeNull();
  expect(activeLabel()).toBe("Projects");
});
