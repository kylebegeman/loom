// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, type ExecutionEnvironmentCapabilities } from "@t3tools/contracts";
import { SITES_FEATURE, type SitesSnapshot } from "@t3tools/contracts/fork";

const harness = vi.hoisted(() => ({ authorityId: "first", run: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("../project-library/state", async () => {
  const { SITES_FEATURE, SITES_MANAGEMENT_FEATURE } = await import("@t3tools/contracts/fork");
  const capabilities = { loomFeatures: [SITES_FEATURE, SITES_MANAGEMENT_FEATURE] };
  return {
    useLibraryAuthority: () => ({
      authorityId: EnvironmentId.make(harness.authorityId),
      connected: true,
      environment: { label: "Library", serverConfig: { environment: { capabilities } } },
    }),
    useLibraryProjects: () => ({ query: { data: [] } }),
    useLibraryPermission: () => true,
  };
});
vi.mock("./state", () => ({
  sites: { snapshot: () => "snapshot", analytics: () => "analytics", runChecks: {} },
}));
vi.mock("./use-site-check-clock", () => ({ useSiteCheckClock: () => 0 }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => harness.run }));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (atom: unknown) =>
    atom === "snapshot"
      ? {
          data: {
            configured: true,
            managementConfigured: true,
            snapshot: {
              schemaVersion: 1,
              primarySiteId: "home",
              observedAt: "2026-10-17T00:00:00Z",
              staleAfterSeconds: 600,
              sites: [],
              services: [],
              checks: [],
            },
          },
          error: null,
          isPending: false,
          refresh: vi.fn(),
        }
      : { data: null, error: null, isPending: false, refresh: vi.fn() },
}));
vi.mock("./SiteEditor", () => ({
  SiteEditor: ({ environmentId }: { environmentId: string }) => (
    <span role="dialog">Editing on {environmentId}</span>
  ),
  useSiteActiveToggle: () => ({ pending: null, toggle: vi.fn() }),
}));
vi.mock("~/env", () => ({ isElectron: false }));
vi.mock("~/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("~/components/ui/sidebar", () => ({
  SidebarInset: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("~/components/WorkspacePageHeader", () => ({ WorkspacePageHeader: () => null }));
vi.mock("~/components/WorkspacePageContainer", () => ({
  WorkspacePageContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
import {
  UNLINKED_PROJECT,
  filterServices,
  filterSites,
  sitesAttention,
  sitesGate,
  sitesStatus,
  sortSites,
  SitesPage,
  type SiteFilters,
} from "./SitesPage";

const editor = await vi.importActual<typeof import("./SiteEditor")>("./SiteEditor");

type Site = SitesSnapshot["sites"][number];
type Service = SitesSnapshot["services"][number];
type Check = SitesSnapshot["checks"][number];

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

function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent === label,
  );
  expect(button, label).toBeDefined();
  act(() => button!.click());
}

it("closes drafts when the Library changes instead of sending them to the new server", () => {
  act(() => root.render(<SitesPage />));
  click("Register site");
  expect(container.querySelector('[role="dialog"]')?.textContent).toBe("Editing on first");
  harness.authorityId = "second";
  act(() => root.render(<SitesPage />));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  click("Register site");
  expect(container.querySelector('[role="dialog"]')?.textContent).toBe("Editing on second");
});

it("can run checks on registered services before the first site exists", async () => {
  act(() => root.render(<SitesPage />));
  click("Run all checks");
  await act(async () => {});
  expect(harness.run).toHaveBeenCalledWith({
    environmentId: EnvironmentId.make("first"),
    input: {},
  });
});

const NOW = Date.parse("2026-10-20T12:00:00Z");
const DAY = 86_400_000;
const FRESH = new Date(NOW - 60_000).toISOString();
const OLD = new Date(NOW - DAY).toISOString();
// An hour past the day boundary, so whole-day rounding lands on `days`.
const certificateIn = (days: number) => new Date(NOW + days * DAY + 3_600_000).toISOString();

const site = (id: string, overrides: Partial<Site> = {}): Site => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1),
  url: `https://${id}.example.com`,
  active: 1,
  origins: [`https://${id}.example.com`],
  serviceIds: [id],
  projectIds: ["project-a"],
  ...overrides,
});

const service = (id: string, overrides: Partial<Service> = {}): Service => ({
  id,
  name: `${id} service`,
  url: `https://${id}.example.com`,
  active: 1,
  kind: "website",
  ...overrides,
});

