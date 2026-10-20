import { AuthLibraryPublishScope, EnvironmentId } from "@t3tools/contracts";
import {
  BOT_LIBRARY_ROUTE,
  BotLibraryAckRequest,
  BotLibraryCancelRequest,
  BotLibraryError,
  BotLibraryListRequest,
  BotLibraryPublishRequest,
  BotLibraryResultAck,
  BotLibraryResultPost,
  BotLibraryStatusReport,
  BotLibrarySubmitRequest,
  BotLibraryUnpublishRequest,
  BotLibraryWaitRequest,
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
import { BotLibraryService } from "./BotLibraryService.ts";

const HOST_SUBJECT_PREFIX = "loom-host:";
/** A definition holds up to 20,000 characters of instructions, which JSON escaping can double. */
const PUBLISH_MAX_BYTES = 128 * 1024;
const SMALL_MAX_BYTES = 64 * 1024;

const NO_STORE = { "cache-control": "no-store" } as const;

const decodeEnvironmentId = Schema.decodeUnknownEffect(EnvironmentId);
const bodyOf = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema));
const decodePublish = bodyOf(BotLibraryPublishRequest);
const decodeUnpublish = bodyOf(
  Schema.Struct({ ...BotLibraryUnpublishRequest.fields, label: Schema.String }),
);
const decodeList = bodyOf(BotLibraryListRequest);
const decodeStatus = bodyOf(BotLibraryStatusReport);
const decodeSubmit = bodyOf(BotLibrarySubmitRequest);
const decodeWait = bodyOf(BotLibraryWaitRequest);
const decodeAck = bodyOf(BotLibraryAckRequest);
const decodeCancel = bodyOf(BotLibraryCancelRequest);
const decodeResult = bodyOf(BotLibraryResultPost);
const decodeResultAck = bodyOf(BotLibraryResultAck);

class BotBodyTooLarge extends Schema.TaggedError<BotBodyTooLarge>()("BotBodyTooLarge", {}) {}

const json = (body: unknown, status = 200) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: NO_STORE });
const done = HttpServerResponse.empty({ status: 204, headers: NO_STORE });

const readBody = Effect.fn("botLibraryHttp.readBody")(function* <A>(
  request: HttpServerRequest.HttpServerRequest,
  maxBytes: number,
  decode: (text: string) => Effect.Effect<A, Schema.SchemaError>,
) {
  const length = request.headers["content-length"];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBytes))
    return yield* new BotBodyTooLarge();
  const text = yield* request.text.pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(maxBytes)),
    Effect.mapError(() => new BotBodyTooLarge()),
  );
  return yield* decode(text).pipe(
    Effect.mapError(
      () => new BotLibraryError({ reason: "invalid", message: "The request is malformed." }),
    ),
  );
});

type BotHandler = (
  library: BotLibraryService["Service"],
  environmentId: EnvironmentId,
  request: HttpServerRequest.HttpServerRequest,
) => Effect.Effect<HttpServerResponse.HttpServerResponse, BotLibraryError | BotBodyTooLarge>;

