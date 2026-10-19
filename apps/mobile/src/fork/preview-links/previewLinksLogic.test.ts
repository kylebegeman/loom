import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import type { PreviewLink, PreviewLinksSetup } from "@t3tools/contracts/fork";
import {
  formatPreviewDuration,
  previewComputers,
  previewLinkActions,
  previewLinkTiming,
  previewOpenCandidates,
  previewSetupStatus,
  visiblePreviewLinks,
  type PreviewComputerSource,
} from "./previewLinksLogic";

const NOW = Date.parse("2026-10-18T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const at = (offset: number) => new Date(NOW + offset).toISOString();

function computer(
  id: string,
  label: string,
  overrides: Partial<PreviewComputerSource> & { readonly features?: string[] } = {},
): PreviewComputerSource {
  return {
    environmentId: EnvironmentId.make(id),
    label,
    entry: { enabled: true },
    connection: { phase: "connected" },
    serverConfig: {
      environment: {
        capabilities: {
          repositoryIdentity: false,
          loomFeatures: overrides.features ?? ["preview-links"],
        },
      },
    },
    ...overrides,
  };
}

function link(overrides: Partial<PreviewLink> = {}): PreviewLink {
  return {
    id: "link",
    kind: "port",
    port: 5173,
    host: "5173-k3f9x2-dorothy.bagels.top",
    url: "https://5173-k3f9x2-dorothy.bagels.top/",
    createdBy: "owner",
    threadId: null,
    laneId: null,
    state: "open",
    lifetime: "12h",
    createdAt: at(-HOUR),
    expiresAt: at(11 * HOUR),
    endedAt: null,
    restorableUntil: null,
    ...overrides,
  };
}

function setup(overrides: {
  readonly enabled?: boolean;
  readonly suffix?: string | null;
  readonly tunnel?: PreviewLinksSetup["tunnel"];
  readonly gateway?: PreviewLinksSetup["gateway"];
}): PreviewLinksSetup {
  const enabled = overrides.enabled ?? true;
  const suffix = overrides.suffix === undefined ? "bagels.top" : overrides.suffix;
  return {
    settings: { enabled, suffix, machine: "dorothy", defaultLifetime: "12h", gatewayPort: 3779 },
    tokenStored: true,
    ready: enabled && suffix !== null,
    tunnel: overrides.tunnel ?? { state: "connected", message: null },
    gateway: overrides.gateway ?? { state: "listening", message: null },
  };
}

describe("previewComputers", () => {
  it("keeps connected, enabled computers that offer previews, sorted by name", () => {
    const result = previewComputers([
      computer("z", "Zelda"),
      computer("old", "Old Mac", { features: ["sites"] }),
      computer("off", "Paused", { entry: { enabled: false } }),
      computer("away", "Away", { connection: { phase: "reconnecting" } }),
      computer("upstream", "Upstream", { serverConfig: null }),
      computer("a", "Dorothy"),
    ]);
    expect(result.map((entry) => entry.label)).toEqual(["Dorothy", "Zelda"]);
  });
});

describe("previewOpenCandidates", () => {
  const computers = previewComputers([computer("a", "A"), computer("b", "B"), computer("c", "C")]);

  it("asks the thread's computer first", () => {
    expect(previewOpenCandidates(computers, EnvironmentId.make("c"))).toEqual(["c", "a", "b"]);
  });

  it("keeps display order when the thread's computer cannot share previews", () => {
    expect(previewOpenCandidates(computers, EnvironmentId.make("gone"))).toEqual(["a", "b", "c"]);
    expect(previewOpenCandidates(computers, null)).toEqual(["a", "b", "c"]);
  });
});

describe("previewSetupStatus", () => {
  it("reports why links cannot be shared yet", () => {
    expect(previewSetupStatus(setup({ enabled: false })).label).toBe("Previews off");
    expect(previewSetupStatus(setup({ suffix: null })).label).toBe("Needs a domain");
    expect(
      previewSetupStatus(setup({ tunnel: { state: "needs-token", message: null } })).label,
    ).toBe("Needs a tunnel token");
  });

  it("surfaces gateway errors before tunnel state, with their message", () => {
    expect(
      previewSetupStatus(
        setup({
          tunnel: { state: "error", message: "Tunnel exited." },
          gateway: { state: "error", message: "Port 3779 is in use." },
        }),
      ),
    ).toEqual({ label: "Gateway error", detail: "Port 3779 is in use.", ready: false });
  });

  it("is ready only once the tunnel connects", () => {
    expect(previewSetupStatus(setup({}))).toEqual({
      label: "Ready on bagels.top",
      detail: null,
      ready: true,
    });
    expect(previewSetupStatus(setup({ tunnel: { state: "starting", message: null } })).ready).toBe(
      false,
    );
  });
});

describe("visiblePreviewLinks", () => {
  it("lists open links newest first, then restorable ended links, and hides the rest", () => {
    const older = link({ id: "older", createdAt: at(-2 * HOUR) });
    const newer = link({ id: "newer", createdAt: at(-MINUTE) });
    const endedRecently = link({
      id: "ended-recently",
      state: "revoked",
      endedAt: at(-MINUTE),
      restorableUntil: at(7 * 24 * HOUR),
    });
    const expiredEarlier = link({
      id: "expired-earlier",
      state: "expired",
      expiresAt: at(-HOUR),
      endedAt: at(-HOUR),
      restorableUntil: at(6 * 24 * HOUR),
    });
    const lapsed = link({
      id: "lapsed",
      state: "expired",
      endedAt: at(-8 * 24 * HOUR),
      restorableUntil: at(-MINUTE),
    });
    expect(
      visiblePreviewLinks([expiredEarlier, older, lapsed, endedRecently, newer], NOW).map(
        (entry) => entry.id,
      ),
    ).toEqual(["newer", "older", "ended-recently", "expired-earlier"]);
  });
});

describe("previewLinkTiming", () => {
  it("counts down an open link and says when it ended", () => {
    expect(previewLinkTiming(link({ expiresAt: at(3 * HOUR + 12 * MINUTE + 30_000) }), NOW)).toBe(
      "Ends in 3h 12m",
    );
    expect(previewLinkTiming(link({ expiresAt: at(30_000) }), NOW)).toBe("Ends in under a minute");
    expect(previewLinkTiming(link({ expiresAt: at(-1) }), NOW)).toBe("Ending now");
    expect(previewLinkTiming(link({ state: "revoked", endedAt: at(-5 * MINUTE) }), NOW)).toBe(
      "Ended 5m ago",
    );
    expect(
      previewLinkTiming(link({ state: "expired", endedAt: null, expiresAt: at(-26 * HOUR) }), NOW),
    ).toBe("Expired 1d 2h ago");
  });

  it("formats whole units", () => {
    expect(formatPreviewDuration(12 * HOUR)).toBe("12h");
    expect(formatPreviewDuration(45 * MINUTE)).toBe("45m");
    expect(formatPreviewDuration(48 * HOUR)).toBe("2d");
  });
});

describe("previewLinkActions", () => {
  const all = { open: true, extend: true, end: true, restore: true };

  it("offers open, copy, extend and end on an open link, gated by permission", () => {
    expect(previewLinkActions(link(), { ...all, extend: false }, NOW)).toEqual([
      { action: "open", enabled: true },
      { action: "copy", enabled: true },
      { action: "extend", enabled: false },
      { action: "end", enabled: true },
    ]);
  });

  it("offers restore on an ended link only within its restore window", () => {
    const restorable = link({ state: "revoked", restorableUntil: at(HOUR) });
    const lapsed = link({ state: "expired", restorableUntil: at(-HOUR) });
    expect(previewLinkActions(restorable, all, NOW)[0]).toEqual({
      action: "restore",
      enabled: true,
    });
    expect(previewLinkActions(lapsed, all, NOW)[0]).toEqual({ action: "restore", enabled: false });
    expect(previewLinkActions(restorable, { ...all, restore: false }, NOW)[0]?.enabled).toBe(false);
  });
});
