import { EnvironmentId } from "@t3tools/contracts";
import { PREVIEW_LINKS_FEATURE, type SitesSnapshot } from "@t3tools/contracts/fork";
import { expect, it } from "vite-plus/test";

import {
  sanitizePinnedSites,
  previewUnavailableReason,
  selectedPreviewComputer,
  siteFaviconUrl,
  siteListSections,
  sitePreviewComputers,
  togglePinnedSite,
} from "./site-browser-model";

it("validates saved pin identifiers without retaining malformed authority entries", () => {
  expect(sanitizePinnedSites(null)).toBeUndefined();
  expect(sanitizePinnedSites([])).toBeUndefined();
  expect(
    sanitizePinnedSites({
      alpha: ["site-a", "site-a", null, "https://private.test", "site-b"],
      beta: 1,
      "": [],
    }),
  ).toEqual({ alpha: ["site-a", "site-b"] });
});

it("keeps pin changes within their Library and ignores removed sites when browsing", () => {
  const first = { alpha: ["site-a", "removed"], beta: ["site-b"] };
  const pinned = togglePinnedSite(first, "alpha", "site-b");
  expect(pinned).toEqual({ alpha: ["site-a", "removed", "site-b"], beta: ["site-b"] });
  expect(togglePinnedSite(pinned, "alpha", "site-a").alpha).toEqual(["removed", "site-b"]);
  const site = (id: string, name: string): SitesSnapshot["sites"][number] => ({
    id,
    name,
    url: `https://${id}.test`,
    active: 1,
    origins: [],
    serviceIds: [],
  });
  const sites = [site("site-c", "Zebra"), site("site-b", "Beta"), site("site-a", "Alpha")];
  expect(siteListSections(sites, pinned.alpha!)).toEqual({
    pinned: [sites[2], sites[1]],
    other: [sites[0]],
  });
  expect(siteListSections(sites, pinned.beta!)).toEqual({
    pinned: [sites[1]],
    other: [sites[2], sites[0]],
  });
  expect(first.alpha).toEqual(["site-a", "removed"]);
});

it("loads favicons only from the site's own HTTPS origin", () => {
  expect(siteFaviconUrl("https://example.test/app?secret=x#section")).toBe(
    "https://example.test/favicon.ico",
  );
  expect(siteFaviconUrl("http://example.test")).toBeNull();
  expect(siteFaviconUrl("https://user:password@example.test")).toBeNull();
  expect(siteFaviconUrl("not a URL")).toBeNull();
});

it("offers preview-capable computers and retains an explicitly selected offline computer", () => {
  const computer = (id: string, connected: boolean, supported: boolean, enabled = true) => ({
    environmentId: EnvironmentId.make(id),
    label: id,
    entry: { enabled },
    connection: { phase: connected ? "connected" : "disconnected" },
    serverConfig: {
      environment: {
        capabilities: {
          repositoryIdentity: false,
          loomFeatures: supported ? [PREVIEW_LINKS_FEATURE] : [],
        },
      },
    },
  });
  const computers = sitePreviewComputers([
    computer("offline", false, true),
    computer("online", true, true),
    computer("old", true, false),
    computer("disabled", true, true, false),
  ]);
  expect(computers.map((entry) => entry.environmentId)).toEqual(["offline", "online"]);
  expect(selectedPreviewComputer(computers, EnvironmentId.make("offline"))?.environmentId).toBe(
    "offline",
  );
  expect(selectedPreviewComputer(computers, null)?.environmentId).toBe("online");
  expect(selectedPreviewComputer([], null)).toBeNull();
  expect(previewUnavailableReason([], false)).toBe("Loading computer capabilities…");
  expect(previewUnavailableReason([], true)).toBe("Connect a computer to see live previews.");
  expect(previewUnavailableReason([computer("offline", false, true)], true)).toBe(
    "Reconnect a computer to load live previews.",
  );
  expect(
    previewUnavailableReason([{ ...computer("loading", true, false), serverConfig: null }], true),
  ).toBe("Loading computer capabilities…");
  expect(previewUnavailableReason([computer("old", true, false)], true)).toBe(
    "Update Loom on a connected computer to use private previews.",
  );
});
