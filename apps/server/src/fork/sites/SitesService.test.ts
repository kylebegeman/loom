import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { TestClock } from "effect/testing";
import { LibraryError, SitesError } from "@t3tools/contracts/fork";
import * as LibraryService from "../project-library/LibraryService.ts";
import * as SitesService from "./SitesService.ts";
import { LibraryConnectionService } from "../project-library/LibraryConnection.ts";

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

it.effect("returns attribution and audience breakdowns without discarding API fields", () => {
  const payload = {
    ...analytics,
    product: {
      events: 4,
      dailyInstallations: 3,
      lastEventAt: null,
      since: "2026-10-06",
      channel: "production",
      retentionDays: 90,
      byCommand: [],
      byPlatform: [],
      byDay: [{ day: "2026-11-05", events: 4, installations: 3 }],
      byEvent: [{ name: "project.created", outcome: "ok", count: 4, installations: 3 }],
      bySurface: [{ surface: "cli", count: 4 }],
      byVersion: [{ version: "1.0.12", count: 4 }],
      byFeatureGroup: [],
      byStack: [],
    },
    referrers: [{ referrer_host: "example.com", pageviews: 5 }],
    sources: [{ source: "x", medium: "social", campaign: "launch", pageviews: 4 }],
    countries: [{ country: "US", pageviews: 5 }],
    devices: [{ device: "mobile", pageviews: 3 }],
    browsers: [{ browser: "safari", pageviews: 3 }],
  };
  const f = fixture({ payload });
  return Effect.gen(function* () {
    const service = yield* SitesService.SitesService;
    expect(yield* service.analytics({ siteId: "portfolio" })).toEqual(payload);
  }).pipe(Effect.provide(f.layer));
});
function fixture(
  options: {
    env?: NodeJS.ProcessEnv;
    tokenStatus?: number;
    readStatus?: number;
    payload?: unknown;
    manager?: boolean;
    archived?: boolean;
    missing?: boolean;
    remote?: boolean;
    unavailable?: boolean;
    writeStatus?: number;
    writePayload?: unknown;
    dropWrite?: boolean;
  } = {},
) {
  const requests: Array<{
    url: string;
    method: string;
    authorization: string | undefined;
    headers: Readonly<Record<string, string>>;
  }> = [];
  const http = HttpClient.make((request) => {
    requests.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.authorization,
      headers: request.headers,
    });
    const token = request.url.endsWith("/token");
    const write = request.method === "PUT" || request.url.endsWith("/checks/run");
    if (write && options.dropWrite)
      return Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({ request }),
        }),
      );
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json(
          token
            ? { access_token: "private-reader-token", token_type: "Bearer", expires_in: 300 }
            : write
              ? (options.writePayload ?? options.payload ?? snapshot)
              : (options.payload ?? (request.url.endsWith("/analytics") ? analytics : snapshot)),
          {
            status: token
              ? (options.tokenStatus ?? 200)
              : write
                ? (options.writeStatus ?? options.readStatus ?? 200)
                : (options.readStatus ?? 200),
          },
        ),
      ),
    );
  });
  const layer = SitesService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(HttpClient.HttpClient, http),
        Layer.mock(LibraryConnectionService)({
          current: Effect.succeed(
            options.unavailable
              ? { kind: "unavailable" }
              : options.remote
                ? {
                    kind: "remote",
                    origin: "https://library.example.test",
                    credential: null,
                    endpoint: (path) => `https://library.example.test${path}`,
                    send: () => Effect.die("Use the managed connection"),
                  }
                : { kind: "authority" },
          ),
          send: (request) =>
            http
              .execute(
                HttpClientRequest.setUrl(
                  request,
                  new URL(request.url, "https://library.example.test").toString(),
                ),
              )
              .pipe(Effect.mapError((cause) => new LibraryError({ reason: "io", cause }))),
        }),
        Layer.mock(LibraryService.LibraryService, {
          project: ({ projectId }) =>
            options.missing
              ? Effect.fail(new LibraryError({ reason: "not-found" }))
              : Effect.succeed({
                  id: projectId,
                  title: "Project",
                  brief: "",
                  revision: 1,
                  resources: [],
                  archived: options.archived ?? false,
                  createdAt: "2026-10-17T00:00:00Z",
                  updatedAt: "2026-10-17T00:00:00Z",
                }),
        }),
        Layer.succeed(
          HostProcess.Environment,
          options.env ?? {
            LOOM_IDENTITY_ISSUER: "https://id.example.test",
            LOOM_SITES_API_ORIGIN: "https://api.example.test",
            LOOM_SITES_CLIENT_ID: "reader",
            LOOM_SITES_CLIENT_SECRET: "private-client-secret",
            ...(options.manager
              ? {
                  LOOM_SITES_MANAGER_CLIENT_ID: "manager",
                  LOOM_SITES_MANAGER_CLIENT_SECRET: "private-manager-secret",
                }
              : {}),
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
      expect(results[0]).toEqual({ configured: true, managementConfigured: false, snapshot });
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
    expect(yield* service.snapshot).toEqual({
      configured: false,
      managementConfigured: false,
      snapshot: null,
    });
    expect((yield* Effect.flip(service.analytics({ siteId: "portfolio" }))).stage).toBe(
      "configuration",
    );
    expect(f.requests).toHaveLength(0);
  }).pipe(Effect.provide(f.layer));
});
it.effect.each([
  {},
  {
    LOOM_IDENTITY_ISSUER: "https://local.example.test",
    LOOM_SITES_CLIENT_ID: "local-reader",
    LOOM_SITES_CLIENT_SECRET: "local-secret",
  },
])(
  "uses the enrolled Library for Sites reads regardless of local integration credentials",
  (env) => {
    const f = fixture({
      env,
      remote: true,
      payload: { configured: true, managementConfigured: true, snapshot },
    });
    return Effect.gen(function* () {
      const service = yield* SitesService.SitesService;
      expect(yield* service.snapshot).toEqual({
        configured: true,
        managementConfigured: true,
        snapshot,
      });
      expect(f.requests.map((r) => r.url)).toEqual([
        "https://library.example.test/api/loom/library/sites/read",
      ]);
      expect(f.requests.every((r) => r.authorization === undefined)).toBe(true);
    }).pipe(Effect.provide(f.layer));
  },
);
it.effect(
  "reads Library analytics and refuses unavailable enrollment without local fallback",
  () => {
    const f = fixture({ env: {}, remote: true, payload: analytics });
    return Effect.gen(function* () {
      const service = yield* SitesService.SitesService;
      expect(yield* service.analytics({ siteId: "portfolio" })).toEqual(analytics);
      const unavailable = fixture({ unavailable: true });
      yield* Effect.gen(function* () {
        const local = yield* SitesService.SitesService;
        expect((yield* Effect.flip(local.snapshot)).stage).toBe("library-connection");
        expect(unavailable.requests).toHaveLength(0);
      }).pipe(Effect.provide(Layer.fresh(unavailable.layer)));
    }).pipe(Effect.provide(f.layer));
  },
);
it.effect("blank reader secrets are unconfigured and never sent to the issuer", () => {
  const f = fixture({
    env: {
      LOOM_IDENTITY_ISSUER: "https://id.example.test",
      LOOM_SITES_CLIENT_ID: "reader",
      LOOM_SITES_CLIENT_SECRET: "   ",
    },
  });
  return Effect.gen(function* () {
    const service = yield* SitesService.SitesService;
    expect(yield* service.snapshot).toEqual({
      configured: false,
      managementConfigured: false,
      snapshot: null,
    });
    expect(f.requests).toHaveLength(0);
  }).pipe(Effect.provide(f.layer));
});
it.effect("blank manager secrets leave site management unavailable", () => {
  const f = fixture({
    env: {
      LOOM_IDENTITY_ISSUER: "https://id.example.test",
      LOOM_SITES_API_ORIGIN: "https://api.example.test",
      LOOM_SITES_CLIENT_ID: "reader",
      LOOM_SITES_CLIENT_SECRET: "reader-secret",
      LOOM_SITES_MANAGER_CLIENT_ID: "manager",
      LOOM_SITES_MANAGER_CLIENT_SECRET: "   ",
    },
  });
  return Effect.gen(function* () {
    const service = yield* SitesService.SitesService;
    expect((yield* service.snapshot).managementConfigured).toBe(false);
    expect((yield* Effect.flip(service.runChecks())).stage).toBe("configuration");
    expect(f.requests).toHaveLength(2);
  }).pipe(Effect.provide(f.layer));
});
it.effect.each([
  [
    "invalid issuer",
    {
      env: {
        LOOM_IDENTITY_ISSUER: "http://id.example.test",
        LOOM_SITES_API_ORIGIN: "https://api.example.test",
        LOOM_SITES_CLIENT_ID: "reader",
        LOOM_SITES_CLIENT_SECRET: "secret",
      },
    },
    "configuration",
  ],
  [
    "missing API origin",
    {
      env: {
        LOOM_IDENTITY_ISSUER: "https://id.example.test",
        LOOM_SITES_CLIENT_ID: "reader",
        LOOM_SITES_CLIENT_SECRET: "secret",
      },
    },
    "configuration",
  ],
  ["token refusal", { tokenStatus: 401 }, "authentication"],
  ["API refusal", { readStatus: 403 }, "permission"],
  ["API failure", { readStatus: 503 }, "read"],
  ["older Library", { env: {}, remote: true, readStatus: 404 }, "library-update"],
  ["Library sign-in refused", { env: {}, remote: true, readStatus: 401 }, "library-connection"],
  ["Library access refused", { env: {}, remote: true, readStatus: 403 }, "library-connection"],
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

const site = {
  id: "portfolio",
  name: "Portfolio",
  url: "https://portfolio.example",
  origins: ["https://portfolio.example"],
  serviceIds: [],
  projectIds: ["project-1"],
  active: true,
};
it.effect(
  "writes use a separate manager token, validate project ownership, and run checks without replay",
  () => {
    const f = fixture({ manager: true });
    return Effect.gen(function* () {
      const service = yield* SitesService.SitesService;
      yield* service.saveSite(site);
      yield* service.saveService({
        id: "api",
        name: "API",
        url: "https://api.example",
        kind: "api",
        active: true,
      });
      yield* service.saveCheck({
        id: "health",
        name: "Health",
        url: "https://api.example/healthz",
        service_id: "api",
        expected_status: 200,
        content: "ok",
        active: true,
      });
      yield* service.runChecks();
      expect(f.requests.filter((r) => r.method === "PUT").map((r) => r.url)).toEqual([
        "https://api.example.test/v1/integrations/sites/portfolio",
        "https://api.example.test/v1/integrations/sites/services/api",
        "https://api.example.test/v1/integrations/sites/checks/health",
      ]);
      expect(f.requests.filter((r) => r.url.endsWith("/checks/run"))).toHaveLength(1);
      expect(f.requests.filter((r) => r.url.endsWith("/token"))).toHaveLength(2);
    }).pipe(Effect.provide(f.layer));
  },
);
it.effect.each([
  ["missing manager", {}, "configuration"],
  ["missing project", { manager: true, missing: true }, "project"],
  ["API validation", { manager: true, writeStatus: 400 }, "validation"],
  ["API failure", { manager: true, writeStatus: 503 }, "unknown-outcome"],
] as const)("refuses %s", ([, options, stage]) => {
  const f = fixture(options);
  return Effect.gen(function* () {
    const service = yield* SitesService.SitesService;
    expect((yield* Effect.flip(service.saveSite(site))).stage).toBe(stage);
    if (stage === "project" || stage === "configuration") expect(f.requests).toHaveLength(0);
  }).pipe(Effect.provide(f.layer));
});
it.effect("rechecks authorization after token acquisition and never sends a refused write", () => {
  const f = fixture({ manager: true });
  return Effect.gen(function* () {
    const service = yield* SitesService.SitesService;
    yield* Effect.flip(service.saveSite(site, Effect.fail(new SitesError({ stage: "write" }))));
    expect(f.requests.every((request) => request.method !== "PUT")).toBe(true);
  }).pipe(Effect.provide(f.layer));
});

it.effect("archived projects retain their site associations and do not prevent pausing", () => {
  const f = fixture({ manager: true, archived: true });
  return Effect.gen(function* () {
    const service = yield* SitesService.SitesService;
    expect(yield* service.saveSite({ ...site, active: false })).toEqual(snapshot);
  }).pipe(Effect.provide(f.layer));
});

it.effect("forwards stale revisions and stable write identity without retrying a conflict", () => {
  const f = fixture({ manager: true, writeStatus: 412 });
  return Effect.gen(function* () {
    const service = yield* SitesService.SitesService;
    const error = yield* Effect.flip(
      service.saveSite({ ...site, requestId: "save-1", expectedEtag: '"old"' }),
    );
    expect(error.stage).toBe("revision-conflict");
    expect(error.requestId).toBe("save-1");
    const writes = f.requests.filter((r) => r.method === "PUT");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.headers).toMatchObject({
      "if-match": '"old"',
      "idempotency-key": "save-1",
    });
  }).pipe(Effect.provide(f.layer));
});
it.effect("protects creation from another surface claiming the same ID", () => {
  const f = fixture({ manager: true });
  return Effect.gen(function* () {
    const service = yield* SitesService.SitesService;
    yield* service.saveSite({ ...site, requestId: "create-1", expectedEtag: null });
    expect(f.requests.find((r) => r.method === "PUT")?.headers).toMatchObject({
      "if-none-match": "*",
      "idempotency-key": "create-1",
    });
  }).pipe(Effect.provide(f.layer));
});
it.effect.each([
  [401, "authentication"],
  [403, "permission"],
  [409, "unknown-outcome"],
  [412, "revision-conflict"],
  [428, "revision-required"],
  [422, "request-conflict"],
  [503, "unknown-outcome"],
] as const)(
  "separates write repair for HTTP %s and retains the original identity",
  ([writeStatus, stage]) => {
    const f = fixture({
      manager: true,
      writeStatus,
      ...(writeStatus === 422
        ? { writePayload: { error: { code: "idempotency_key_reused" } } }
        : {}),
    });
    return Effect.gen(function* () {
      const service = yield* SitesService.SitesService;
      const error = yield* Effect.flip(
        service.saveSite({ ...site, requestId: "original", expectedEtag: '"base"' }),
      );
      expect(error.stage).toBe(stage);
      expect(error.requestId).toBe("original");
      expect(f.requests.filter((r) => r.method === "PUT")).toHaveLength(1);
    }).pipe(Effect.provide(f.layer));
  },
);
it.effect("does not turn a committed write with an unreadable reply into a new request", () => {
  const f = fixture({ manager: true, writePayload: { invalid: true } });
  return Effect.gen(function* () {
    const service = yield* SitesService.SitesService;
    const error = yield* Effect.flip(
      service.saveSite({ ...site, requestId: "lost-reply", expectedEtag: '"base"' }),
    );
    expect(error.stage).toBe("unknown-outcome");
    expect(error.requestId).toBe("lost-reply");
    expect(f.requests.filter((r) => r.method === "PUT")).toHaveLength(1);
  }).pipe(Effect.provide(f.layer));
});

it.effect(
  "preserves identity when the API disconnects and refuses to infer a stale editor's revision",
  () => {
    const f = fixture({ manager: true, dropWrite: true });
    return Effect.gen(function* () {
      const service = yield* SitesService.SitesService;
      const error = yield* Effect.flip(
        service.saveSite({ ...site, requestId: "disconnect", expectedEtag: '"base"' }),
      );
      expect(error.stage).toBe("unknown-outcome");
      expect(error.requestId).toBe("disconnect");
      expect(f.requests.filter((r) => r.method === "PUT")).toHaveLength(1);
      const newer = fixture({
        manager: true,
        payload: { ...snapshot, sites: [{ ...site, active: 1, etag: '"newer"' }] },
      });
      yield* Effect.gen(function* () {
        const current = yield* SitesService.SitesService;
        expect(
          (yield* Effect.flip(current.saveSite({ ...site, requestId: "old-client" }))).stage,
        ).toBe("revision-required");
        expect(newer.requests.every((r) => r.method !== "PUT")).toBe(true);
      }).pipe(Effect.provide(Layer.fresh(newer.layer)));
    }).pipe(Effect.provide(f.layer));
  },
);
it.effect(
  "keeps legacy snapshots usable without manufacturing an ETag or dropping request identity",
  () => {
    const f = fixture({ manager: true, payload: { ...snapshot, sites: [{ ...site, active: 1 }] } });
    return Effect.gen(function* () {
      const service = yield* SitesService.SitesService;
      const state = yield* service.snapshot;
      expect(state.snapshot?.sites[0]?.etag).toBeUndefined();
      yield* service.saveSite({ ...site, requestId: "legacy-save" });
      const headers = f.requests.find((r) => r.method === "PUT")?.headers;
      expect(headers?.["idempotency-key"]).toBe("legacy-save");
      expect(headers?.["if-match"]).toBeUndefined();
      expect(headers?.["if-none-match"]).toBeUndefined();
      yield* service.runChecks(undefined, { requestId: "checks-run" });
      expect(
        f.requests.find((r) => r.url.endsWith("/checks/run"))?.headers["idempotency-key"],
      ).toBe("checks-run");
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect(
  "reads a check-run receipt with the manager and original identity without dispatching a run",
  () => {
    const receipt = { state: "completed", status: 200, body: snapshot };
    const f = fixture({ manager: true, payload: receipt });
    return Effect.gen(function* () {
      const service = yield* SitesService.SitesService;
      expect(yield* service.checkRunReceipt({ requestId: "original-run" })).toEqual(receipt);
      const request = f.requests.find((r) => r.url.endsWith("/checks/run/receipt"));
      expect(request).toMatchObject({
        method: "GET",
        headers: { "idempotency-key": "original-run" },
      });
      expect(f.requests.some((r) => r.url.endsWith("/checks/run"))).toBe(false);
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect.each([
  [404, "unavailable"],
  [401, "authentication"],
  [403, "permission"],
  [422, "request-conflict"],
] as const)("keeps receipt HTTP %s distinct from an absent operation", ([readStatus, expected]) => {
  const f = fixture({ manager: true, readStatus });
  return Effect.gen(function* () {
    const service = yield* SitesService.SitesService;
    if (readStatus === 404)
      expect(yield* service.checkRunReceipt({ requestId: "original" })).toEqual({
        state: expected,
      });
    else
      expect(yield* Effect.flip(service.checkRunReceipt({ requestId: "original" }))).toMatchObject({
        stage: expected,
        requestId: "original",
      });
    expect(f.requests.some((r) => r.url.endsWith("/checks/run"))).toBe(false);
  }).pipe(Effect.provide(f.layer));
});
it.effect(
  "forwards receipt reads through the enrolled Library without local Sites credentials",
  () => {
    const receipt = { state: "pending" };
    const f = fixture({ remote: true, env: {}, payload: receipt });
    return Effect.gen(function* () {
      const service = yield* SitesService.SitesService;
      expect(yield* service.checkRunReceipt({ requestId: "original" })).toEqual(receipt);
      expect(f.requests.map((r) => [r.method, r.url])).toEqual([
        ["POST", "https://library.example.test/api/loom/library/sites/read"],
      ]);
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect.each(["authentication", "permission", "request-conflict"] as const)(
  "retains %s repair when a receipt is read through the Library",
  (stage) => {
    const f = fixture({
      remote: true,
      env: {},
      readStatus: 503,
      payload: { sitesError: { stage, requestId: "original" } },
    });
    return Effect.gen(function* () {
      const service = yield* SitesService.SitesService;
      expect(yield* Effect.flip(service.checkRunReceipt({ requestId: "original" }))).toMatchObject({
        stage,
        requestId: "original",
      });
      expect(f.requests).toHaveLength(1);
    }).pipe(Effect.provide(f.layer));
  },
);
