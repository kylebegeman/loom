import {
  SaveSiteRequest,
  SaveSiteServiceRequest,
  SaveSiteCheckRequest,
  SiteAnalytics,
  SiteId,
  SitesError,
  SitesSnapshot,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ByteSize from "effect/ByteSize";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as LibraryService from "../project-library/LibraryService.ts";

export class SitesService extends Context.Service<
  SitesService,
  {
    readonly snapshot: Effect.Effect<
      {
        readonly configured: boolean;
        readonly managementConfigured: boolean;
        readonly snapshot: SitesSnapshot | null;
      },
      SitesError
    >;
    readonly saveSite: (
      input: SaveSiteRequest,
      authorize?: Effect.Effect<void, SitesError>,
    ) => Effect.Effect<SitesSnapshot, SitesError>;
    readonly saveService: (
      input: SaveSiteServiceRequest,
      authorize?: Effect.Effect<void, SitesError>,
    ) => Effect.Effect<SitesSnapshot, SitesError>;
    readonly saveCheck: (
      input: SaveSiteCheckRequest,
      authorize?: Effect.Effect<void, SitesError>,
    ) => Effect.Effect<SitesSnapshot, SitesError>;
    readonly runChecks: (
      authorize?: Effect.Effect<void, SitesError>,
    ) => Effect.Effect<SitesSnapshot, SitesError>;
    readonly analytics: (input: {
      readonly siteId: string;
    }) => Effect.Effect<SiteAnalytics, SitesError>;
  }
>()("t3/fork/sites/SitesService") {}

const decodeSaveSiteRequest = Schema.decodeUnknownEffect(SaveSiteRequest);
const decodeSaveSiteServiceRequest = Schema.decodeUnknownEffect(SaveSiteServiceRequest);
const decodeSaveSiteCheckRequest = Schema.decodeUnknownEffect(SaveSiteCheckRequest);
const decodeSiteId = Schema.decodeEffect(SiteId);
const Token = Schema.Struct({
  access_token: Schema.String.check(Schema.isMinLength(1)),
  token_type: Schema.String.check(Schema.makeFilter((value) => value.toLowerCase() === "bearer")),
  expires_in: Schema.Number.check(Schema.isGreaterThan(0)),
});
const make = Effect.gen(function* () {
  const env = yield* HostProcess.Environment;
  const http = yield* HttpClient.HttpClient;
  const library = yield* LibraryService.LibraryService;
  const noRedirects = Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" });
  const api = env.LOOM_SITES_API_ORIGIN?.trim() || "https://api.begam.in";
  const issuer = env.LOOM_IDENTITY_ISSUER?.trim();
  const id = env.LOOM_SITES_CLIENT_ID?.trim();
  const secret = env.LOOM_SITES_CLIENT_SECRET
    ? Redacted.make(env.LOOM_SITES_CLIENT_SECRET.trim())
    : null;
  const managerId = env.LOOM_SITES_MANAGER_CLIENT_ID?.trim();
  const managerSecret = env.LOOM_SITES_MANAGER_CLIENT_SECRET
    ? Redacted.make(env.LOOM_SITES_MANAGER_CLIENT_SECRET.trim())
    : null;
  const configured = Boolean(id && secret && issuer);
  const managementConfigured = Boolean(
    configured && managerId && managerSecret && managerId !== id,
  );
  const validOrigin = (value: string) => {
    try {
      const u = new URL(value);
      return u.protocol === "https:" && u.origin === value && !u.username && !u.password;
    } catch {
      return false;
    }
  };
  const configurationValid = configured && validOrigin(api) && validOrigin(issuer!);
  const lock = yield* Semaphore.make(1);
  const cached = new Map<boolean, { value: Redacted.Redacted<string>; expiresAt: number }>();
  const token = (write = false) =>
    Effect.gen(function* () {
      if (!configurationValid || (write && !managementConfigured))
        return yield* new SitesError({ stage: "configuration" });
      const now = yield* Clock.currentTimeMillis;
      const entry = cached.get(write);
      if (entry && entry.expiresAt > now + 30_000) return entry.value;
      cached.delete(write);
      const response = yield* http
        .execute(
          HttpClientRequest.post(`${issuer}/api/oidc/token`).pipe(
            HttpClientRequest.bodyUrlParams({
              grant_type: "client_credentials",
              client_id: write ? managerId! : id!,
              client_secret: Redacted.value(write ? managerSecret! : secret!),
              resource: api,
              scope: write ? "sites:write" : "sites:read",
            }),
          ),
        )
        .pipe(
          noRedirects,
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(Token)),
          Effect.timeout("15 seconds"),
          Effect.mapError((cause) => new SitesError({ stage: "authentication", cause })),
        );
      const fresh = {
        value: Redacted.make(response.access_token),
        expiresAt: now + Math.min(response.expires_in, 300) * 1000,
      };
      cached.set(write, fresh);
      return fresh.value;
    }).pipe(lock.withPermit);
  const read = <A, I>(path: string, schema: Schema.Codec<A, I>) =>
    Effect.gen(function* () {
      const credential = yield* token();
      const response = yield* http
        .execute(
          HttpClientRequest.get(`${api}${path}`).pipe(HttpClientRequest.bearerToken(credential)),
        )
        .pipe(
          noRedirects,
          Effect.timeout("15 seconds"),
          Effect.mapError((cause) => new SitesError({ stage: "read", cause })),
        );
      if (response.status === 401 || response.status === 403) {
        cached.delete(false);
        return yield* new SitesError({ stage: "authentication" });
      }
      return yield* HttpClientResponse.filterStatusOk(response).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(schema)),
        Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(2)),
        Effect.timeout("15 seconds"),
        Effect.mapError((cause) => new SitesError({ stage: "read", cause })),
      );
    });
  const write = Effect.fn("SitesService.write")(function* (
    path: string,
    input: unknown,
    authorize: Effect.Effect<void, SitesError> = Effect.void,
  ): Effect.fn.Return<SitesSnapshot, SitesError> {
    const credential = yield* token(true);
    yield* authorize;
    const request =
      input === undefined
        ? HttpClientRequest.post(`${api}${path}`)
        : yield* HttpClientRequest.put(`${api}${path}`).pipe(
            HttpClientRequest.bodyJson(input),
            Effect.mapError((cause) => new SitesError({ stage: "validation", cause })),
          );
    const response = yield* http
      .execute(request.pipe(HttpClientRequest.bearerToken(credential)))
      .pipe(
        noRedirects,
        Effect.timeout("90 seconds"),
        Effect.mapError((cause) => new SitesError({ stage: "write", cause })),
      );
    if (response.status === 401 || response.status === 403) {
      cached.delete(true);
      return yield* new SitesError({ stage: "authentication" });
    }
    if (response.status === 400) return yield* new SitesError({ stage: "validation" });
    return yield* HttpClientResponse.filterStatusOk(response).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(SitesSnapshot)),
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(2)),
      Effect.timeout("15 seconds"),
      Effect.mapError((cause) => new SitesError({ stage: "write", cause })),
    );
  });
  return SitesService.of({
    saveSite: Effect.fn("SitesService.saveSite")(function* (raw, authorize) {
      const input = yield* decodeSaveSiteRequest(raw).pipe(
        Effect.mapError((cause) => new SitesError({ stage: "validation", cause })),
      );
      for (const projectId of input.projectIds) {
        yield* library
          .project({ projectId })
          .pipe(Effect.mapError((cause) => new SitesError({ stage: "project", cause })));
      }
      return yield* write(
        `/v1/integrations/sites/${encodeURIComponent(input.id)}`,
        input,
        authorize,
      );
    }),
    saveService: Effect.fn("SitesService.saveService")(function* (raw, authorize) {
      const input = yield* decodeSaveSiteServiceRequest(raw).pipe(
        Effect.mapError((cause) => new SitesError({ stage: "validation", cause })),
      );
      return yield* write(
        `/v1/integrations/sites/services/${encodeURIComponent(input.id)}`,
        input,
        authorize,
      );
    }),
    saveCheck: Effect.fn("SitesService.saveCheck")(function* (raw, authorize) {
      const input = yield* decodeSaveSiteCheckRequest(raw).pipe(
        Effect.mapError((cause) => new SitesError({ stage: "validation", cause })),
      );
      return yield* write(
        `/v1/integrations/sites/checks/${encodeURIComponent(input.id)}`,
        input,
        authorize,
      );
    }),
    runChecks: (authorize) => write("/v1/integrations/sites/checks/run", undefined, authorize),
    snapshot: configured
      ? read("/v1/integrations/sites", SitesSnapshot).pipe(
          Effect.map((snapshot) => ({ configured: true, managementConfigured, snapshot })),
        )
      : Effect.succeed({ configured: false, managementConfigured: false, snapshot: null }),
    analytics: (input) =>
      Effect.gen(function* () {
        const siteId = yield* decodeSiteId(input.siteId).pipe(
          Effect.mapError((cause) => new SitesError({ stage: "read", cause })),
        );
        const result = yield* read(
          `/v1/integrations/sites/${encodeURIComponent(siteId)}/analytics`,
          SiteAnalytics,
        );
        if (result.siteId !== siteId) return yield* new SitesError({ stage: "read" });
        return result;
      }),
  });
});
export const layer = Layer.effect(SitesService, make);
