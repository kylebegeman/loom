// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";

const harness = vi.hoisted(() => ({ authorityId: "first", run: vi.fn() }));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn(), canGoBack: () => false }),
}));
vi.mock("../library/libraryState", () => ({
  useLibraryAuthority: () => ({
    environmentId: EnvironmentId.make(harness.authorityId),
    connected: true,
  }),
  library: { projects: () => "projects" },
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => true }));
vi.mock("../../state/entities", () => ({
  useEnvironmentServerConfig: () => ({ environment: { capabilities: {} } }),
}));
vi.mock("@t3tools/client-runtime/fork", () => ({
  supportsLoomFeature: () => true,
  siteCheckState: () => "healthy",
}));
vi.mock("./state", () => ({
  sites: {
    snapshot: () => "snapshot",
    analytics: () => "analytics",
    saveSite: { permissionAtom: () => null },
    runChecks: {},
  },
}));
vi.mock("./use-site-check-clock", () => ({ useSiteCheckClock: () => 0 }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => harness.run }));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: {
      configured: true,
      managementConfigured: true,
      snapshot: {
        observedAt: "2026-10-17T00:00:00Z",
        sites: [],
        services: [],
        checks: [],
      },
    },
    refresh: vi.fn(),
  }),
}));
vi.mock("./SiteEditor", () => ({
  SiteEditor: ({ environmentId }: { environmentId: string }) => (
    <span role="dialog">Editing on {environmentId}</span>
  ),
}));
vi.mock("react-native", () => ({
  Linking: { openURL: vi.fn() },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../components/ui/Button", () => ({
  Button: ({
    label,
    onPress,
    disabled,
  }: {
    label: string;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {label}
    </button>
  ),
}));
vi.mock("../library/LibraryScreens", () => ({
  LibraryPage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
import { SitesRouteScreen } from "./SitesScreen";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.authorityId = "first";
  harness.run.mockReset();
  harness.run.mockResolvedValue({ _tag: "Success", value: {} });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

function render() {
  act(() => root.render(<SitesRouteScreen route={{ params: undefined }} />));
}
function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent === label,
  );
  expect(button, label).toBeDefined();
  act(() => button!.click());
}

it("closes drafts when the Library changes instead of sending them to the new server", () => {
  render();
  click("Register site");
  expect(container.querySelector('[role="dialog"]')?.textContent).toBe("Editing on first");
  harness.authorityId = "second";
  render();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  click("Register site");
  expect(container.querySelector('[role="dialog"]')?.textContent).toBe("Editing on second");
});

it("can run checks on registered services before the first site exists", async () => {
  render();
  click("Run checks now");
  await act(async () => {});
  expect(harness.run).toHaveBeenCalledWith({
    environmentId: EnvironmentId.make("first"),
    input: {},
  });
});
