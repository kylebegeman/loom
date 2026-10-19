import type { PreviewNavigationDeps } from "@t3tools/client-runtime/fork";
import { EnvironmentId } from "@t3tools/contracts";
import type { PreviewLink } from "@t3tools/contracts/fork";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("./navigationDeps", () => ({ appPreviewNavigationDeps: {} }));

const systemBrowser = vi.hoisted(() => ({
  windows: [] as Array<string | null>,
  openExternal: vi.fn<(url: string) => Promise<void>>(async () => undefined),
}));
vi.mock("./systemBrowser", () => ({
  openInSystemBrowser: async (resolveUrl: () => Promise<string | null>) => {
    systemBrowser.windows.push(await resolveUrl());
  },
}));
vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({ shell: { openExternal: systemBrowser.openExternal } }),
}));

import { openEnvironmentUrlExternallyWith } from "./navigation";

const LOCAL = EnvironmentId.make("env-local");
const REMOTE = EnvironmentId.make("env-dorothy");
const OTHER = EnvironmentId.make("env-other");

const link = (port: number): PreviewLink => ({
  id: `link-${port}`,
  kind: "port",
  port,
  host: `${port}-k3f9x2-dorothy.bagels.top`,
  url: `https://${port}-k3f9x2-dorothy.bagels.top/`,
  createdBy: "owner",
  threadId: null,
  laneId: null,
  state: "open",
  lifetime: "12h",
  createdAt: "2026-10-18T00:00:00.000Z",
  expiresAt: "2026-10-18T12:00:00.000Z",
  endedAt: null,
  restorableUntil: null,
});

function makeDeps(overrides: Partial<PreviewNavigationDeps> = {}) {
  const share = vi.fn<PreviewNavigationDeps["share"]>(async (_env, input) => link(input.port));
  const open = vi.fn<PreviewNavigationDeps["open"]>(async (_env, input) => {
    const port = Number(/^link-(\d+)$/.exec(input.link)?.[1] ?? 5173);
    return {
      url: `https://${port}-k3f9x2-dorothy.bagels.top/__loom/enter?code=abc`,
      link: link(port),
    };
  });
  const reportFailure = vi.fn<PreviewNavigationDeps["reportFailure"]>();
  const deps: PreviewNavigationDeps = {
    previewLinkEnvironments: () => [REMOTE],
    reachesLoopback: (environmentId) => environmentId === LOCAL,
    privateNetworkUrl: () => null,
    keepsTypedLoopbackOnPrivateNetwork: true,
    environmentLabel: () => "Dorothy",
    settingsPath: "Settings > Loom > Previews",
    share,
    open,
    reportFailure,
    ...overrides,
  };
  return { deps, share, open, reportFailure };
}

describe("openEnvironmentUrlExternallyWith", () => {
  beforeEach(() => {
    systemBrowser.windows.length = 0;
    systemBrowser.openExternal.mockClear();
  });

  it("opens a remote computer's loopback port through a preview link", async () => {
    const { deps, share } = makeDeps();
    await openEnvironmentUrlExternallyWith(deps, REMOTE, "http://localhost:5797/app");
    expect(share).toHaveBeenCalledWith(REMOTE, { port: 5797 });
    expect(systemBrowser.windows).toEqual([
      "https://5797-k3f9x2-dorothy.bagels.top/__loom/enter?code=abc",
    ]);
    expect(systemBrowser.openExternal).not.toHaveBeenCalled();
  });

  it("opens a loopback port this client reaches as it always did", async () => {
    const { deps, share } = makeDeps({ previewLinkEnvironments: () => [LOCAL, REMOTE] });
    await openEnvironmentUrlExternallyWith(deps, LOCAL, "http://localhost:5797/app");
    expect(share).not.toHaveBeenCalled();
    expect(systemBrowser.windows).toEqual([]);
    expect(systemBrowser.openExternal).toHaveBeenCalledWith("http://localhost:5797/app");
  });

  it("opens a preview link through a fresh entry from the thread's computer", async () => {
    const { deps, open } = makeDeps({ previewLinkEnvironments: () => [OTHER, REMOTE] });
    await openEnvironmentUrlExternallyWith(
      deps,
      REMOTE,
      "https://5173-k3f9x2-dorothy.bagels.top/app",
    );
    expect(open.mock.calls.map(([environmentId]) => environmentId)).toEqual([REMOTE]);
    expect(systemBrowser.windows).toEqual([
      "https://5173-k3f9x2-dorothy.bagels.top/__loom/enter?code=abc",
    ]);
  });

  it("closes the window it took once a failed share was shown", async () => {
    const { deps, reportFailure } = makeDeps({ previewLinkEnvironments: () => [] });
    await openEnvironmentUrlExternallyWith(deps, REMOTE, "http://localhost:5797/");
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure.mock.calls[0]?.[0]).toMatch(/Settings > Loom > Previews/);
    expect(systemBrowser.windows).toEqual([null]);
    expect(systemBrowser.openExternal).not.toHaveBeenCalled();
  });

  it("opens other addresses, or any without a thread, unchanged", async () => {
    const { deps, share } = makeDeps();
    await openEnvironmentUrlExternallyWith(deps, REMOTE, "https://example.com/");
    await openEnvironmentUrlExternallyWith(deps, undefined, "http://localhost:5797/");
    expect(share).not.toHaveBeenCalled();
    expect(systemBrowser.openExternal.mock.calls).toEqual([
      ["https://example.com/"],
      ["http://localhost:5797/"],
    ]);
  });
});