const check = (
  serviceId: string,
  {
    id = `${serviceId}-home`,
    state = "healthy",
    status = 200,
    checkedAt = FRESH,
    certificate = 90,
    ...overrides
  }: Partial<Check> & {
    readonly status?: number | null;
    readonly checkedAt?: string;
    readonly certificate?: number;
  } = {},
): Check => ({
  id,
  service_id: serviceId,
  name: "Home",
  url: `https://${serviceId}.example.com/`,
  active: state === "disabled" ? 0 : 1,
  state,
  last: {
    checked_at: checkedAt,
    ok: state === "failing" ? 0 : 1,
    status,
    duration_ms: 120,
    tls_expires_at: certificateIn(certificate),
    error: null,
  },
  ...overrides,
});

const snapshotOf = (parts: Partial<SitesSnapshot>): SitesSnapshot => ({
  schemaVersion: 1,
  primarySiteId: "home",
  observedAt: new Date(NOW).toISOString(),
  staleAfterSeconds: 600,
  sites: [],
  services: [],
  checks: [],
  ...parts,
});

const NO_FILTERS: SiteFilters = { query: "", states: new Set(), projects: new Set() };
const ids = (list: readonly { readonly id: string }[]) => list.map((entry) => entry.id);

describe("filterSites", () => {
  const snapshot = snapshotOf({
    sites: [
      site("shop"),
      site("blog", { projectIds: ["project-b"] }),
      site("docs", { projectIds: [] }),
      site("old", { active: 0 }),
    ],
    checks: [check("shop", { state: "failing", status: 503 }), check("blog"), check("docs")],
  });
  const projects = new Map([
    ["project-a", { title: "Storefront" }],
    ["project-b", { title: "Writing" }],
  ]);

  it("searches names, addresses and the titles of the projects a site serves", () => {
    expect(ids(filterSites(snapshot, NOW, { ...NO_FILTERS, query: "writing" }, projects))).toEqual([
      "blog",
    ]);
    expect(
      ids(filterSites(snapshot, NOW, { ...NO_FILTERS, query: " DOCS.example " }, projects)),
    ).toEqual(["docs"]);
  });

  it("keeps the sites in any chosen state", () => {
    const states = new Set(["failing", "paused"] as const);
    expect(ids(filterSites(snapshot, NOW, { ...NO_FILTERS, states }, projects))).toEqual([
      "shop",
      "old",
    ]);
  });

  it("finds sites that serve no project through the Not linked entry", () => {
    const filters = { ...NO_FILTERS, projects: new Set([UNLINKED_PROJECT, "project-b"]) };
    expect(ids(filterSites(snapshot, NOW, filters, projects))).toEqual(["blog", "docs"]);
  });
});

describe("sortSites", () => {
  const snapshot = snapshotOf({
    primarySiteId: "zebra",
    sites: [
      site("calm"),
      site("paused", { active: 0 }),
      site("expiring"),
      site("broken"),
      site("lagging"),
      site("zebra"),
    ],
    checks: [
      check("calm"),
      check("paused", { state: "failing" }),
      check("expiring", { certificate: 6 }),
      check("broken", { state: "failing", status: 500 }),
      check("lagging", { checkedAt: OLD }),
      check("zebra"),
    ],
  });

  it("puts failing, then stale, then certificates running out first, and paused sites last", () => {
    expect(ids(sortSites(snapshot.sites, snapshot, NOW, "attention", null))).toEqual([
      "broken",
      "lagging",
      "expiring",
      "calm",
      "zebra",
      "paused",
    ]);
  });

  it("sorts by name with the primary site leading and numbers read as numbers", () => {
    const named = snapshotOf({
      primarySiteId: "zebra",
      sites: [
        site("site10", { name: "Site 10" }),
        site("zebra"),
        site("site2", { name: "Site 2" }),
      ],
    });
    expect(ids(sortSites(named.sites, named, NOW, "name", null))).toEqual([
      "zebra",
      "site2",
      "site10",
    ]);
  });

  it("sorts by page views, with sites whose traffic has not loaded after the rest", () => {
    const visits = new Map([
      ["calm", 10],
      ["broken", 300],
    ]);
    expect(ids(sortSites(snapshot.sites, snapshot, NOW, "visits", visits)).slice(0, 3)).toEqual([
      "broken",
      "calm",
      "expiring",
    ]);
  });
});

