// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";

const harness = vi.hoisted(() => ({ authorityId: "first", run: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("../project-library/state", () => ({
  useLibraryAuthority: () => ({
    authorityId: EnvironmentId.make(harness.authorityId),
    connected: true,
    environment: { serverConfig: { environment: { capabilities: {} } } },
  }),
  useLibraryProjects: () => ({ query: { data: [] } }),
  useLibraryPermission: () => true,
}));
vi.mock("@t3tools/client-runtime/fork", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/client-runtime/fork")>()),
  supportsLoomFeature: () => true,
}));
vi.mock("./state", () => ({
  sites: { snapshot: () => "snapshot", analytics: () => "analytics", runChecks: {} },
}));
vi.mock("./use-site-check-clock", () => ({ useSiteCheckClock: () => 0 }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => harness.run }));
vi.mock("~/state/query", () => ({
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
vi.mock("~/env", () => ({ isElectron: false }));
vi.mock("~/components/ui/button", () => ({
  Button: ({ children, ...props }: { children: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("~/components/ui/sidebar", () => ({
  SidebarInset: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("~/components/WorkspacePageHeader", () => ({ WorkspacePageHeader: () => null }));
vi.mock("~/components/WorkspacePageContainer", () => ({
  WorkspacePageContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
import { SitesPage } from "./SitesPage";

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
  click("Run checks now");
  await act(async () => {});
  expect(harness.run).toHaveBeenCalledWith({
    environmentId: EnvironmentId.make("first"),
    input: {},
  });
});