const botsRoute = (handle: BotHandler) =>
  withForkRuntime(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const session = yield* auth.authenticateHttpRequest(request);
      // Only a computer's own publisher session, which names the computer it speaks for.
      if (
        session.subject === "mcp-client" ||
        !session.scopes.includes(AuthLibraryPublishScope) ||
        !session.subject.startsWith(HOST_SUBJECT_PREFIX)
      )
        return HttpServerResponse.text("Access denied", { status: 403, headers: NO_STORE });
      const environmentId = yield* decodeEnvironmentId(
        session.subject.slice(HOST_SUBJECT_PREFIX.length),
      ).pipe(Effect.option);
      if (Option.isNone(environmentId))
        return HttpServerResponse.text("Access denied", { status: 403, headers: NO_STORE });
      const library = yield* BotLibraryService;
      // Answered before the body is read, so a computer that is not the Library buffers nothing.
      if (!library.enabled) return json({ reason: "unavailable" }, 404);
      return yield* handle(library, environmentId.value, request);
    }),
  ).pipe(
    Effect.catchTags({
      // A computer reads 404 as "this Library does not share bots" and shows a 409's message.
      BotLibraryError: (error) =>
        Effect.succeed(
          json(
            { reason: error.reason, message: error.message },
            error.reason === "unavailable" ? 404 : 409,
          ),
        ),
      BotBodyTooLarge: () => Effect.succeed(json({ reason: "too-large" }, 413)),
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
      HttpServerResponse.text("Library request unavailable", { status: 503, headers: NO_STORE }),
    ),
  );

const publish = botsRoute((library, environmentId, request) =>
  readBody(request, PUBLISH_MAX_BYTES, decodePublish).pipe(
    Effect.flatMap((input) => library.publish(environmentId, input)),
    Effect.map((record) => json(record)),
  ),
);

const unpublish = botsRoute((library, environmentId, request) =>
  readBody(request, SMALL_MAX_BYTES, decodeUnpublish).pipe(
    Effect.flatMap((input) => library.unpublish(environmentId, input.libraryBotId, input.label)),
    Effect.as(done),
  ),
);

const list = botsRoute((library, _environmentId, request) =>
  readBody(request, SMALL_MAX_BYTES, decodeList).pipe(
    Effect.flatMap((input) => library.list(input.after)),
    Effect.map((result) => json(result)),
  ),
);

const status = botsRoute((library, environmentId, request) =>
  readBody(request, SMALL_MAX_BYTES, decodeStatus).pipe(
    Effect.flatMap((report) => library.reportStatus(environmentId, report)),
    Effect.as(done),
  ),
);

const targets = botsRoute((library) =>
  library.targets.pipe(Effect.map((listed) => json({ targets: listed }))),
);

const submit = botsRoute((library, environmentId, request) =>
  readBody(request, SMALL_MAX_BYTES, decodeSubmit).pipe(
    Effect.flatMap((input) => library.submit(environmentId, input)),
    Effect.as(done),
  ),
);

const nextRequests = botsRoute((library, environmentId, request) =>
  readBody(request, SMALL_MAX_BYTES, decodeWait).pipe(
    Effect.flatMap((input) => library.nextRequests(environmentId, input.waitMs)),
    Effect.map((deliveries) => json({ deliveries })),
  ),
);

const ack = botsRoute((library, environmentId, request) =>
  readBody(request, SMALL_MAX_BYTES, decodeAck).pipe(
    Effect.flatMap((input) => library.ack(environmentId, input)),
    Effect.as(done),
  ),
);

const cancel = botsRoute((library, environmentId, request) =>
  readBody(request, SMALL_MAX_BYTES, decodeCancel).pipe(
    Effect.flatMap((input) => library.cancel(environmentId, input.requestId)),
    Effect.as(done),
  ),
);

const postResult = botsRoute((library, environmentId, request) =>
  readBody(request, SMALL_MAX_BYTES, decodeResult).pipe(
    Effect.flatMap((input) => library.postResult(environmentId, input)),
    Effect.as(done),
  ),
);

const nextResults = botsRoute((library, environmentId, request) =>
  readBody(request, SMALL_MAX_BYTES, decodeWait).pipe(
    Effect.flatMap((input) => library.nextResults(environmentId, input.waitMs)),
    Effect.map((results) => json({ results })),
  ),
);

const ackResult = botsRoute((library, environmentId, request) =>
  readBody(request, SMALL_MAX_BYTES, decodeResultAck).pipe(
    Effect.flatMap((input) => library.ackResult(environmentId, input)),
    Effect.as(done),
  ),
);

export const BotLibraryHttpRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const route = <R>(
      method: "GET" | "POST",
      path: HttpRouter.PathInput,
      handler: Effect.Effect<HttpServerResponse.HttpServerResponse, never, R>,
    ) => HttpRouter.add(method, path, handler.pipe(Effect.provideService(ForkRuntime, runtime)));
    const at = (path: string): HttpRouter.PathInput => `${BOT_LIBRARY_ROUTE}${path}`;
    return Layer.mergeAll(
      route("POST", at("/publish"), publish),
      route("POST", at("/unpublish"), unpublish),
      route("POST", at("/list"), list),
      route("POST", at("/status"), status),
      route("GET", at("/targets"), targets),
      route("POST", at("/requests/submit"), submit),
      route("POST", at("/requests/next"), nextRequests),
      route("POST", at("/requests/ack"), ack),
      route("POST", at("/requests/cancel"), cancel),
      route("POST", at("/results/post"), postResult),
      route("POST", at("/results/next"), nextResults),
      route("POST", at("/results/ack"), ackResult),
    );
  }),
);