describe("sitesAttention", () => {
  it("names each site's worst problem, worst sites first", () => {
    const snapshot = snapshotOf({
      sites: [
        site("shop"),
        site("menu"),
        site("api", { serviceIds: ["api", "api-auth"] }),
        site("blog"),
        site("archive"),
        site("expired"),
        site("asleep", { active: 0 }),
        site("calm"),
      ],
      checks: [
        check("shop", { state: "failing", status: 503, certificate: 3 }),
        check("menu", { state: "failing", content: "Welcome" }),
        check("api", { state: "failing", status: null }),
        check("api-auth", { id: "api-auth-home", state: "failing", status: 401 }),
        check("blog", { certificate: 5 }),
        check("archive", { checkedAt: OLD }),
        check("expired", { certificate: -2 }),
        check("asleep", { state: "failing" }),
        check("calm"),
      ],
    });
    expect(
      sitesAttention(snapshot, NOW).map(({ title, tone, detail }) => [title, tone, detail]),
    ).toEqual([
      ["Api", "danger", "2 checks failing"],
      ["Menu", "danger", "menu.example.com is missing “Welcome”"],
      ["Shop", "danger", "shop.example.com answered 503"],
      ["Expired", "danger", "certificate expired"],
      ["Archive", "warning", "check results are out of date"],
      ["Blog", "warning", "certificate expires in 5 days"],
    ]);
  });

  it("opens a site's checks, and lists a failing service no site uses under Services", () => {
    const snapshot = snapshotOf({
      sites: [site("shop")],
      services: [service("shop"), service("worker", { name: "Worker" })],
      checks: [
        check("shop", { state: "failing", status: null }),
        check("worker", { state: "failing" }),
      ],
    });
    expect(sitesAttention(snapshot, NOW)).toEqual([
      {
        key: "site:shop",
        tone: "danger",
        title: "Shop",
        detail: "shop.example.com did not answer",
        search: { siteId: "shop", tab: "checks" },
      },
      {
        key: "service:worker",
        tone: "danger",
        title: "Worker",
        detail: "1 check failing",
        search: { view: "services" },
      },
    ]);
  });

  it("stays empty while everything answers and no certificate is close", () => {
    const snapshot = snapshotOf({
      sites: [site("shop")],
      checks: [check("shop", { certificate: 15 })],
    });
    expect(sitesAttention(snapshot, NOW)).toEqual([]);
  });
});

describe("sitesStatus", () => {
  it("leads with failures, then results gone stale", () => {
    const failing = snapshotOf({
      checks: [check("a", { state: "failing" }), check("b", { checkedAt: OLD }), check("c")],
    });
    expect(sitesStatus(failing, NOW)).toMatchObject({ tone: "danger", label: "1 failing" });
    const stale = snapshotOf({ checks: [check("b", { checkedAt: OLD }), check("c")] });
    expect(sitesStatus(stale, NOW)).toMatchObject({ tone: "warning", label: "1 out of date" });
  });

  it("says when nothing is watched, since paused checks do not count", () => {
    expect(sitesStatus(snapshotOf({ checks: [check("c")] }), NOW).label).toBe("All normal");
    const paused = snapshotOf({ checks: [check("a", { state: "disabled" })] });
    expect(sitesStatus(paused, NOW)).toMatchObject({ tone: "neutral", label: "Nothing watched" });
  });

  it("never calls a check that has not run yet normal or passing", () => {
    const waiting = snapshotOf({ checks: [check("new", { last: null }), check("c")] });
    expect(sitesStatus(waiting, NOW)).toMatchObject({
      tone: "neutral",
      label: "1 not checked yet",
      watched: 2,
      passing: 1,
    });
    const failing = snapshotOf({
      checks: [check("new", { last: null }), check("a", { state: "failing" })],
    });
    expect(sitesStatus(failing, NOW)).toMatchObject({ tone: "danger", passing: 0 });
  });
});

describe("sitesGate", () => {
  const capabilities = (loomFeatures: readonly string[]) =>
    ({ loomFeatures }) as unknown as ExecutionEnvironmentCapabilities;

  it("waits for a connecting Library's config instead of asking for an update", () => {
    expect(sitesGate({ chosen: true, connected: true, capabilities: null })).toBe("connecting");
    expect(sitesGate({ chosen: true, connected: false, capabilities: undefined })).toBe("offline");
  });

  it("asks for an update only when a known config lacks Sites", () => {
    expect(sitesGate({ chosen: true, connected: true, capabilities: capabilities([]) })).toBe(
      "unsupported",
    );
    expect(
      sitesGate({ chosen: true, connected: false, capabilities: capabilities([SITES_FEATURE]) }),
    ).toBeNull();
    expect(sitesGate({ chosen: false, connected: false, capabilities: null })).toBe(
      "choose-library",
    );
  });
});

