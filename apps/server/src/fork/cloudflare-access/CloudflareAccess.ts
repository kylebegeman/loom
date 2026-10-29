import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ByteSize from "effect/ByteSize";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import {
  HttpIncomingMessage,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import * as Jose from "jose";

const KEY_CACHE_MS = 300_000;
const KEY_REFRESH_COOLDOWN_MS = 30_000;
const Keys = Schema.Struct({ keys: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) });
const decodeKeys = HttpClientResponse.schemaBodyJson(Keys);

export class CloudflareAccessError extends Schema.TaggedError<CloudflareAccessError>()(
  "CloudflareAccessError",
  {
    reason: Schema.Literals(["configuration", "assertion", "unavailable"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "configuration":
        return "Cloudflare Access needs a valid team domain and application audience.";
      case "assertion":
        return "Sign in through this computer's Cloudflare Access address.";
      case "unavailable":
        return "Cloudflare Access could not be verified. Try again.";
    }
  }
}

export class CloudflareAccess extends Context.Service<
  CloudflareAccess,
  {
    readonly enabled: boolean;
    readonly verify: (
      assertion: string | undefined,
    ) => Effect.Effect<{ readonly subject: string } | null, CloudflareAccessError>;
  }
>()("t3/fork/cloudflare-access/CloudflareAccess") {}

const make = Effect.gen(function* () {
  const env = yield* HostProcess.Environment;
  const team = env.LOOM_ACCESS_TEAM_DOMAIN?.trim() ?? "";
  const audience = env.LOOM_ACCESS_AUDIENCE?.trim() ?? "";
  const configured =
    env.LOOM_ACCESS_TEAM_DOMAIN !== undefined || env.LOOM_ACCESS_AUDIENCE !== undefined;
  if (!configured)
    return CloudflareAccess.of({
      enabled: false,
      verify: Effect.fn("CloudflareAccess.verify")(() => Effect.succeed(null)),
    });
  if (
    !/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/u.test(team) ||
    !/^[a-f0-9]{64}$/u.test(audience)
  ) {
    return yield* new CloudflareAccessError({ reason: "configuration" });
  }
  const http = yield* HttpClient.HttpClient;
  const lock = yield* Semaphore.make(1);
  let cache:
    | { readonly resolver: ReturnType<typeof Jose.createLocalJWKSet>; readonly fetchedAt: number }
    | undefined;
  const keys = Effect.fn("CloudflareAccess.keys")(function* (refresh: boolean) {
    return yield* lock.withPermit(
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        if (
          cache &&
          cache.fetchedAt + (refresh ? KEY_REFRESH_COOLDOWN_MS : KEY_CACHE_MS) >
            now.epochMilliseconds
        )
          return cache.resolver;
        const value = yield* http
          .execute(HttpClientRequest.get(`${team}/cdn-cgi/access/certs`))
          .pipe(
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.flatMap(decodeKeys),
            Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.kibibytes(128)),
            Effect.timeout("10 seconds"),
            Effect.mapError((cause) => new CloudflareAccessError({ reason: "unavailable", cause })),
          );
        if (value.keys.length === 0 || value.keys.length > 32)
          return yield* new CloudflareAccessError({ reason: "unavailable" });
        const resolver = Jose.createLocalJWKSet({ keys: [...value.keys] });
        cache = { resolver, fetchedAt: now.epochMilliseconds };
        return resolver;
      }),
    );
  });
  return CloudflareAccess.of({
    enabled: true,
    verify: Effect.fn("CloudflareAccess.verify")(function* (assertion) {
      if (
        assertion === undefined ||
        assertion.length > 32768 ||
        !/^[\w-]+\.[\w-]+\.[\w-]+$/u.test(assertion)
      ) {
        return yield* new CloudflareAccessError({ reason: "assertion" });
      }
      const now = yield* DateTime.now;
      const verify = (resolver: ReturnType<typeof Jose.createLocalJWKSet>) =>
        Effect.tryPromise({
          try: () =>
            Jose.jwtVerify(assertion, resolver, {
              algorithms: ["RS256"],
              issuer: team,
              audience,
              requiredClaims: ["sub", "exp", "iat"],
              currentDate: DateTime.toDate(now),
            }),
          catch: (cause) => new CloudflareAccessError({ reason: "assertion", cause }),
        });
      const first = yield* Effect.result(verify(yield* keys(false)));
      const verified =
        first._tag === "Success"
          ? first.success
          : first.failure.cause instanceof Jose.errors.JWKSNoMatchingKey
            ? yield* verify(yield* keys(true))
            : yield* first.failure;
      if (
        typeof verified.payload.sub !== "string" ||
        verified.payload.sub.length === 0 ||
        verified.payload.sub.length > 200 ||
        verified.payload.type !== "app" ||
        verified.payload.iat === undefined ||
        verified.payload.iat > now.epochMilliseconds / 1000
      ) {
        return yield* new CloudflareAccessError({ reason: "assertion" });
      }
      return { subject: verified.payload.sub };
    }),
  });
});

export const layer = Layer.effect(CloudflareAccess, make);

// Access admits the request; Loom still authenticates and authorizes its own credential.
export const guardLayer = HttpRouter.middleware(
  Effect.map(
    CloudflareAccess,
    (access) =>
      <E, R>(app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
        !access.enabled
          ? app
          : Effect.gen(function* () {
              const request = yield* HttpServerRequest.HttpServerRequest;
              const result = yield* Effect.result(
                access.verify(request.headers["cf-access-jwt-assertion"]),
              );
              return result._tag === "Success"
                ? yield* app
                : HttpServerResponse.jsonUnsafe(
                    { error: "cloudflare_access_required", message: result.failure.message },
                    {
                      status: result.failure.reason === "unavailable" ? 503 : 403,
                      headers: { "cache-control": "no-store" },
                    },
                  );
            }),
  ),
  { global: true },
);
