import { expect, it } from "vite-plus/test";
import {
  siteCheckState,
  siteChecksHealth,
  siteTlsDaysLeft,
  siteTrafficDays,
  siteTrafficRatios,
  siteTrafficBreakdowns,
} from "./sites-presentation.ts";
const check = {
  id: "check",
  service_id: "api",
  name: "API",
  url: "https://api.example.test",
  active: 1 as const,
  state: "healthy" as const,
  last: {
    checked_at: "2026-10-17T00:00:00Z",
    ok: 1 as const,
    status: 200,
    duration_ms: 1,
    tls_expires_at: null,
    error: null,
  },
};
it("ages cached healthy checks without showing offline data as current", () => {
  expect(siteCheckState(check, 900, Date.parse("2026-10-17T00:10:00Z"))).toBe("healthy");
  expect(siteCheckState(check, 900, Date.parse("2026-10-17T00:16:00Z"))).toBe("stale");
  expect(
    siteCheckState({ ...check, state: "disabled" }, 900, Date.parse("2026-10-18T00:00:00Z")),
  ).toBe("disabled");
  expect(siteCheckState({ ...check, last: null }, 900, Date.parse("2026-10-18T00:00:00Z"))).toBe(
    "unknown",
  );
});

it("labels ratios as daily visitor and action activity without treating them as conversion rates", () => {
  expect(siteTrafficRatios({ pageviews: 10, visitors: 4, events: 15 })).toEqual({
    viewsPerVisitor: 2.5,
    actionsPerHundredViews: 150,
  });
  expect(siteTrafficRatios({ pageviews: 0, visitors: 0, events: 3 })).toEqual({
    viewsPerVisitor: null,
    actionsPerHundredViews: null,
  });
});

it("keeps campaign dimensions distinct and separates absent from empty breakdowns", () => {
  const base = {
    siteId: "site",
    lastEventAt: null,
    days: 30,
    since: "2026-10-01",
    pageviews: 4,
    visitors: 2,
    events: 1,
    byDay: [],
    pages: [],
    named: [],
  };
  expect(siteTrafficBreakdowns(base).every((group) => !group.available)).toBe(true);
  const groups = siteTrafficBreakdowns({
    ...base,
    referrers: [],
    sources: [
      { source: "x", medium: "social", campaign: "launch", pageviews: 2 },
      { source: "email", medium: "", campaign: "launch", pageviews: 1 },
    ],
    countries: [{ country: "", pageviews: 1 }],
  });
  expect(groups[0]?.available).toBe(true);
  expect(groups[0]?.rows).toEqual([]);
  expect(new Set(groups[1]?.rows.map((row) => row.key)).size).toBe(2);
  expect(groups[1]?.rows[1]?.detail).toContain("Medium: not set");
  expect(groups[2]?.rows[0]?.label).toBe("Unknown country");
});

it("reports the worst live state across checks and leaves paused checks out", () => {
  const now = Date.parse("2026-10-17T00:05:00Z");
  const failing = { ...check, id: "down", state: "failing" as const };
  const paused = { ...check, id: "off", state: "disabled" as const };
  expect(siteChecksHealth([check, paused], 900, now)).toEqual({
    state: "healthy",
    total: 1,
    passing: 1,
    failing: 0,
  });
  expect(siteChecksHealth([check, failing], 900, now).state).toBe("failing");
  expect(siteChecksHealth([check], 900, Date.parse("2026-10-18T00:00:00Z")).state).toBe("stale");
  expect(siteChecksHealth([{ ...check, last: null }], 900, now).state).toBe("unchecked");
  expect(siteChecksHealth([paused], 900, now).state).toBe("unmonitored");
  expect(siteChecksHealth([failing], 900, now, true).state).toBe("paused");
});

it("fills quiet days across the whole analytics window", () => {
  const days = siteTrafficDays({
    since: "2026-10-01",
    days: 3,
    byDay: [{ day: "2026-10-02", pageviews: 4, visitors: 2 }],
  });
  expect(days).toEqual([
    { day: "2026-10-01", pageviews: 0, visitors: 0 },
    { day: "2026-10-02", pageviews: 4, visitors: 2 },
    { day: "2026-10-03", pageviews: 0, visitors: 0 },
  ]);
});

it("counts whole days left on a certificate", () => {
  const now = Date.parse("2026-10-17T00:00:00Z");
  expect(siteTlsDaysLeft("2026-10-27T12:00:00Z", now)).toBe(10);
  expect(siteTlsDaysLeft("2026-10-16T00:00:00Z", now)).toBe(-1);
  expect(siteTlsDaysLeft(null, now)).toBeNull();
});
