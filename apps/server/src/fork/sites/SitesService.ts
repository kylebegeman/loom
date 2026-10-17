import { SiteAnalytics, SiteId, SitesError, SitesSnapshot } from "@t3tools/contracts/fork";
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

export class SitesService extends Context.Service<
  SitesService,
  {
    readonly snapshot: Effect.Effect<
      { readonly configured: boolean; readonly snapshot: SitesSnapshot | null },
      SitesError
    >;
    readonly analytics: (input: {
      readonly siteId: string;
    }) => Effect.Effect<SiteAnalytics, SitesError>;
  }
>()("t3/fork/sites/SitesService") {}

const decodeSiteId = Schema.decodeEffect(SiteId);
const Token = Schema.Struct({
  access_token: Schema.String.check(Schema.isMinLength(1)),
  token_type: Schema.String.check(Schema.makeFilter((value) => value.toLowerCase() === "bearer")),
  expires_in: Schema.Number.check(Schema.isGreaterThan(0)),
});
const make = Effect.gen(function* () {
  const env = yield* HostProcess.Environment;
  const http = yield* HttpClient.HttpClient;
  const noRedirects = Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" });
  const api = env.LOOM_SITES_API_ORIGIN?.trim() || "https://api.begam.in";
  const issuer = env.LOOM_IDENTITY_ISSUER?.trim();
  const id = env.LOOM_SITES_CLIENT_ID?.trim();
  const secret = env.LOOM_SITES_CLIENT_SECRET
    ? Redacted.make(env.LOOM_SITES_CLIENT_SECRET.trim())
    : null;
  const configured = Boolean(id && secret && issuer);
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
  let cached: { value: Redacted.Redacted<string>; expiresAt: number } | null = null;
  const token = Effect.gen(function* () {
    if (!configurationValid) return yield* new SitesError({ stage: "configuration" });
    const now = yield* Clock.currentTimeMillis;
    if (cached && cached.expiresAt > now + 30_000) return cached.value;
    cached = null;
    const response = yield* http
      .execute(
        HttpClientRequest.post(`${issuer}/api/oidc/token`).pipe(
          HttpClientRequest.bodyUrlParams({
            grant_type: "client_credentials",
            client_id: id!,
            client_secret: Redacted.value(secret!),
            resource: api,
            scope: "sites:read",
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
    cached = {
      value: Redacted.make(response.access_token),
      expiresAt: now + Math.min(response.expires_in, 300) * 1000,
    };
    return cached.value;
  }).pipe(lock.withPermit);
  const read = <A, I>(path: string, schema: Schema.Codec<A, I>) =>
    Effect.gen(function* () {
      const credential = yield* token;
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
        cached = null;
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
  return SitesService.of({
    snapshot: configured
      ? read("/v1/integrations/sites", SitesSnapshot).pipe(
          Effect.map((snapshot) => ({ configured: true, snapshot })),
        )
      : Effect.succeed({ configured: false, snapshot: null }),
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
