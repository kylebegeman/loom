import {
  AuthLibraryPublishScope,
  AuthOrchestrationOperateScope,
  EnvironmentId,
} from "@t3tools/contracts";
import {
  DIRECTORY_REPORT_TOKEN_MAX_LENGTH,
  type DirectoryError,
  DirectoryReportRequest,
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
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import {
  DIRECTORY_LIST_ROUTE,
  DIRECTORY_REPORT_ROUTE,
  DirectoryService,
} from "./DirectoryService.ts";

const HOST_SUBJECT_PREFIX = "loom-host:";
/** The token is base64url, which JSON never escapes; the rest covers the key and framing. */
const REPORT_MAX_BYTES = DIRECTORY_REPORT_TOKEN_MAX_LENGTH + 16 * 1024;
const NO_STORE = { "cache-control": "no-store" } as const;

/** A computer reads 404 as "this Library runs no directory". */
const STATUS = {
  "not-authority": 404,
  invalid: 400,
  unverified: 400,
  "wrong-environment": 403,
  "key-changed": 409,
  "stale-sequence": 409,
  "not-found": 404,
  // Forgetting waits until the Library's reach list retires the computer's address (F2).
  "reach-active": 409,
  io: 503,
} as const satisfies Record<DirectoryError["reason"], number>;

const decodeEnvironmentId = Schema.decodeUnknownEffect(EnvironmentId);
const decodeReport = Schema.decodeUnknownEffect(Schema.fromJsonString(DirectoryReportRequest));

/** A body over the cap; answered 413 rather than as a directory error. */
class ReportBodyTooLarge extends Schema.TaggedError<ReportBodyTooLarge>()(
  "ReportBodyTooLarge",
  {},
) {}

const json = (body: unknown, status = 200) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: NO_STORE });
const denied = () => HttpServerResponse.text("Access denied", { status: 403, headers: NO_STORE });

interface Caller {
  readonly publisher: Option.Option<EnvironmentId>;
  readonly operator: boolean;
}

type Handler = (
  directory: DirectoryService["Service"],
  caller: Caller,
  request: HttpServerRequest.HttpServerRequest,
) => Effect.Effect<HttpServerResponse.HttpServerResponse, DirectoryError | ReportBodyTooLarge>;

const directoryRoute = (handle: Handler) =>
  withForkRuntime(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const session = yield* auth.authenticateHttpRequest(request);
      if (session.subject === "mcp-client") return denied();
      // A publisher session names the computer it speaks for.
      const publisher =
        session.scopes.includes(AuthLibraryPublishScope) &&
        session.subject.startsWith(HOST_SUBJECT_PREFIX)
          ? yield* decodeEnvironmentId(session.subject.slice(HOST_SUBJECT_PREFIX.length)).pipe(
              Effect.option,
            )
          : Option.none();
      return yield* handle(
        yield* DirectoryService,
        { publisher, operator: session.scopes.includes(AuthOrchestrationOperateScope) },
        request,
      );
    }),
  ).pipe(
    Effect.catchTags({
      DirectoryError: (error) =>
        Effect.succeed(json({ reason: error.reason }, STATUS[error.reason])),
      ReportBodyTooLarge: () => Effect.succeed(json({ reason: "invalid" }, 413)),
      ServerAuthMissingCredentialError: () =>
        Effect.succeed(
          HttpServerResponse.text("Authentication required", { status: 401, headers: NO_STORE }),
        ),
      ServerAuthInvalidCredentialError: () =>
        Effect.succeed(
          HttpServerResponse.text("Authentication required", { status: 401, headers: NO_STORE }),
        ),
    }),
    Effect.orElseSucceed(() =>
      HttpServerResponse.text("Directory request unavailable", { status: 503, headers: NO_STORE }),
    ),
  );

/** Only a computer's own publisher session, for the computer it names. */
const report = directoryRoute((directory, caller, request) =>
  Effect.gen(function* () {
    if (Option.isNone(caller.publisher)) return denied();
    const length = request.headers["content-length"];
    // Checked before reading, so an oversized post is refused without being buffered.
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > REPORT_MAX_BYTES))
      return yield* new ReportBodyTooLarge();
    const text = yield* request.text.pipe(
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(REPORT_MAX_BYTES)),
      Effect.mapError(() => new ReportBodyTooLarge()),
    );
    // A schema error would echo the body, token included, so only the outcome is kept.
    const body = yield* decodeReport(text).pipe(Effect.option);
    if (Option.isNone(body)) return json({ reason: "invalid" }, 400);
    return json(
      yield* directory.report({ environmentId: caller.publisher.value, request: body.value }),
    );
  }),
);

/** A computer's publisher session, or a person operating the Library. */
const list = directoryRoute((directory, caller) =>
  Effect.gen(function* () {
    if (Option.isNone(caller.publisher) && !caller.operator) return denied();
    return json(yield* directory.list);
  }),
);

export const DirectoryHttpRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const route = <R>(
      path: HttpRouter.PathInput,
      handler: Effect.Effect<HttpServerResponse.HttpServerResponse, never, R>,
    ) => HttpRouter.add("POST", path, handler.pipe(Effect.provideService(ForkRuntime, runtime)));
    return Layer.mergeAll(route(DIRECTORY_REPORT_ROUTE, report), route(DIRECTORY_LIST_ROUTE, list));
  }),
);
