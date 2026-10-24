// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";

const harness = vi.hoisted(() => ({
  authorityId: "first",
  run: vi.fn(),
  snapshot: null as unknown,
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn(), canGoBack: () => false }),
}));
vi.mock("../library/libraryState", () => ({
  useLibraryAuthority: () => ({
    environmentId: EnvironmentId.make(harness.authorityId),
    connected: true,
    label: "Library server",
  }),
  library: { projects: () => "projects" },
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => true }));
vi.mock("../../state/entities", () => ({
  useEnvironmentServerConfig: () => ({ environment: { capabilities: {} } }),
}));
vi.mock("@t3tools/client-runtime/fork", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/client-runtime/fork")>()),
  supportsLoomFeature: () => true,
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
  useEnvironmentQuery: (key: string | null) => ({
    data:
      key === "snapshot"
        ? { configured: true, managementConfigured: true, snapshot: harness.snapshot }
        : null,
    error: null,
    isPending: false,
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
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
  }: {
    children: ReactNode;
    onPress: () => void;
    accessibilityLabel: string;
  }) => (
    <button aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../components/ui/IconButton", () => ({
  IconButton: ({ accessibilityLabel }: { accessibilityLabel: string }) => (
    <button aria-label={accessibilityLabel} />
  ),
}));
vi.mock("../../components/ui/SegmentedControl", () => ({
  SegmentedControl: ({
    options,
    onSelect,
  }: {
    options: readonly { value: string; label: string }[];
    onSelect: (value: string) => void;
  }) => (
    <>
      {options.map((option) => (
        <button key={option.value} onClick={() => onSelect(option.value)}>
          {option.label}
        </button>
      ))}
    </>
  ),
}));
vi.mock("../library/libraryProjectColors", () => ({
  LibraryProjectTile: () => null,
  useLibraryProjectColorValue: () => () => "#3a67d0",
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
  LibraryPage: ({
    children,
    actions,
  }: {
    children: ReactNode;
    actions: { accessibilityLabel: string; disabled?: boolean; onPress: () => void }[];
  }) => (
    <div>
      {actions.map((action) => (
        <button key={action.accessibilityLabel} disabled={action.disabled} onClick={action.onPress}>
          {action.accessibilityLabel}
        </button>
      ))}
      {children}
    </div>
  ),
  LibraryNotice: ({ detail, error }: { detail?: string; error?: string }) => (
    <p>{error ?? detail}</p>
  ),
}));
import type { SitesSnapshot } from "@t3tools/contracts/fork";
import { SitesRouteScreen } from "./SitesScreen";

const emptySnapshot: SitesSnapshot = {
  schemaVersion: 1,
  primarySiteId: "site",
  observedAt: "2026-10-17T00:00:00Z",
  staleAfterSeconds: 900,
  sites: [],
  services: [],
  checks: [],
};

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.authorityId = "first";
  harness.snapshot = emptySnapshot;
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
  click("Run all checks");
  await act(async () => {});
  expect(harness.run).toHaveBeenCalledWith({
    environmentId: EnvironmentId.make("first"),
    input: {},
  });
});

it("explains a failing check in words and reaches its site from the shared services", () => {
  harness.snapshot = {
    ...emptySnapshot,
    sites: [
      {
        id: "home",
        name: "Home",
        url: "https://home.example.test",
        active: 1,
        origins: ["https://home.example.test"],
        serviceIds: ["web"],
      },
      {
        id: "docs",
        name: "Docs",
        url: "https://docs.example.test",
        active: 1,
        origins: ["https://docs.example.test"],
        serviceIds: [],
      },
    ],
    services: [
      { id: "web", name: "Web", url: "https://home.example.test", active: 1, kind: "website" },
    ],
    checks: [
      {
        id: "root",
        service_id: "web",
        name: "Front page",
        url: "https://home.example.test/",
        active: 1,
        state: "failing",
        last: {
          checked_at: "2026-10-17T00:00:00Z",
          ok: 0,
          status: 503,
          duration_ms: 1250,
          tls_expires_at: null,
          error: null,
        },
      },
    ],
  } satisfies SitesSnapshot;
  render();
  expect(container.textContent).toContain("1 failing");
  expect(container.textContent).toContain("Answered 503, expected 200.");
  expect(container.textContent).toContain("1.3 s");
  click("Services");
  expect(container.querySelector('[aria-label="Open site Home"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Open site Docs"]')).toBeNull();
});
