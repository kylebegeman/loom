import { describe, expect, it } from "vite-plus/test";
import type { SitesSnapshot } from "@t3tools/contracts/fork";
import {
  checkExpectation,
  checkIssues,
  checkProblem,
  checkVitals,
  orderChecksForAttention,
  orderServicesForAttention,
  siteFaviconUrl,
  siteLastChecked,
} from "./SiteHealth";

type Check = SitesSnapshot["checks"][number];
type Service = SitesSnapshot["services"][number];

const NOW = Date.parse("2026-10-23T12:00:00.000Z");
const STALE_AFTER = 600;
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const daysFromNow = (days: number) => new Date(NOW + days * 86_400_000 + 60_000).toISOString();

function check(id: string, overrides: Partial<Check> = {}): Check {
  return {
    id,
    service_id: "web",
    name: id,
    url: `https://example.com/${id}`,
    active: 1,
    state: "healthy",
    last: {
      checked_at: minutesAgo(1),
      ok: 1,
      status: 200,
      duration_ms: 120,
      tls_expires_at: daysFromNow(60),
      error: null,
    },
    ...overrides,
  };
}

const failed = (overrides: Partial<NonNullable<Check["last"]>> = {}): Check["last"] => ({
  checked_at: minutesAgo(1),
  ok: 0,
  status: 503,
  duration_ms: 900,
  tls_expires_at: daysFromNow(60),
  error: null,
  ...overrides,
});

const service = (id: string, name: string, active: 0 | 1 = 1): Service => ({
  id,
  name,
  url: `https://${id}.example.com`,
  active,
  kind: "website",
});

describe("orderChecksForAttention", () => {
  it("puts failures first, then stale, unchecked, healthy and paused, by name within each", () => {
    const checks = [
      check("paused", { state: "disabled" }),
      check("b-ok"),
      check("waiting", { state: "unknown", last: null }),
      check("old", { last: { ...check("x").last!, checked_at: minutesAgo(30) } }),
      check("a-ok"),
      check("down", { state: "failing", last: failed() }),
    ];
    expect(orderChecksForAttention(checks, STALE_AFTER, NOW).map((entry) => entry.id)).toEqual([
      "down",
      "old",
      "waiting",
      "a-ok",
      "b-ok",
      "paused",
    ]);
  });

  it("sorts numbered names the way people count", () => {
    const checks = [check("Page 10"), check("page 9")];
    expect(orderChecksForAttention(checks, STALE_AFTER, NOW).map((entry) => entry.id)).toEqual([
      "page 9",
      "Page 10",
    ]);
  });
});

describe("orderServicesForAttention", () => {
  it("leads with a service holding a failing check and sinks paused ones", () => {
    const snapshot = {
      staleAfterSeconds: STALE_AFTER,
      checks: [
        check("api-down", { service_id: "api", state: "failing", last: failed() }),
        check("web-ok", { service_id: "web" }),
        check("old-ok", { service_id: "old" }),
      ],
    };
    const services = [
      service("old", "Archive", 0),
      service("web", "Website"),
      service("api", "API"),
      service("empty", "Docs"),
    ];
    expect(orderServicesForAttention(services, snapshot, NOW).map((entry) => entry.id)).toEqual([
      "api",
      "empty",
      "web",
      "old",
    ]);
  });
});

describe("siteLastChecked", () => {
  it("is the newest result across the checks, ignoring ones never run", () => {
    expect(
      siteLastChecked([
        check("a", { last: { ...check("x").last!, checked_at: minutesAgo(20) } }),
        check("b", { last: null }),
        check("c", { last: { ...check("x").last!, checked_at: minutesAgo(3) } }),
      ]),
    ).toBe(minutesAgo(3));
  });

  it("is null until any check has reported", () => {
    expect(siteLastChecked([check("a", { last: null })])).toBeNull();
    expect(siteLastChecked([])).toBeNull();
  });
});

describe("checkProblem", () => {
  it("prefers the error the check recorded", () => {
    const entry = check("a", { state: "failing", last: failed({ error: "TLS handshake failed" }) });
    expect(checkProblem(entry, "failing")).toBe("TLS handshake failed");
  });

  it("names a missing answer and a wrong status", () => {
    expect(checkProblem(check("a", { last: failed({ status: null }) }), "failing")).toBe(
      "No answer.",
    );
    expect(
      checkProblem(check("a", { expected_status: 301, last: failed({ status: 200 }) }), "failing"),
    ).toBe("Answered 200, expected 301.");
  });

  it("blames the expected text when the status matched", () => {
    const entry = check("a", { content: "Welcome", last: failed({ status: 200 }) });
    expect(checkProblem(entry, "failing")).toBe("Answered 200 without “Welcome”.");
  });

  it("says nothing for a passing, paused or never run check", () => {
    expect(checkProblem(check("a"), "healthy")).toBeNull();
    expect(checkProblem(check("a", { last: failed() }), "disabled")).toBeNull();
    expect(checkProblem(check("a", { last: null }), "unknown")).toBeNull();
  });
});

describe("checkExpectation", () => {
  it("reads the expected status and text", () => {
    expect(checkExpectation(check("a"))).toBe("Expects 200");
    expect(checkExpectation(check("a", { expected_status: 204, content: "ok" }))).toBe(
      "Expects 204 with “ok”",
    );
  });
});

describe("checkIssues", () => {
  it("lists failures, stale results and expiring certificates, once per check, worst first", () => {
    const issues = checkIssues(
      [
        check("fine"),
        check("expiring", {
          last: { ...check("x").last!, tls_expires_at: daysFromNow(3) },
        }),
        check("old", { last: { ...check("x").last!, checked_at: minutesAgo(120) } }),
        check("down", {
          state: "failing",
          last: failed({ tls_expires_at: daysFromNow(1) }),
        }),
        check("paused", { state: "disabled", last: failed() }),
      ],
      STALE_AFTER,
      NOW,
    );
    expect(issues.map((issue) => [issue.check.id, issue.tone, issue.problem])).toEqual([
      ["down", "danger", "Answered 503, expected 200."],
      ["old", "warning", "Last result 2h ago."],
      ["expiring", "warning", "Certificate expires in 3 days."],
    ]);
  });

  it("calls an expired certificate on a passing check dangerous", () => {
    const issues = checkIssues(
      [check("a", { last: { ...check("x").last!, tls_expires_at: daysFromNow(-2) } })],
      STALE_AFTER,
      NOW,
    );
    expect(issues).toEqual([
      expect.objectContaining({ tone: "danger", problem: "Certificate expired." }),
    ]);
  });
});

describe("checkVitals", () => {
  it("reports the slowest answer and the soonest certificate, skipping paused checks", () => {
    const soon = daysFromNow(5);
    const vitals = checkVitals(
      [
        check("a", { last: { ...check("x").last!, duration_ms: 300 } }),
        check("b", { last: { ...check("x").last!, duration_ms: 80, tls_expires_at: soon } }),
        check("c", { state: "disabled", last: { ...check("x").last!, duration_ms: 9000 } }),
      ],
      NOW,
    );
    expect(vitals).toEqual({ slowest: 300, certificate: 5, certificateExpiresAt: soon });
  });
});

describe("siteFaviconUrl", () => {
  it("asks the site's origin for its icon", () => {
    expect(siteFaviconUrl("https://pages.bagels.top/blog?x=1")).toBe(
      "https://pages.bagels.top/favicon.ico",
    );
  });

  it("asks nothing of an address that is not on the web", () => {
    expect(siteFaviconUrl("javascript:alert(1)")).toBeNull();
    expect(siteFaviconUrl("not a url")).toBeNull();
  });
});
