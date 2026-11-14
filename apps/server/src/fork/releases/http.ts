import { AuthLibraryPublishScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import {
  LOOM_RELEASES_NOT_HOSTED,
  LOOM_RELEASES_ROUTE,
  loomReleaseMirrorPath,
} from "@t3tools/shared/fork/release-mirror";
import * as Config from "effect/Config";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { signB2ObjectUrl, type B2SigningConfig } from "../project-library/assets/b2Signing.ts";

/** Release objects live under this prefix, which the publisher's write key is restricted to. */
const RELEASE_OBJECT_PREFIX = "releases/";
const SIGNED_URL_SECONDS = 300;
const NO_STORE = { "cache-control": "no-store" } as const;

/** The object store settings cannot sign a URL; the cause stays out because it holds the key. */
class ReleaseStoreMisconfigured extends Schema.TaggedError<ReleaseStoreMisconfigured>()(
  "ReleaseStoreMisconfigured",
  {},
) {}
const json = (body: unknown, status: number) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: NO_STORE });

/** The Library's object store, when it hosts releases. */
const releaseStore = Effect.gen(function* () {
  const authority = yield* Config.Boolean("LOOM_LIBRARY_AUTHORITY").pipe(Config.withDefault(false));
  const backend = yield* Config.String("LOOM_RELEASES_BACKEND").pipe(Config.withDefault(""));
  if (!authority || backend !== "b2") return Option.none<B2SigningConfig>();
  const text = (name: string) => Config.String(name).pipe(Config.withDefault(""));
  const assetBucket = yield* text("LOOM_B2_ASSET_BUCKET");
  return Option.some<B2SigningConfig>({
    endpoint: yield* text("LOOM_B2_ENDPOINT"),
    region: yield* text("LOOM_B2_REGION"),
    bucket: (yield* text("LOOM_B2_RELEASE_BUCKET")) || assetBucket,
    keyId: yield* text("LOOM_B2_KEY_ID"),
    applicationKey: Redacted.value(
      yield* Config.Redacted("LOOM_B2_APPLICATION_KEY").pipe(Config.withDefault(Redacted.make(""))),
    ),
  });
});

/** Enrolled computers read releases with their publisher session, people with their own. */
const mayReadReleases = (session: EnvironmentAuth.AuthenticatedSession) =>
  session.subject !== "mcp-client" &&
  ((session.scopes.includes(AuthLibraryPublishScope) && session.subject.startsWith("loom-host:")) ||
    session.scopes.includes(AuthOrchestrationReadScope));

const serveRelease = withForkRuntime(
  Effect.gen(function* () {
    const store = yield* releaseStore;
    if (Option.isNone(store)) return json({ reason: LOOM_RELEASES_NOT_HOSTED }, 404);
    const request = yield* HttpServerRequest.HttpServerRequest;
    const session = yield* (yield* EnvironmentAuth.EnvironmentAuth).authenticateHttpRequest(
      request,
    );
    if (!mayReadReleases(session))
      return HttpServerResponse.text("Access denied", { status: 403, headers: NO_STORE });
    const url = HttpServerRequest.toURL(request);
    const path = Option.isNone(url)
      ? null
      : loomReleaseMirrorPath(url.value.pathname.slice(LOOM_RELEASES_ROUTE.length + 1));
    if (path === null) return json({ reason: "invalid" }, 400);
    const now = DateTime.formatIso(yield* DateTime.now);
    const location = yield* Effect.try({
      try: () =>
        signB2ObjectUrl(store.value, {
          method: "GET",
          objectKey: `${RELEASE_OBJECT_PREFIX}${path}`,
          now,
          expiresInSeconds: SIGNED_URL_SECONDS,
        }),
      catch: () => new ReleaseStoreMisconfigured(),
    });
    // The signed URL expires in minutes and carries no account credential.
    return HttpServerResponse.empty({
      status: 302,
      headers: { ...NO_STORE, location, "referrer-policy": "no-referrer" },
    });
  }),
).pipe(
  Effect.catchTags({
    ServerAuthMissingCredentialError: () =>
      Effect.succeed(
        HttpServerResponse.text("Authentication required", { status: 401, headers: NO_STORE }),
      ),
    ServerAuthInvalidCredentialError: () =>
      Effect.succeed(
        HttpServerResponse.text("Authentication required", { status: 401, headers: NO_STORE }),
      ),
  }),
  Effect.orElseSucceed(() => json({ reason: "unavailable" }, 503)),
);

export const ReleaseHttpRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    return HttpRouter.add(
      "GET",
      `${LOOM_RELEASES_ROUTE}/*`,
      serveRelease.pipe(Effect.provideService(ForkRuntime, runtime)),
    );
  }),
);
