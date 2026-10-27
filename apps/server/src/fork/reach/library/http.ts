import { AuthLibraryPublishScope, EnvironmentId } from "@t3tools/contracts";
import {
  REACH_IDENTITY_ROUTE,
  REACH_LIST_ROUTE,
  REACH_ENSURE_ROUTE,
  REACH_REMOVE_ROUTE,
  REACH_REQUEST_MAX_BYTES,
  type ReachAction,
  type ReachFailureReason,
  ReachRequestBody,
} from "@t3tools/contracts/fork";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  HttpIncomingMessage,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import * as EnvironmentAuth from "../../../auth/EnvironmentAuth.ts";
import { isHttpsRequest } from "../../../auth/utils.ts";
import { ForkRuntime, withForkRuntime } from "../../ForkRuntime.ts";
import { ReachProvisioner } from "./ReachProvisioner.ts";

const HOST_SUBJECT_PREFIX = "loom-host:";
const NO_STORE = { "cache-control": "no-store" } as const;

/** A computer reads 404 as "this Library runs no reach" and 503 as "not set up yet". */
const STATUS = {
  "not-authority": 404,
  "not-configured": 503,
  "is-library": 403,
  "not-in-directory": 409,
  "key-changed": 409,
  unverified: 400,
  "wrong-environment": 403,
  "stale-request": 409,
  "too-many-requests": 429,
  "edge-failed": 502,
  "cloudflare-denied": 502,
  "cloudflare-limited": 503,
  "cloudflare-unavailable": 503,
  "hostname-unavailable": 409,
  "tunnel-busy": 409,
  io: 503,
  invalid: 400,
  "too-large": 413,
} as const satisfies Record<ReachFailureReason, number>;

const decodeEnvironmentId = Schema.decodeUnknownOption(EnvironmentId);
const decodeBody = Schema.decodeUnknownOption(Schema.fromJsonString(ReachRequestBody));

const json = (body: unknown) => HttpServerResponse.jsonUnsafe(body, { headers: NO_STORE });
const refusal = (reason: ReachFailureReason, retryAfterSeconds?: number) =>
  HttpServerResponse.jsonUnsafe(
    retryAfterSeconds === undefined ? { reason } : { reason, retryAfterSeconds },
    {
      status: STATUS[reason],
      headers:
        retryAfterSeconds === undefined
          ? NO_STORE
          : { ...NO_STORE, "retry-after": String(retryAfterSeconds) },
    },
  );
const text = (body: string, status: number) =>
  HttpServerResponse.text(body, { status, headers: NO_STORE });

/**
 * Only a computer's own publisher session. There is no operator fallback: the ensure reply carries
 * a connector token, and a person never needs one.
 */
const publisherOf = (session: EnvironmentAuth.AuthenticatedSession) =>
  session.subject !== "mcp-client" &&
  session.scopes.includes(AuthLibraryPublishScope) &&
  session.subject.startsWith(HOST_SUBJECT_PREFIX)
    ? Option.getOrNull(decodeEnvironmentId(session.subject.slice(HOST_SUBJECT_PREFIX.length)))
    : null;

const reachRoute = (action: ReachAction) =>
  withForkRuntime(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      // The reply holds a connector token, so it never travels over plain HTTP.
      if (!isHttpsRequest(request)) return refusal("invalid");
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const session = yield* auth.authenticateHttpRequest(request);
      const environmentId = publisherOf(session);
      if (environmentId === null) return text("Access denied", 403);
      const length = request.headers["content-length"];
      // Checked before reading, so an oversized post is refused without being buffered.
      if (
        length !== undefined &&
        (!/^\d+$/u.test(length) || Number(length) > REACH_REQUEST_MAX_BYTES)
      ) {
        return refusal("too-large");
      }
      const body = yield* request.text.pipe(
        Effect.provideService(
          HttpIncomingMessage.MaxBodySize,
          ByteSize.bytes(REACH_REQUEST_MAX_BYTES),
        ),
        Effect.option,
      );
      if (Option.isNone(body)) return refusal("too-large");
      // A schema issue would echo the token, so only the outcome is kept.
      const decoded = decodeBody(body.value);
      if (Option.isNone(decoded)) return refusal("invalid");
      const provisioner = yield* ReachProvisioner;
      const input = {
        environmentId,
        publisherSessionId: session.sessionId,
        request: decoded.value,
      };
      return json(
        action === "ensure" ? yield* provisioner.ensure(input) : yield* provisioner.remove(input),
      );
    }),
  ).pipe(
    Effect.catchTags({
      ReachProvisionError: (error) =>
        Effect.succeed(refusal(error.reason, error.retryAfterSeconds)),
      ServerAuthMissingCredentialError: () => Effect.succeed(text("Authentication required", 401)),
      ServerAuthInvalidCredentialError: () => Effect.succeed(text("Authentication required", 401)),
    }),
    Effect.orElseSucceed(() => text("Reach request unavailable", 503)),
  );

/** Its reply holds no secret, so it needs neither a signed request nor HTTPS. The body is unread. */
const identity = withForkRuntime(
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const session = yield* (yield* EnvironmentAuth.EnvironmentAuth).authenticateHttpRequest(
      request,
    );
    const environmentId = publisherOf(session);
    if (environmentId === null) return text("Access denied", 403);
    return json(
      yield* (yield* ReachProvisioner).prepareIdentity({
        environmentId,
        publisherSessionId: session.sessionId,
      }),
    );
  }),
).pipe(
  Effect.catchTags({
    ReachProvisionError: (error) => Effect.succeed(refusal(error.reason, error.retryAfterSeconds)),
    ServerAuthMissingCredentialError: () => Effect.succeed(text("Authentication required", 401)),
    ServerAuthInvalidCredentialError: () => Effect.succeed(text("Authentication required", 401)),
  }),
  Effect.orElseSucceed(() => text("Reach request unavailable", 503)),
);

const list = withForkRuntime(
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const session = yield* (yield* EnvironmentAuth.EnvironmentAuth).authenticateHttpRequest(
      request,
    );
    if (publisherOf(session) === null) return text("Access denied", 403);
    return json(yield* (yield* ReachProvisioner).list);
  }),
).pipe(
  Effect.catchTags({
    ReachLibraryError: (error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          { reason: error.reason },
          { status: error.reason === "not-authority" ? 404 : 503, headers: NO_STORE },
        ),
      ),
  }),
  Effect.orElseSucceed(() => text("Authentication required", 401)),
);

export const ReachHttpRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const route = <R>(
      path: HttpRouter.PathInput,
      handler: Effect.Effect<HttpServerResponse.HttpServerResponse, never, R>,
    ) => HttpRouter.add("POST", path, handler.pipe(Effect.provideService(ForkRuntime, runtime)));
    return Layer.mergeAll(
      route(REACH_LIST_ROUTE, list),
      route(REACH_ENSURE_ROUTE, reachRoute("ensure")),
      route(REACH_REMOVE_ROUTE, reachRoute("remove")),
      route(REACH_IDENTITY_ROUTE, identity),
    );
  }),
);
