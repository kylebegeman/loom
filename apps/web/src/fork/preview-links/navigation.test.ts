import { EnvironmentAuthorizationError, EnvironmentId } from "@t3tools/contracts";
import { PreviewLinksError, type PreviewLink } from "@t3tools/contracts/fork";
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

import {
  landingPath,
  navigablePreviewUrlWith,
  openEnvironmentUrlExternallyWith,
  previewLinkEntryUrlWith,
  resolvePreviewNavigationWith,
  type PreviewNavigationDeps,
} from "./navigation";

const LOCAL = EnvironmentId.make("env-local");
const REMOTE = EnvironmentId.make("env-dorothy");
const OTHER = EnvironmentId.make("env-other");

const link = (port: number, id = `link-${port}`): PreviewLink => ({
  id,
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

const notFound = () => new PreviewLinksError({ reason: "not-found", message: "No such link." });
const notConfigured = () =>
  new PreviewLinksError({ reason: "not-configured", message: "Preview links are off." });

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
    environmentLabel: () => "Dorothy",
    share,
    open,
    reportFailure,
    ...overrides,
  };
  return { deps, share, open, reportFailure };
}

describe("loopback URLs", () => {
  it("leaves them alone when the page renders on the environment's computer", async () => {
    const { deps, share } = makeDeps();
    await expect(
      resolvePreviewNavigationWith(deps, {
        url: "http://localhost:5173/app",
        environmentId: REMOTE,
        runtime: "server",
      }),
    ).resolves.toBe("http://localhost:5173/app");
    expect(share).not.toHaveBeenCalled();
  });

  it("leaves them alone when this client reaches the environment's loopback", async () => {
    const { deps, share } = makeDeps({ previewLinkEnvironments: () => [LOCAL, REMOTE] });
    await expect(
      resolvePreviewNavigationWith(deps, {
        url: "http://localhost:5173/app",
        environmentId: LOCAL,
        runtime: "desktop",
      }),
    ).resolves.toBe("http://localhost:5173/app");
    expect(share).not.toHaveBeenCalled();
  });

  it("shares the port of a remote computer and opens it on the requested path", async () => {
    const { deps, share, open } = makeDeps();
    await expect(
      resolvePreviewNavigationWith(deps, {
        url: "http://127.0.0.1:5173/dashboard?tab=2#top",
        environmentId: REMOTE,
        runtime: undefined,
      }),
    ).resolves.toBe("https://5173-k3f9x2-dorothy.bagels.top/__loom/enter?code=abc");
    expect(share).toHaveBeenCalledWith(REMOTE, { port: 5173 });
    expect(open).toHaveBeenCalledWith(REMOTE, {
      link: "link-5173",
      path: "/dashboard?tab=2#top",
    });
  });

  it("reads schemeless loopback addresses", async () => {
    const { deps, share } = makeDeps();
    await resolvePreviewNavigationWith(deps, {
      url: "localhost:3000",
      environmentId: REMOTE,
      runtime: "desktop",
    });
    expect(share).toHaveBeenCalledWith(REMOTE, { port: 3000 });
  });

  it("falls back to the private network address when links are not set up", async () => {
    const { deps } = makeDeps({
      share: async () => {
        throw notConfigured();
      },
      privateNetworkUrl: (_env, url) => `http://192.168.1.25:${url.port}${url.pathname}`,
    });
    await expect(
      resolvePreviewNavigationWith(deps, {
        url: "http://localhost:5173/app",
        environmentId: REMOTE,
        runtime: undefined,
      }),
    ).resolves.toBe("http://192.168.1.25:5173/app");
  });

  it("points at Settings > Previews when links are not set up and no network route exists", async () => {
    const { deps } = makeDeps({
      share: async () => {
        throw notConfigured();
      },
    });
    await expect(
      resolvePreviewNavigationWith(deps, {
        url: "http://localhost:5173/app",
        environmentId: REMOTE,
        runtime: undefined,
      }),
    ).rejects.toThrow(/not set up on Dorothy.*Settings > Previews/);
  });

  it("explains a connection without preview access", async () => {
    const { deps } = makeDeps({
      share: async () => {
        throw new EnvironmentAuthorizationError({
          message: "Missing scope.",
          requiredScope: "preview:operate",
        });
      },
    });
    await expect(
      resolvePreviewNavigationWith(deps, {
        url: "http://localhost:5173/",
        environmentId: REMOTE,
        runtime: undefined,
      }),
    ).rejects.toThrow(/cannot share ports on Dorothy/);
  });

  it("passes other share failures through", async () => {
    const { deps } = makeDeps({
      share: async () => {
        throw new PreviewLinksError({ reason: "port-denied", message: "Port 22 is not shared." });
      },
    });
    await expect(
      resolvePreviewNavigationWith(deps, {
        url: "http://localhost:22/",
        environmentId: REMOTE,
        runtime: undefined,
      }),
    ).rejects.toThrow("Port 22 is not shared.");
  });

  it("leaves a private network environment's loopback as typed without the feature", async () => {
    const { deps, share } = makeDeps({
      previewLinkEnvironments: () => [],
      privateNetworkUrl: (_env, url) => `http://192.168.1.25:${url.port}${url.pathname}`,
    });
    await expect(
      resolvePreviewNavigationWith(deps, {
        url: "http://localhost:5173/app",
        environmentId: REMOTE,
        runtime: undefined,
      }),
    ).resolves.toBe("http://localhost:5173/app");
    expect(share).not.toHaveBeenCalled();
  });

  it("fails clearly instead of loading an unreachable loopback without the feature", async () => {
    const { deps } = makeDeps({ previewLinkEnvironments: () => [] });
    await expect(
      resolvePreviewNavigationWith(deps, {
        url: "http://localhost:5173/app",
        environmentId: REMOTE,
        runtime: undefined,
      }),
    ).rejects.toThrow(/not reachable from this device.*Settings > Previews/);
  });
});

