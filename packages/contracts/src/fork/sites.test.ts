import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import fixture from "./fixtures/begamin-sites.json" with { type: "json" };
import { SaveSiteRequest, SaveSiteServiceRequest, SiteAnalytics, SitesSnapshot } from "./sites.ts";

const isSite = Schema.is(SaveSiteRequest);
const isService = Schema.is(SaveSiteServiceRequest);
const decodeSnapshot = Schema.decodeUnknownSync(SitesSnapshot);
const decodeAnalytics = Schema.decodeUnknownSync(SiteAnalytics);

const site = {
  id: "portfolio",
  name: "Portfolio",
  url: "https://portfolio.example",
  active: true,
  origins: ["https://portfolio.example"],
  serviceIds: [],
  projectIds: ["project-1"],
};

const legacySnapshot = {
  schemaVersion: 1,
  primarySiteId: "portfolio",
  observedAt: "2026-11-01T12:00:00Z",
  staleAfterSeconds: 300,
  sites: [],
  services: [],
  checks: [],
};

it("preserves Sites ETags across the typed transport", () => {
  const body = fixture.responses["sites-list"].body;
  const decoded = decodeSnapshot(body);
  expect(decoded).toEqual({
    ...body,
    checks: body.checks.map(({ revision: _revision, updated_at: _updatedAt, ...check }) => check),
  });
  expect(decoded.ownerAdmin).toEqual(body.ownerAdmin);
});

it("preserves the full canonical analytics response and populated breakdowns", () => {
  const body = fixture.responses["site-analytics"].body;
  expect(decodeAnalytics(body)).toEqual(body);
  for (const rows of [
    body.byDay,
    body.pages,
    body.named,
    body.referrers,
    body.sources,
    body.countries,
    body.devices,
    body.browsers,
  ]) {
    expect(rows.length).toBeGreaterThan(0);
  }
});

it("keeps service admin routing optional for older servers", () => {
  expect(decodeSnapshot(legacySnapshot)).toEqual(legacySnapshot);
  const withAdmin = {
    ...legacySnapshot,
    ownerAdmin: { name: "Personal API", url: "https://api.example/admin" },
  };
  expect(decodeSnapshot(withAdmin)).toEqual(withAdmin);
});

it.each([
  "http://api.example/admin",
  "https://user:secret@api.example/admin",
  "https://user@api.example/admin",
  "javascript:alert(1)",
  "/admin",
])("rejects unsafe service admin URL %s", (url) => {
  expect(() =>
    decodeSnapshot({
      ...legacySnapshot,
      ownerAdmin: { name: "Personal API", url },
    }),
  ).toThrow();
});

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
  expect(decodeAnalytics({ ...base, ...breakdowns })).toMatchObject(breakdowns);
  expect(decodeAnalytics(base)).toEqual(base);
  expect(() =>
    decodeAnalytics({
      ...base,
      sources: [{ source: "x", medium: "", campaign: "", pageviews: -1 }],
    }),
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

it("validates write identity and strong revision preconditions without requiring new fields from old clients", () => {
  expect(isSite({ ...site, requestId: "save-1", expectedEtag: '"revision-1"' })).toBe(true);
  expect(isSite({ ...site, requestId: "create-1", expectedEtag: null })).toBe(true);
  for (const requestId of ["", "bad\nheader", "valid\n", "x".repeat(256)]) {
    expect(isSite({ ...site, requestId })).toBe(false);
  }
  for (const expectedEtag of ["*", 'W/"weak"', "unquoted", '"one", "two"', '"tag"\n']) {
    expect(isSite({ ...site, expectedEtag })).toBe(false);
  }
});
