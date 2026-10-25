import { AuthLibraryPublishScope, EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_PUSH_ACTIVITY_MAX_BYTES,
  LIBRARY_PUSH_ACTIVITY_ROUTE,
  LibraryPushActivityRequest,
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
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import { DirectoryService } from "../directory/DirectoryService.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { LibraryPushService } from "./LibraryPushService.ts";

const HOST_SUBJECT_PREFIX = "loom-host:";
const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * A computer backs off on 404 (no alerts here, or a Library from before them) and on 409 (it is
 * not in this Library's directory). Anything else drops only the one alert.
 */
const STATUS = {
  off: 404,
  "not-in-directory": 409,
  invalid: 400,
  "too-large": 413,
  "rate-limited": 429,
  unavailable: 503,
} as const;
type Refusal = keyof typeof STATUS;

const decodeEnvironmentId = Schema.decodeUnknownOption(EnvironmentId);
const decodeRequest = Schema.decodeUnknownOption(Schema.fromJsonString(LibraryPushActivityRequest));

const refusal = (reason: Refusal) =>
  HttpServerResponse.jsonUnsafe({ reason }, { status: STATUS[reason], headers: NO_STORE });
const text = (body: string, status: number) =>
  HttpServerResponse.text(body, { status, headers: NO_STORE });

/** Only a computer's own publisher session, which names the computer it speaks for. */
const publisherOf = (session: EnvironmentAuth.AuthenticatedSession) =>
  session.subject !== "mcp-client" &&
  session.scopes.includes(AuthLibraryPublishScope) &&
  session.subject.startsWith(HOST_SUBJECT_PREFIX)
    ? Option.getOrNull(decodeEnvironmentId(session.subject.slice(HOST_SUBJECT_PREFIX.length)))
    : null;

const activityRoute = withForkRuntime(
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const session = yield* auth.authenticateHttpRequest(request);
    const environmentId = publisherOf(session);
    if (environmentId === null) return text("Access denied", 403);
    const push = yield* LibraryPushService;
    // Both answered before the body is read, so a computer that cannot be served sends nothing.
    if (!push.alerts) return refusal("off");
    // A directory that is off cannot place any computer, which the computer treats the same way.
    const pin = yield* (yield* DirectoryService).pinned(environmentId).pipe(
      Effect.catchTags({
        DirectoryError: (error) =>
          Effect.succeed(error.reason === "not-authority" ? null : ("io" as const)),
      }),
    );
    if (pin === "io") return refusal("unavailable");
    if (pin === null) return refusal("not-in-directory");
    const length = request.headers["content-length"];
    if (
      length !== undefined &&
      (!/^\d+$/u.test(length) || Number(length) > LIBRARY_PUSH_ACTIVITY_MAX_BYTES)
    ) {
      return refusal("too-large");
    }
    const body = yield* request.text.pipe(
      Effect.provideService(
        HttpIncomingMessage.MaxBodySize,
        ByteSize.bytes(LIBRARY_PUSH_ACTIVITY_MAX_BYTES),
      ),
      Effect.option,
    );
    if (Option.isNone(body)) return refusal("too-large");
    const decoded = decodeRequest(body.value);
    if (Option.isNone(decoded)) return refusal("invalid");
    return HttpServerResponse.jsonUnsafe(yield* push.alert(environmentId, decoded.value), {
      headers: NO_STORE,
    });
  }),
).pipe(
  Effect.catchTags({
    LibraryPushError: (error) =>
      Effect.succeed(
        refusal(
          error.reason === "off"
            ? "off"
            : error.reason === "rate-limited"
              ? "rate-limited"
              : "unavailable",
        ),
      ),
    ServerAuthMissingCredentialError: () => Effect.succeed(text("Authentication required", 401)),
    ServerAuthInvalidCredentialError: () => Effect.succeed(text("Authentication required", 401)),
  }),
  Effect.orElseSucceed(() => text("Library push unavailable", 503)),
);

export const LibraryPushHttpRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    return HttpRouter.add(
      "POST",
      LIBRARY_PUSH_ACTIVITY_ROUTE,
      activityRoute.pipe(Effect.provideService(ForkRuntime, runtime)),
    );
  }),
);
