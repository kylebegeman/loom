import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { TestClock } from "effect/testing";
import * as SitesService from "./SitesService.ts";

const snapshot = {
  schemaVersion: 1,
  primarySiteId: "portfolio",
  observedAt: "2026-10-17T00:00:00Z",
  staleAfterSeconds: 900,
  sites: [],
  services: [],
  checks: [],
};
const analytics = {
  siteId: "portfolio",
  lastEventAt: null,
  days: 30,
  since: "2026-09-18",
  pageviews: 0,
  visitors: 0,
  events: 0,
  byDay: [],
  pages: [],
  named: [],
};
function fixture(
  options: {
    env?: NodeJS.ProcessEnv;
    tokenStatus?: number;
    readStatus?: number;
    payload?: unknown;
  } = {},
) {
  const requests: Array<{ url: string; authorization: string | undefined }> = [];
  const http = HttpClient.make((request) => {
    requests.push({ url: request.url, authorization: request.headers.authorization });
    const token = request.url.endsWith("/token");
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json(
          token
            ? { access_token: "private-reader-token", token_type: "Bearer", expires_in: 300 }
            : (options.payload ?? (request.url.endsWith("/analytics") ? analytics : snapshot)),
          { status: token ? (options.tokenStatus ?? 200) : (options.readStatus ?? 200) },
        ),
      ),
    );
  });
  const layer = SitesService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(HttpClient.HttpClient, http),
        Layer.succeed(
          HostProcess.Environment,
          options.env ?? {
            LOOM_IDENTITY_ISSUER: "https://id.example.test",
            LOOM_SITES_CLIENT_ID: "reader",
            LOOM_SITES_CLIENT_SECRET: "private-client-secret",
          },
        ),
      ),
    ),
  );
  return { requests, layer };
}
it.effect(
  "keeps credentials on the server, shares short-lived tokens, and renews before expiry",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      const service = yield* SitesService.SitesService;
      const results = yield* Effect.all([service.snapshot, service.snapshot], {
        concurrency: "unbounded",
      });
      expect(results[0]).toEqual({ configured: true, snapshot });
      expect(f.requests.filter((r) => r.url.endsWith("/token"))).toHaveLength(1);
      expect(
        f.requests
          .filter((r) => !r.url.endsWith("/token"))
          .every((r) => r.authorization === "Bearer private-reader-token"),
      ).toBe(true);
      yield* TestClock.adjust("271 seconds");
      expect(yield* service.analytics({ siteId: "portfolio" })).toEqual(analytics);
      expect(f.requests.filter((r) => r.url.endsWith("/token"))).toHaveLength(2);
      expect(JSON.stringify(results)).not.toContain("private-");
    }).pipe(Effect.provide(f.layer));
  },
);
it.effect("unconfigured servers remain usable and perform no external reads", () => {
  const f = fixture({ env: {} });
  return Effect.gen(function* () {
    const service = yield* SitesService.SitesService;
    expect(yield* service.snapshot).toEqual({ configured: false, snapshot: null });
    expect((yield* Effect.flip(service.analytics({ siteId: "portfolio" }))).stage).toBe(
      "configuration",
    );
    expect(f.requests).toHaveLength(0);
  }).pipe(Effect.provide(f.layer));
});
it.effect.each([
  [
    "invalid issuer",
    {
      env: {
        LOOM_IDENTITY_ISSUER: "http://id.example.test",
        LOOM_SITES_CLIENT_ID: "reader",
        LOOM_SITES_CLIENT_SECRET: "secret",
      },
    },
    "configuration",
  ],
  ["token refusal", { tokenStatus: 401 }, "authentication"],
  ["API refusal", { readStatus: 403 }, "authentication"],
  ["API failure", { readStatus: 503 }, "read"],
  ["invalid response", { payload: { sites: [] } }, "read"],
] as const)("handles %s without exposing credentials", ([, options, stage]) => {
  const f = fixture(options);
  return Effect.gen(function* () {
    const service = yield* SitesService.SitesService;
    const error = yield* Effect.flip(service.snapshot);
    expect(error.stage).toBe(stage);
    expect(error.message).not.toContain("private-");
  }).pipe(Effect.provide(f.layer));
});
it.effect("refuses path injection and mismatched analytics without mixing sites", () => {
  const f = fixture({ payload: { ...analytics, siteId: "other-site" } });
  return Effect.gen(function* () {
    const service = yield* SitesService.SitesService;
    expect((yield* Effect.flip(service.analytics({ siteId: "../admin" }))).stage).toBe("read");
    expect(f.requests).toHaveLength(0);
    expect((yield* Effect.flip(service.analytics({ siteId: "portfolio" }))).stage).toBe("read");
  }).pipe(Effect.provide(f.layer));
});
