// fork: ext-settings: upstream deleted this file; Loom keeps its device-only topic check.
import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  createFileRoute: (() => (options: { component: () => ReactNode }) => ({
    options,
    useSearch: () => ({ machine: "missing" }),
    useNavigate: () => vi.fn(),
  })) as never,
  useLocation: ((options?: { select: (location: unknown) => unknown }) => {
    const location = {
      pathname: "/settings/loom",
      hash: "",
      state: {},
      search: { section: "panel-picker" },
    };
    return options ? options.select(location) : location;
  }) as never,
  Outlet: (() => <p>Panel picker preferences</p>) as never,
}));
vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  SettingsScopeProvider: (({ children }: { children: ReactNode }) => children) as never,
  useSettingsScope: (() => ({
    search: { machine: "missing" },
    scope: { kind: "unavailable", message: "Environment unavailable" },
    environment: null,
    connectedEnvironments: [],
  })) as never,
}));
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({ environments: [] })) as never,
}));
// No spreads below: the real modules load every settings panel, which outlasts the timeout on a busy machine.
vi.mock(import("./SettingsSidebarNav"), () => ({ SettingsSidebarNav: (() => null) as never }));
vi.mock(import("./SettingsBreadcrumb"), () => ({ SettingsBreadcrumb: (() => null) as never }));
vi.mock(import("./SettingsPanels"), () => ({
  useSettingsRestore: () => ({ changedSettingLabels: [], restoreDefaults: async () => {} }),
}));
vi.mock(import("../../fork/settings/registry"), () => ({
  FORK_SETTINGS_SECTIONS: [{ id: "panel-picker", scope: "device" }] as never,
}));
vi.mock(import("../sidebar/mainAppLocation"), async (original) => ({
  ...(await original()),
  useCloseAppModal: () => vi.fn(),
}));

import { Route } from "../../routes/_chat.settings";

it("keeps device-only Loom preferences available with an unavailable environment", async () => {
  const Layout = Route.options.component!;
  await Layout.preload?.();
  await using _screen = await render(<Layout />);

  await expect.element(page.getByText("Panel picker preferences")).toBeVisible();
  expect(document.body.textContent).not.toContain("Environment unavailable");
});