it("filters services by failing and paused, counting each", () => {
  const snapshot = snapshotOf({
    services: [service("web"), service("api"), service("old", { active: 0 })],
    checks: [check("web"), check("api", { state: "failing" }), check("old", { state: "failing" })],
  });
  expect(filterServices(snapshot, NOW, "all").counts).toEqual({ all: 3, failing: 1, paused: 1 });
  expect(ids(filterServices(snapshot, NOW, "failing").services)).toEqual(["api"]);
  expect(ids(filterServices(snapshot, NOW, "paused").services)).toEqual(["old"]);
});

describe("site editor helpers", () => {
  it("reads typed hosts and pasted page URLs as an HTTPS origin", () => {
    expect(editor.readSiteAddress("Shop.Example.com/pricing?plan=pro")).toEqual({
      ok: true,
      origin: "https://shop.example.com",
      droppedPath: "/pricing?plan=pro",
    });
    expect(editor.readSiteAddress("https://example.com/")).toEqual({
      ok: true,
      origin: "https://example.com",
      droppedPath: null,
    });
  });

  it("says why an address cannot be a site", () => {
    for (const input of ["", "http://example.com", "ftp://example.com", "localhost"]) {
      expect(editor.readSiteAddress(input).ok, input).toBe(false);
    }
    expect(editor.readSiteAddress("https://me:secret@example.com")).toEqual({
      ok: false,
      reason: "Leave sign-in details out of the address.",
    });
  });

  it("derives IDs and keeps them unique within the length limit", () => {
    expect(editor.idFromName("Café Menu!")).toBe("cafe-menu");
    expect(editor.uniqueId("blog", new Set(["blog", "blog-2"]))).toBe("blog-3");
    expect(editor.uniqueId("", new Set())).toBe("site");
    const long = "a".repeat(64);
    const next = editor.uniqueId(long, new Set([long]));
    expect(next).toHaveLength(64);
    expect(next.endsWith("-2")).toBe(true);
  });

  it("names checks from their page and keeps them on their service", () => {
    expect(editor.checkNameFromPath("/")).toBe("Home");
    expect(editor.checkNameFromPath("/api/health-check?full=1")).toBe("Health check");
    expect(editor.readCheckPath("health", "https://api.example.com")).toEqual({
      ok: true,
      url: "https://api.example.com/health",
    });
    expect(
      editor.readCheckPath("https://api.example.com/v1?x=1", "https://api.example.com"),
    ).toEqual({ ok: true, url: "https://api.example.com/v1?x=1" });
    expect(editor.readCheckPath("https://other.example.com/", "https://api.example.com").ok).toBe(
      false,
    );
  });

  const draft = {
    address: "shop.example.com",
    name: "Shop",
    id: "shop",
    projectIds: ["project-a"],
    serviceIds: ["shop", "api"],
    watch: true,
    extraOrigins: ["https://www.shop.example.com", "https://shop.example.com"],
    active: true,
  };

  it("holds each wizard step until it is complete", () => {
    expect(editor.siteDraftIssues(draft, new Set())).toEqual({
      address: null,
      serves: null,
      monitoring: null,
    });
    const issues = editor.siteDraftIssues({ ...draft, projectIds: [] }, new Set(["shop"]));
    expect(issues.address).toBe("Another site already uses the ID shop.");
    expect(issues.serves).toBe("Choose at least one project this site serves.");
  });

  it("saves the site's own origin first and its watch service once", () => {
    expect(editor.siteSaveRequest(draft, "https://shop.example.com", "shop")).toEqual({
      id: "shop",
      name: "Shop",
      url: "https://shop.example.com",
      active: true,
      origins: ["https://shop.example.com", "https://www.shop.example.com"],
      serviceIds: ["shop", "api"],
      projectIds: ["project-a"],
    });
  });

  it("replays an entry unchanged apart from whether it is watched", () => {
    expect(editor.activeToggleRequest({ kind: "site", row: site("shop") }, false)).toEqual({
      kind: "site",
      input: {
        id: "shop",
        name: "Shop",
        url: "https://shop.example.com",
        active: false,
        origins: ["https://shop.example.com"],
        serviceIds: ["shop"],
        projectIds: ["project-a"],
      },
    });
    const bare = check("shop", { state: "disabled" });
    expect(editor.activeToggleRequest({ kind: "check", row: bare }, true).input).toMatchObject({
      active: true,
      expected_status: 200,
      content: "",
    });
    // The API rejects a site with no projects, so resuming one sends people to its editor instead.
    expect(() =>
      editor.activeToggleRequest({ kind: "site", row: site("docs", { projectIds: [] }) }, true),
    ).toThrow();
  });
});
