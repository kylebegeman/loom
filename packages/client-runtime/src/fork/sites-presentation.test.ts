import { expect, it } from "vite-plus/test";
import { siteCheckState } from "./sites-presentation.ts";
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
