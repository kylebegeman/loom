// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";

const harness = vi.hoisted(() => ({
  authorityId: "first",
  run: vi.fn(),
  dispatch: vi.fn(),
  queries: [] as (string | null)[],
  canRead: true,
  configLoaded: true,
  isAuthority: true,
  connected: true,
  libraryInfoLoaded: true,
  manage: true,
  snapshot: null as unknown,
  analytics: null as unknown,
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn(), dispatch: harness.dispatch, canGoBack: () => false }),
  StackActions: {
    push: (name: string, params?: unknown) => ({ type: "PUSH", payload: { name, params } }),
    replace: (name: string) => ({ type: "REPLACE", payload: { name } }),
  },
}));
vi.mock("../library/libraryState", () => ({
  useLibraryAuthority: () => ({
    loaded: true,
    environmentId: EnvironmentId.make(harness.authorityId),
    connected: harness.connected,
    canRead: harness.canRead,
    label: "Library server",
    info: {
      data: harness.libraryInfoLoaded
        ? {
            environmentId: EnvironmentId.make(harness.authorityId),
            isAuthority: harness.isAuthority,
          }
        : null,
      isPending: !harness.libraryInfoLoaded,
      error: null,
      refresh: vi.fn(),
    },
  }),
  library: { projects: () => "projects" },
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => harness.manage }));
vi.mock("../../state/entities", () => ({
  useEnvironmentServerConfig: () =>
    harness.configLoaded ? { environment: { capabilities: {} } } : null,
}));
vi.mock("@t3tools/client-runtime/fork", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/client-runtime/fork")>()),
  supportsLoomFeature: (capabilities: unknown) => capabilities !== undefined,
}));
vi.mock("./state", () => ({
  useSitesWrites: () => ({
    saveSite: harness.run,
    saveService: harness.run,
    saveCheck: harness.run,
    runChecks: harness.run,
  }),
  sites: {
    snapshot: () => "snapshot",
    analytics: ({ input }: { input: { siteId: string } }) => `analytics:${input.siteId}`,
    saveSite: { permissionAtom: () => null },
    runChecks: {},
  },
}));
vi.mock("./use-site-check-clock", () => ({
  useSiteCheckClock: () => Date.parse("2026-10-17T00:00:00Z"),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => harness.run }));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (key: string | null) => {
    harness.queries.push(key);
    return {
      data:
        key === "snapshot"
          ? { configured: true, managementConfigured: true, snapshot: harness.snapshot }
          : key?.startsWith("analytics:")
            ? harness.analytics
            : null,
      error: null,
      isPending: false,
      refresh: vi.fn(),
    };
  },
}));
vi.mock("./SiteEditor", () => ({
  SiteEditor: ({ environmentId }: { environmentId: string }) => (
    <span role="dialog">Editing on {environmentId}</span>
  ),
}));
vi.mock("react-native", () => ({
  ActivityIndicator: () => <span role="progressbar" />,
  Linking: { openURL: vi.fn() },
  View: ({
    children,
    accessibilityLabel,
  }: {
    children: ReactNode;
    accessibilityLabel?: string;
  }) => <div aria-label={accessibilityLabel}>{children}</div>,
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
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("../../components/ui/useControlTheme", () => ({
  useControlTheme: () => ({ colors: { "--color-primary": "#3a67d0" } }),
}));
vi.mock("../../components/ui/Sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
}));
vi.mock("../../components/ui/ListRow", () => ({
  ListRow: ({
    label,
    description,
    onPress,
  }: {
    label: string;
    description: string;
    onPress: () => void;
  }) => (
    <button onClick={onPress}>
      {label} {description}
    </button>
  ),
}));
vi.mock("../../components/ui/RowPressable", () => ({
  RowPressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
vi.mock("../../components/ui/Menu", () => ({
  Menu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../features/settings/components/SettingsSection", () => ({
  SettingsSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
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
vi.mock("../library/LibraryPage", () => ({
  LibraryPage: ({
    children,
    actions = [],
    menus = [],
  }: {
    children: ReactNode;
    actions?: { accessibilityLabel: string; disabled?: boolean; onPress: () => void }[];
    menus?: { items: { id: string; title: string; disabled?: boolean; onPress: () => void }[] }[];
  }) => (
    <div>
      {actions.map((action) => (
        <button key={action.accessibilityLabel} disabled={action.disabled} onClick={action.onPress}>
          {action.accessibilityLabel}
        </button>
      ))}
      {menus
        .flatMap((menu) => menu.items)
        .map((item) => (
          <button key={item.id} disabled={item.disabled} onClick={item.onPress}>
            {item.title}
          </button>
        ))}
      {children}
    </div>
  ),
  LibraryNotice: ({ detail, error }: { detail?: string; error?: string }) => (
    <p>{error ?? detail}</p>
  ),
}));
import type { SiteAnalytics, SitesSnapshot } from "@t3tools/contracts/fork";
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
  harness.analytics = null;
  harness.canRead = true;
  harness.configLoaded = true;
  harness.isAuthority = true;
  harness.connected = true;
  harness.libraryInfoLoaded = true;
  harness.manage = true;
  harness.queries = [];
  harness.dispatch.mockReset();
  harness.run.mockReset();
  harness.run.mockResolvedValue({ _tag: "Success", value: {} });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

function render(siteId?: string) {
  act(() => root.render(<SitesRouteScreen route={{ params: siteId ? { siteId } : undefined }} />));
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
  click("Register website");
  expect(container.querySelector('[role="dialog"]')?.textContent).toBe("Editing on first");
  harness.authorityId = "second";
  render();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  click("Register website");
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

it("opens the exact website and keeps shared services secondary", () => {
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
  render("home");
  expect(container.textContent).toContain("0 of 1 checks passing");
  expect(container.textContent).toContain("Answered 503, expected 200.");
  expect(container.textContent).toContain("1.3 s");
  expect(container.textContent).not.toContain("Docs");
  expect(harness.queries).toContain("analytics:home");
  harness.connected = false;
  render("home");
  expect(container.textContent).toContain("Library offline");
  expect(container.textContent).toContain("0 of 1 checks passing");
  harness.connected = true;
  harness.manage = false;
  render("home");
  expect(container.querySelector('[aria-label="Actions for Web"]')).toBeNull();
  expect(container.textContent).not.toContain("Edit website");
  expect(container.textContent).not.toContain("Run all checks");
  expect(container.querySelector('[aria-label="Actions for Front page"]')).toBeNull();
  render("missing");
  expect(container.textContent).toContain("Website unavailable");
  expect(container.textContent).not.toContain("Front page");
  render();
  click("Docs docs.example.test");
  expect(harness.dispatch).toHaveBeenCalledWith({
    type: "PUSH",
    payload: { name: "Sites", params: { siteId: "docs" } },
  });
  click("Services");
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Front page");
});

it("keeps traffic summaries visible while detailed reports can be opened and closed", () => {
  harness.snapshot = {
    ...emptySnapshot,
    sites: [
      {
        id: "home",
        name: "Home",
        url: "https://home.example.test",
        active: 1,
        origins: ["https://home.example.test"],
        serviceIds: [],
      },
    ],
  } satisfies SitesSnapshot;
  harness.analytics = {
    siteId: "home",
    lastEventAt: null,
    days: 1,
    since: "2026-10-17T00:00:00Z",
    pageviews: 12,
    visitors: 4,
    events: 2,
    byDay: [{ day: "2026-10-17", pageviews: 12, visitors: 4 }],
    pages: [{ path: "/about", pageviews: 12, visitors: 4 }],
    named: [],
  } satisfies SiteAnalytics;
  render("home");
  expect(container.textContent).toContain("Daily visitors");
  expect(container.textContent).not.toContain("/about");
  click("Traffic details");
  expect(container.textContent).toContain("/about");
  click("Traffic details");
  expect(container.textContent).not.toContain("/about");
});

it("does not request website or project data without Library read access", () => {
  harness.canRead = false;
  render("home");
  expect(container.textContent).toContain("Website access unavailable");
  expect(harness.queries.every((query) => query === null)).toBe(true);
});

it("waits for capabilities before declaring that the Library needs an update", () => {
  harness.configLoaded = false;
  render("home");
  expect(container.querySelector('[aria-label="Loading Library capabilities"]')).not.toBeNull();
  expect(container.textContent).not.toContain("need a newer Library server");
  expect(harness.queries).not.toContain("snapshot");
  expect(harness.queries).not.toContain("analytics:home");
  harness.configLoaded = true;
  harness.libraryInfoLoaded = false;
  harness.queries = [];
  render("home");
  expect(container.querySelector('[aria-label="Loading Library"]')).not.toBeNull();
  expect(harness.queries.every((query) => query === null)).toBe(true);
});

it("does not send Library queries to an execution computer", () => {
  harness.isAuthority = false;
  render("home");
  expect(container.textContent).toContain("Choose your Library server");
  expect(harness.queries.every((query) => query === null)).toBe(true);
});
