import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { SaveSiteRequest, SaveSiteServiceRequest, SiteAnalytics } from "./sites.ts";

const isSite = Schema.is(SaveSiteRequest);
const isService = Schema.is(SaveSiteServiceRequest);

const site = {
  id: "portfolio",
  name: "Portfolio",
  url: "https://portfolio.example",
  active: true,
  origins: ["https://portfolio.example"],
  serviceIds: [],
  projectIds: ["project-1"],
};

it("preserves every analytics breakdown across the typed transport", () => {
  const breakdowns = {
    referrers: [{ referrer_host: "example.com", pageviews: 3 }],
    sources: [{ source: "x", medium: "social", campaign: "launch", pageviews: 2 }],
    countries: [{ country: "", pageviews: 1 }],
    devices: [{ device: "mobile", pageviews: 2 }],
    browsers: [{ browser: "safari", pageviews: 2 }],
  };
  const base = {
    siteId: "site",
    lastEventAt: null,
    days: 30,
    since: "2026-10-01",
    pageviews: 3,
    visitors: 2,
    events: 1,
    byDay: [],
    pages: [],
    named: [],
  };
  const decode = Schema.decodeUnknownSync(SiteAnalytics);
  expect(decode({ ...base, ...breakdowns })).toMatchObject(breakdowns);
  expect(decode(base)).toEqual(base);
  expect(() =>
    decode({ ...base, sources: [{ source: "x", medium: "", campaign: "", pageviews: -1 }] }),
  ).toThrow();
});

it.each([
  { ...site, url: "https://portfolio.example/page" },
  { ...site, origins: ["https://portfolio.example/page"] },
  { ...site, origins: ["https://other.example"] },
  { ...site, origins: [site.url, site.url] },
])("rejects invalid or ambiguous analytics origins before saving %j", (input) => {
  expect(isSite(input)).toBe(false);
});

it("accepts exact HTTPS origins and requires services to use an origin", () => {
  expect(isSite(site)).toBe(true);
  expect(
    isService({
      id: "api",
      name: "API",
      url: "https://api.example/healthz",
      active: true,
      kind: "api",
    }),
  ).toBe(false);
});