describe("preview link URLs", () => {
  const agentLink = "https://5173-k3f9x2-dorothy.bagels.top/settings?x=1";

  it("opens a fresh entry on the thread's own environment", async () => {
    const { deps, open } = makeDeps();
    await expect(
      resolvePreviewNavigationWith(deps, {
        url: agentLink,
        environmentId: REMOTE,
        runtime: undefined,
      }),
    ).resolves.toBe("https://5173-k3f9x2-dorothy.bagels.top/__loom/enter?code=abc");
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(REMOTE, { link: agentLink, path: "/settings?x=1" });
  });

  it("asks the other connected computers when the thread's does not own it", async () => {
    const { deps } = makeDeps({
      previewLinkEnvironments: () => [OTHER, REMOTE],
      open: vi.fn<PreviewNavigationDeps["open"]>(async (environmentId) => {
        if (environmentId !== OTHER) throw notFound();
        return { url: "https://other/__loom/enter?code=1", link: link(5173) };
      }),
    });
    await expect(
      resolvePreviewNavigationWith(deps, {
        url: agentLink,
        environmentId: REMOTE,
        runtime: undefined,
      }),
    ).resolves.toBe("https://other/__loom/enter?code=1");
    expect(vi.mocked(deps.open).mock.calls.map(([environmentId]) => environmentId)).toEqual([
      REMOTE,
      OTHER,
    ]);
  });

  it("skips computers it cannot ask and stops at the first owner", async () => {
    const calls: EnvironmentId[] = [];
    const { deps } = makeDeps({
      previewLinkEnvironments: () => [REMOTE, OTHER, LOCAL],
      open: async (environmentId) => {
        calls.push(environmentId);
        if (environmentId === REMOTE) {
          throw new EnvironmentAuthorizationError({
            message: "No.",
            requiredScope: "preview:operate",
          });
        }
        return { url: `https://${environmentId}/__loom/enter?code=1`, link: link(5173) };
      },
    });
    await expect(
      resolvePreviewNavigationWith(deps, {
        url: agentLink,
        environmentId: REMOTE,
        runtime: undefined,
      }),
    ).resolves.toBe("https://env-other/__loom/enter?code=1");
    expect(calls).toEqual([REMOTE, OTHER]);
  });

  it("loads the port directly in a browser drawn on the owning computer", async () => {
    const { deps } = makeDeps();
    await expect(
      resolvePreviewNavigationWith(deps, {
        url: agentLink,
        environmentId: REMOTE,
        runtime: "server",
      }),
    ).resolves.toBe("http://localhost:5173/settings?x=1");
  });

  it("uses the entry when a server browser belongs to another computer", async () => {
    const { deps } = makeDeps({
      previewLinkEnvironments: () => [OTHER],
      open: async () => ({ url: "https://other/__loom/enter?code=1", link: link(5173) }),
    });
    await expect(
      resolvePreviewNavigationWith(deps, {
        url: agentLink,
        environmentId: REMOTE,
        runtime: "server",
      }),
    ).resolves.toBe("https://other/__loom/enter?code=1");
  });

  it("leaves the URL alone when no connected computer owns it", async () => {
    const { deps } = makeDeps({
      previewLinkEnvironments: () => [REMOTE, OTHER],
      open: async () => {
        throw notFound();
      },
    });
    await expect(
      resolvePreviewNavigationWith(deps, {
        url: agentLink,
        environmentId: REMOTE,
        runtime: undefined,
      }),
    ).resolves.toBe(agentLink);
  });

  it("reports a link that has ended", async () => {
    const { deps } = makeDeps({
      open: async () => {
        throw new PreviewLinksError({ reason: "not-restorable", message: "This link has ended." });
      },
    });
    await expect(
      resolvePreviewNavigationWith(deps, {
        url: agentLink,
        environmentId: REMOTE,
        runtime: undefined,
      }),
    ).rejects.toThrow("This link has ended.");
  });

  it("lands a stale entry on the root instead of replaying its code", async () => {
    const { deps, open } = makeDeps();
    await resolvePreviewNavigationWith(deps, {
      url: "https://5173-k3f9x2-dorothy.bagels.top/__loom/enter?code=old",
      environmentId: REMOTE,
      runtime: undefined,
    });
    expect(open).toHaveBeenCalledWith(REMOTE, {
      link: "https://5173-k3f9x2-dorothy.bagels.top/__loom/enter?code=old",
      path: "/",
    });
  });
});

