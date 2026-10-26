import { describe, expect, it } from "vite-plus/test";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import type { PreviewLink, PreviewLinksSetup, PreviewPage } from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import {
  canRestorePreviewPage,
  formatPreviewDuration,
  previewLibraryStatus,
  previewLinkBackingLabel,
  previewPageControls,
  previewPageSummary,
  previewPageTiming,
  visiblePreviewPages,
} from "./preview-links.ts";

const NOW = Date.parse("2026-10-19T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const at = (offset: number) => DateTime.formatIso(DateTime.makeUnsafe(NOW + offset));

function page(overrides: Partial<PreviewPage> = {}): PreviewPage {
  return {
    id: "page",
    url: "https://pages.bagels.top/p/page",
    title: "Release notes",
    kind: "html",
    projectId: ProjectId.make("project"),
    threadId: ThreadId.make("thread"),
    state: "open",
    kept: false,
    sizeBytes: 2048,
    createdAt: at(-HOUR),
    expiresAt: at(29 * DAY),
    endedAt: null,
    restorableUntil: null,
    ...overrides,
  };
}

const ended = (overrides: Partial<PreviewPage> = {}) =>
  page({ state: "ended", endedAt: at(-HOUR), restorableUntil: at(6 * DAY), ...overrides });

describe("previewLibraryStatus", () => {
  const setup = (library?: PreviewLinksSetup["library"]): PreviewLinksSetup => ({
    settings: {
      enabled: true,
      suffix: "bagels.top",
      machine: "dorothy",
      defaultLifetime: "12h",
      gatewayPort: 3779,
    },
    tokenStored: true,
    ready: true,
    tunnel: { state: "connected", message: null },
    gateway: { state: "listening", message: null },
    ...(library === undefined ? {} : { library }),
  });

  it("shows nothing for older servers or while previews are off", () => {
    expect(previewLibraryStatus(setup())).toBeNull();
    expect(previewLibraryStatus(setup({ state: "off", message: null }))).toBeNull();
  });

  it("flags only a failed registration, with the server's reason", () => {
    expect(previewLibraryStatus(setup({ state: "registered", message: null }))).toMatchObject({
      label: "Registered",
      problem: false,
    });
    expect(
      previewLibraryStatus(setup({ state: "error", message: "Sign this computer in." })),
    ).toEqual({ label: "Not registered", detail: "Sign this computer in.", problem: true });
    for (const state of ["registering", "not-connected", "unsupported"] as const)
      expect(previewLibraryStatus(setup({ state, message: null }))?.problem).toBe(false);
  });
});

describe("formatPreviewDuration", () => {
  it("formats whole units, rounded down", () => {
    expect(formatPreviewDuration(30_000)).toBe("under a minute");
    expect(formatPreviewDuration(45 * MINUTE)).toBe("45m");
    expect(formatPreviewDuration(12 * HOUR)).toBe("12h");
    expect(formatPreviewDuration(3 * HOUR + 12 * MINUTE + 59_000)).toBe("3h 12m");
    expect(formatPreviewDuration(2 * DAY)).toBe("2d");
    expect(formatPreviewDuration(2 * DAY + 4 * HOUR + 59 * MINUTE)).toBe("2d 4h");
  });
});

describe("canRestorePreviewPage", () => {
  it("is true only for a closed page inside its restore window", () => {
    expect(canRestorePreviewPage(ended(), NOW)).toBe(true);
    expect(canRestorePreviewPage(ended({ restorableUntil: at(-MINUTE) }), NOW)).toBe(false);
    expect(canRestorePreviewPage(ended({ restorableUntil: null }), NOW)).toBe(false);
    expect(canRestorePreviewPage(page({ restorableUntil: at(DAY) }), NOW)).toBe(false);
  });
});

describe("visiblePreviewPages", () => {
  it("lists open pages newest first, then restorable closed pages, and hides the rest", () => {
    const older = page({ id: "older", createdAt: at(-2 * DAY) });
    const newer = page({ id: "newer", createdAt: at(-MINUTE) });
    const endedRecently = ended({ id: "ended-recently", endedAt: at(-MINUTE) });
    const expiredEarlier = page({
      id: "expired-earlier",
      state: "expired",
      expiresAt: at(-DAY),
      endedAt: null,
      restorableUntil: at(6 * DAY),
    });
    const purged = ended({ id: "purged", endedAt: at(-8 * DAY), restorableUntil: at(-DAY) });
    expect(
      visiblePreviewPages([expiredEarlier, older, purged, endedRecently, newer], NOW).map(
        (entry) => entry.id,
      ),
    ).toEqual(["newer", "older", "ended-recently", "expired-earlier"]);
  });
});

describe("previewPageTiming", () => {
  it("counts down an open page, or says it is kept", () => {
    expect(previewPageTiming(page({ expiresAt: at(3 * DAY + 2 * HOUR) }), NOW)).toBe(
      "Expires in 3d 2h",
    );
    expect(previewPageTiming(page({ expiresAt: at(-1) }), NOW)).toBe("Expiring now");
    expect(previewPageTiming(page({ kept: true, expiresAt: null }), NOW)).toBe("Kept");
    expect(previewPageTiming(page({ kept: true, expiresAt: at(DAY) }), NOW)).toBe("Kept");
  });

  it("says when a page closed and how long it stays restorable", () => {
    expect(previewPageTiming(ended({ endedAt: at(-5 * MINUTE) }), NOW)).toBe(
      "Ended 5m ago · Restorable for 6d",
    );
    expect(previewPageTiming(ended({ endedAt: at(-10_000) }), NOW)).toBe(
      "Ended just now · Restorable for 6d",
    );
    expect(
      previewPageTiming(
        page({
          state: "expired",
          expiresAt: at(-26 * HOUR),
          endedAt: null,
          restorableUntil: at(5 * DAY + 22 * HOUR),
        }),
        NOW,
      ),
    ).toBe("Expired 1d 2h ago · Restorable for 5d 22h");
    expect(previewPageTiming(ended({ restorableUntil: at(-MINUTE) }), NOW)).toBe("Ended 1h ago");
  });

  it("leads with the kind", () => {
    expect(previewPageSummary(page({ kind: "dossier", kept: true }), NOW)).toBe("Dossier · Kept");
    expect(previewPageSummary(page({ expiresAt: at(45 * MINUTE) }), NOW)).toBe(
      "HTML · Expires in 45m",
    );
  });
});

describe("previewPageControls", () => {
  it("offers open, keep and end on an open page, with changes gated by permission", () => {
    expect(previewPageControls(page(), false, NOW)).toEqual([
      { control: "open", enabled: true },
      { control: "keep", enabled: false },
      { control: "end", enabled: false },
    ]);
    expect(previewPageControls(page({ kept: true }), true, NOW)).toEqual([
      { control: "open", enabled: true },
      { control: "release", enabled: true },
      { control: "end", enabled: true },
    ]);
  });

  it("never opens an address that is not https", () => {
    for (const url of ["javascript:alert(1)", "http://pages.bagels.top/p/page", "https:///p"]) {
      expect(previewPageControls(page({ url }), true, NOW)[0]).toEqual({
        control: "open",
        enabled: false,
      });
    }
    expect(
      previewPageControls(page({ url: "HTTPS://pages.bagels.top/p/x" }), true, NOW)[0],
    ).toEqual({ control: "open", enabled: true });
  });

  it("offers restore on a closed page only within its restore window", () => {
    expect(previewPageControls(ended(), true, NOW)).toEqual([
      { control: "restore", enabled: true },
    ]);
    expect(previewPageControls(ended(), false, NOW)).toEqual([
      { control: "restore", enabled: false },
    ]);
    expect(previewPageControls(ended({ restorableUntil: at(-MINUTE) }), true, NOW)).toEqual([
      { control: "restore", enabled: false },
    ]);
  });
});

describe("previewLinkBackingLabel", () => {
  // Built from local fields so the day boundary holds in any time zone the tests run in.
  // @effect-diagnostics-next-line globalDate:off
  const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);
  const afternoon = local(19, 14).getTime();
  // ICU separates the time from AM and PM with a narrow no-break space.
  const label = (link: PreviewLink, now: number) =>
    previewLinkBackingLabel(link, now, "en-US")?.replace(/\u202f/g, " ") ?? null;

  function link(overrides: Partial<PreviewLink> = {}): PreviewLink {
    return {
      id: "link",
      kind: "port",
      port: 41_002,
      host: "41002-k3f9x2-dorothy.bagels.top",
      url: "https://41002-k3f9x2-dorothy.bagels.top/",
      createdBy: "agent",
      threadId: ThreadId.make("thread"),
      laneId: "lane",
      state: "open",
      lifetime: "12h",
      createdAt: at(-HOUR),
      expiresAt: at(11 * HOUR),
      endedAt: null,
      restorableUntil: null,
      ...overrides,
    };
  }

  const container = (stopsAt: Date, overrides: Partial<PreviewLink> = {}) =>
    link({
      backing: {
        kind: "container",
        image: "nginx:alpine",
        containerId: "0123456789ab",
        containerPort: 80,
        stopsAt: stopsAt.toISOString(),
      },
      ...overrides,
    });

  it("says nothing for a plain port, which is all an older server sends", () => {
    expect(label(link(), afternoon)).toBeNull();
  });

  it("names the folder as the agent gave it, relative to the workspace", () => {
    const folder = (path: string) => label(link({ backing: { kind: "folder", path } }), afternoon);
    expect(folder("dist")).toBe("Folder dist");
    expect(folder("./apps/site/dist/")).toBe("Folder apps/site/dist");
    expect(folder(".")).toBe("Workspace root folder");
  });

  it("says when an open container stops, naming the day once it crosses midnight", () => {
    expect(label(container(local(19, 15, 40)), afternoon)).toBe(
      "Container nginx:alpine, stops 3:40 PM",
    );
    expect(label(container(local(20, 1, 10)), local(19, 23).getTime())).toBe(
      "Container nginx:alpine, stops Tue 1:10 AM",
    );
    expect(label(container(local(19, 13, 59)), afternoon)).toBe(
      "Container nginx:alpine, stopping now",
    );
  });

  it("drops the stop time once the link has ended, since the container is gone", () => {
    expect(
      label(
        container(local(19, 15, 40), { state: "revoked", endedAt: local(19, 13).toISOString() }),
        afternoon,
      ),
    ).toBe("Container nginx:alpine");
  });
});
