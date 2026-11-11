import {
  SaveSiteRequest,
  RunSiteChecksRequest,
  SaveSiteServiceRequest,
  SaveSiteCheckRequest,
  SiteAnalytics,
  SiteId,
  SitesError,
  SitesSnapshot,
  SiteChecksRunReceipt,
  SiteChecksRunReceiptRequest,
  SitesState,
  LibrarySitesRead,
  LIBRARY_SITES_READ_ROUTE,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ByteSize from "effect/ByteSize";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import * as SecureRandom from "effect/crypto/SecureRandom";
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

import { LibraryConnectionService } from "../project-library/LibraryConnection.ts";
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
      input?: RunSiteChecksRequest,
    ) => Effect.Effect<SitesSnapshot, SitesError>;
    readonly checkRunReceipt: (
      input: SiteChecksRunReceiptRequest,
    ) => Effect.Effect<SiteChecksRunReceipt, SitesError>;
    readonly analytics: (input: {
      readonly siteId: string;
    }) => Effect.Effect<SiteAnalytics, SitesError>;
  }
>()("t3/fork/sites/SitesService") {}

const decodeSaveSiteRequest = Schema.decodeUnknownEffect(SaveSiteRequest);
const decodeSaveSiteServiceRequest = Schema.decodeUnknownEffect(SaveSiteServiceRequest);
const decodeSaveSiteCheckRequest = Schema.decodeUnknownEffect(SaveSiteCheckRequest);
const decodeRunSiteChecksRequest = Schema.decodeUnknownEffect(RunSiteChecksRequest);
const decodeReceiptRequest = Schema.decodeEffect(SiteChecksRunReceiptRequest);
const decodeReceipt = Schema.decodeUnknownEffect(SiteChecksRunReceipt);
const decodeSnapshot = Schema.decodeUnknownEffect(SitesSnapshot);
const Problem = Schema.Struct({
  error: Schema.optionalKey(Schema.Struct({ code: Schema.String })),
});
const decodeLibraryFailure = Schema.decodeUnknownEffect(
  Schema.Struct({
    sitesError: Schema.Struct({
      stage: SitesError.fields.stage,
      requestId: SitesError.fields.requestId,
    }),
  }),
);
const decodeSiteId = Schema.decodeEffect(SiteId);
const Token = Schema.Struct({
  access_token: Schema.String.check(Schema.isMinLength(1)),
  token_type: Schema.String.check(Schema.makeFilter((value) => value.toLowerCase() === "bearer")),
  expires_in: Schema.Number.check(Schema.isGreaterThan(0)),
});
const make = Effect.gen(function* () {
  const random = yield* SecureRandom.SecureRandom;
  const env = yield* HostProcess.Environment;
  const http = yield* HttpClient.HttpClient;
  const library = yield* LibraryService.LibraryService;
  const connection = yield* LibraryConnectionService;
  const noRedirects = Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" });
  const api = env.LOOM_SITES_API_ORIGIN?.trim() || "https://api.begam.in";
  const issuer = env.LOOM_IDENTITY_ISSUER?.trim();
  const id = env.LOOM_SITES_CLIENT_ID?.trim();
  const secret = env.LOOM_SITES_CLIENT_SECRET?.trim()
    ? Redacted.make(env.LOOM_SITES_CLIENT_SECRET.trim())
    : null;
  const managerId = env.LOOM_SITES_MANAGER_CLIENT_ID?.trim();
  const managerSecret = env.LOOM_SITES_MANAGER_CLIENT_SECRET?.trim()
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
  const token = Effect.fn("SitesService.token")(
    function* (write = false) {
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
    },
    // The unused parameter keeps `write` in the inferred signature. A bare `lock.withPermit`
    // takes only the effect, and Effect.fn would infer that this function takes no arguments.
    (effect, _write?: boolean) => lock.withPermit(effect),
  );
  const read = Effect.fn("SitesService.read")(function* <A, I>(
    path: string,
    schema: Schema.Codec<A, I>,
  ) {
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
      return yield* new SitesError({
        stage: response.status === 403 ? "permission" : "authentication",
      });
    }
    return yield* HttpClientResponse.filterStatusOk(response).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(schema)),
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(2)),
      Effect.timeout("15 seconds"),
      Effect.mapError((cause) => new SitesError({ stage: "read", cause })),
    );
  });
  const readLibrary = Effect.fn("SitesService.readLibrary")(function* <A, I>(
    input: typeof LibrarySitesRead.Type,
    schema: Schema.Codec<A, I>,
  ) {
    const response = yield* connection
      .send(
        HttpClientRequest.post(LIBRARY_SITES_READ_ROUTE).pipe(
          HttpClientRequest.bodyJsonUnsafe(input),
        ),
      )
      .pipe(
        Effect.timeout("30 seconds"),
        Effect.mapError((cause) => new SitesError({ stage: "library-connection", cause })),
      );
    if (response.status === 503) {
      const failure = yield* response.json.pipe(
        Effect.flatMap(decodeLibraryFailure),
        Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.kibibytes(32)),
        Effect.timeout("15 seconds"),
        Effect.orElseSucceed(() => null),
      );
      if (failure) return yield* new SitesError(failure.sitesError);
      return yield* new SitesError({ stage: "read" });
    }
    if (response.status === 401 || response.status === 403)
      return yield* new SitesError({ stage: "library-connection" });
    if (response.status === 404) return yield* new SitesError({ stage: "library-update" });
    return yield* HttpClientResponse.filterStatusOk(response).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(schema)),
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(2)),
      Effect.timeout("15 seconds"),
      Effect.mapError((cause) => new SitesError({ stage: "read", cause })),
    );
  });
  const isRemote = connection.current.pipe(
    Effect.flatMap((current) => {
      if (current.kind === "unavailable")
        return Effect.fail(new SitesError({ stage: "library-connection" }));
      return Effect.succeed(current.kind === "remote");
    }),
  );
  const write = Effect.fn("SitesService.write")(function* (
    path: string,
    input: unknown,
    metadata: { readonly requestId?: string; readonly expectedEtag?: string | null },
    authorize: Effect.Effect<void, SitesError> = Effect.void,
  ): Effect.fn.Return<SitesSnapshot, SitesError> {
    const requestId = metadata.requestId ?? `loom-${yield* random.uuidV4()}`;
    const credential = yield* token(true).pipe(
      Effect.mapError((error) => new SitesError({ stage: error.stage, requestId, cause: error })),
    );
    yield* authorize;
    const request =
      input === undefined
        ? HttpClientRequest.post(`${api}${path}`)
        : yield* HttpClientRequest.put(`${api}${path}`).pipe(
            HttpClientRequest.bodyJson(input),
            Effect.mapError((cause) => new SitesError({ stage: "validation", cause })),
          );
    const response = yield* http
      .execute(
        request.pipe(
          HttpClientRequest.bearerToken(credential),
          HttpClientRequest.setHeaders({
            "idempotency-key": requestId,
            ...(metadata.expectedEtag === null
              ? { "if-none-match": "*" }
              : metadata.expectedEtag !== undefined
                ? { "if-match": metadata.expectedEtag }
                : {}),
          }),
        ),
      )
      .pipe(
        noRedirects,
        Effect.timeout("90 seconds"),
        Effect.mapError((cause) => new SitesError({ stage: "unknown-outcome", requestId, cause })),
      );
    if (response.status === 401 || response.status === 403) {
      cached.delete(true);
      return yield* new SitesError({
        stage: response.status === 403 ? "permission" : "authentication",
        requestId,
      });
    }
    if (response.status === 412 || response.status === 428)
      return yield* new SitesError({
        stage: response.status === 412 ? "revision-conflict" : "revision-required",
        requestId,
      });
    if (response.status === 409 || response.status === 422) {
      const problem = yield* response.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Problem)),
        Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.kibibytes(32)),
        Effect.timeout("15 seconds"),
        Effect.orElseSucceed(() => null),
      );
      const code = problem?.error?.code;
      return yield* new SitesError({
        stage:
          code === "conflict"
            ? "revision-conflict"
            : code === "idempotency_key_reused"
              ? "request-conflict"
              : response.status === 422
                ? "validation"
                : "unknown-outcome",
        requestId,
      });
    }
    if (response.status === 400 || response.status === 413)
      return yield* new SitesError({ stage: "validation", requestId });
    return yield* HttpClientResponse.filterStatusOk(response).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(SitesSnapshot)),
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(2)),
      Effect.timeout("15 seconds"),
      Effect.mapError((cause) => new SitesError({ stage: "unknown-outcome", requestId, cause })),
    );
  });
  const save = Effect.fn("SitesService.save")(function* (
    collection: "sites" | "services" | "checks",
    input: SaveSiteRequest | SaveSiteServiceRequest | SaveSiteCheckRequest,
    authorize?: Effect.Effect<void, SitesError>,
  ) {
    if (!managementConfigured || !configurationValid)
      return yield* new SitesError({ stage: "configuration" });
    const { requestId, expectedEtag, ...body } = input;
    let revision = expectedEtag;
    if (revision === undefined) {
      const snapshot = yield* read("/v1/integrations/sites", SitesSnapshot);
      const current = snapshot[collection].find((row) => row.id === input.id);
      if (current?.etag !== undefined)
        return yield* new SitesError({
          stage: "revision-required",
          ...(requestId ? { requestId } : {}),
        });
      if (!current) revision = null;
    }
    const prefix = collection === "sites" ? "" : `/${collection}`;
    return yield* write(
      `/v1/integrations/sites${prefix}/${encodeURIComponent(input.id)}`,
      body,
      {
        ...(requestId ? { requestId } : {}),
        ...(revision !== undefined ? { expectedEtag: revision } : {}),
      },
      authorize,
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
      return yield* save("sites", input, authorize);
    }),
    saveService: Effect.fn("SitesService.saveService")(function* (raw, authorize) {
      const input = yield* decodeSaveSiteServiceRequest(raw).pipe(
        Effect.mapError((cause) => new SitesError({ stage: "validation", cause })),
      );
      return yield* save("services", input, authorize);
    }),
    saveCheck: Effect.fn("SitesService.saveCheck")(function* (raw, authorize) {
      const input = yield* decodeSaveSiteCheckRequest(raw).pipe(
        Effect.mapError((cause) => new SitesError({ stage: "validation", cause })),
      );
      return yield* save("checks", input, authorize);
    }),
    runChecks: Effect.fn("SitesService.runChecks")(function* (authorize, raw = {}) {
      const input = yield* decodeRunSiteChecksRequest(raw).pipe(
        Effect.mapError((cause) => new SitesError({ stage: "validation", cause })),
      );
      return yield* write("/v1/integrations/sites/checks/run", undefined, input, authorize);
    }),
    checkRunReceipt: Effect.fn("SitesService.checkRunReceipt")(function* (raw) {
      const input = yield* decodeReceiptRequest(raw).pipe(
        Effect.mapError((cause) => new SitesError({ stage: "validation", cause })),
      );
      if (yield* isRemote)
        return yield* readLibrary({ checkRunRequestId: input.requestId }, SiteChecksRunReceipt);
      const credential = yield* token(true);
      const response = yield* http
        .execute(
          HttpClientRequest.get(`${api}/v1/integrations/sites/checks/run/receipt`).pipe(
            HttpClientRequest.bearerToken(credential),
            HttpClientRequest.setHeader("idempotency-key", input.requestId),
          ),
        )
        .pipe(
          noRedirects,
          Effect.timeout("15 seconds"),
          Effect.mapError(
            (cause) => new SitesError({ stage: "read", requestId: input.requestId, cause }),
          ),
        );
      if (response.status === 401 || response.status === 403) {
        cached.delete(true);
        return yield* new SitesError({
          stage: response.status === 401 ? "authentication" : "permission",
          requestId: input.requestId,
        });
      }
      if (response.status === 404) return { state: "unavailable" as const };
      if (response.status === 422)
        return yield* new SitesError({ stage: "request-conflict", requestId: input.requestId });
      const receipt = yield* HttpClientResponse.filterStatusOk(response).pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(decodeReceipt),
        Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(2)),
        Effect.timeout("15 seconds"),
        Effect.mapError(
          (cause) => new SitesError({ stage: "read", requestId: input.requestId, cause }),
        ),
      );
      if (receipt.state === "completed" && receipt.status < 300) {
        yield* decodeSnapshot(receipt.body).pipe(
          Effect.mapError(
            (cause) => new SitesError({ stage: "read", requestId: input.requestId, cause }),
          ),
        );
      }
      return receipt;
    }),
    snapshot: Effect.gen(function* () {
      if (yield* isRemote) {
        const state = yield* readLibrary({}, SitesState);
        return { ...state, managementConfigured: state.managementConfigured ?? false };
      }
      if (!configured) return { configured: false, managementConfigured: false, snapshot: null };
      const snapshot = yield* read("/v1/integrations/sites", SitesSnapshot);
      return { configured: true, managementConfigured, snapshot };
    }),
    analytics: Effect.fn("SitesService.analytics")(function* (input) {
      const siteId = yield* decodeSiteId(input.siteId).pipe(
        Effect.mapError((cause) => new SitesError({ stage: "read", cause })),
      );
      const result = yield* (yield* isRemote)
        ? readLibrary({ siteId }, SiteAnalytics)
        : read(`/v1/integrations/sites/${encodeURIComponent(siteId)}/analytics`, SiteAnalytics);
      if (result.siteId !== siteId) return yield* new SitesError({ stage: "read" });
      return result;
    }),
  });
});
export const layer = Layer.effect(SitesService, make).pipe(
  Layer.provide(SecureRandom.layerWebCrypto),
);