describe("other URLs", () => {
  it("are returned unchanged", async () => {
    const { deps, share, open } = makeDeps();
    for (const url of ["https://example.com/a", "http://192.168.1.25:5173/", "not a url"]) {
      await expect(
        resolvePreviewNavigationWith(deps, { url, environmentId: REMOTE, runtime: undefined }),
      ).resolves.toBe(url);
    }
    expect(share).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});

describe("landingPath", () => {
  it("keeps the path, query and fragment", () => {
    expect(landingPath(new URL("http://localhost:5173/a/b?c=d#e"))).toBe("/a/b?c=d#e");
    expect(landingPath(new URL("http://localhost:5173"))).toBe("/");
  });

  it("never lands on a gateway page", () => {
    expect(landingPath(new URL("https://x.bagels.top/__loom/enter?code=1"))).toBe("/");
  });
});

describe("navigablePreviewUrlWith", () => {
  it("reports a failure once and returns null", async () => {
    const { deps, reportFailure } = makeDeps({ previewLinkEnvironments: () => [] });
    await expect(
      navigablePreviewUrlWith(deps, {
        url: "http://localhost:5173/",
        environmentId: REMOTE,
        runtime: undefined,
      }),
    ).resolves.toBeNull();
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure.mock.calls[0]?.[0]).toMatch(/Settings > Previews/);
  });

  it("passes a resolved URL through without reporting", async () => {
    const { deps, reportFailure } = makeDeps();
    await expect(
      navigablePreviewUrlWith(deps, {
        url: "https://example.com/",
        environmentId: REMOTE,
        runtime: undefined,
      }),
    ).resolves.toBe("https://example.com/");
    expect(reportFailure).not.toHaveBeenCalled();
  });
});

describe("previewLinkEntryUrlWith", () => {
  const LINK = "https://5173-k3f9x2-dorothy.bagels.top/app?x=1";

  it("asks each connected computer until one serves the link", async () => {
    const { deps, open } = makeDeps({ previewLinkEnvironments: () => [OTHER, REMOTE] });
    open.mockRejectedValueOnce(notFound());
    await expect(previewLinkEntryUrlWith(deps, LINK)).resolves.toBe(
      "https://5173-k3f9x2-dorothy.bagels.top/__loom/enter?code=abc",
    );
    expect(open.mock.calls.map(([environmentId]) => environmentId)).toEqual([OTHER, REMOTE]);
    expect(open).toHaveBeenLastCalledWith(REMOTE, { link: LINK, path: "/app?x=1" });
  });

  it("returns the link itself when no connected computer serves it", async () => {
    const { deps, open, reportFailure } = makeDeps();
    open.mockRejectedValue(notFound());
    await expect(previewLinkEntryUrlWith(deps, LINK)).resolves.toBe(LINK);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("reports an ended link once and returns null", async () => {
    const { deps, open, reportFailure } = makeDeps();
    open.mockRejectedValue(
      new PreviewLinksError({ reason: "not-restorable", message: "This link has ended." }),
    );
    await expect(previewLinkEntryUrlWith(deps, LINK)).resolves.toBeNull();
    expect(reportFailure).toHaveBeenCalledWith("This link has ended.");
  });
});

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
