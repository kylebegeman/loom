import { AuthLibraryPublishScope, EnvironmentId } from "@t3tools/contracts";
import {
  LibraryPagePublishRequest,
  LibraryPageRepliesNextRequest,
  LibraryPageReplyAckRequest,
  PREVIEW_PAGE_MAX_BYTES,
  PreviewPageUpdateInput,
  PreviewPagesError,
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
import { PageLibraryService, type PageComputer } from "./PageLibraryService.ts";

const PAGES_ROUTE = "/api/loom/library/pages";
const HOST_SUBJECT_PREFIX = "loom-host:";
/** JSON escaping can double an 8 MiB page; the rest covers the other fields. */
const PUBLISH_MAX_BYTES = 2 * PREVIEW_PAGE_MAX_BYTES + 64 * 1024;
const SMALL_MAX_BYTES = 16 * 1024;

const NO_STORE = { "cache-control": "no-store" } as const;

const decodeEnvironmentId = Schema.decodeUnknownEffect(EnvironmentId);
const decodePublish = Schema.decodeUnknownEffect(Schema.fromJsonString(LibraryPagePublishRequest));
const decodeUpdate = Schema.decodeUnknownEffect(Schema.fromJsonString(PreviewPageUpdateInput));
const decodeNext = Schema.decodeUnknownEffect(Schema.fromJsonString(LibraryPageRepliesNextRequest));
const decodeAck = Schema.decodeUnknownEffect(Schema.fromJsonString(LibraryPageReplyAckRequest));

/** A body over its route's cap; answered 413 rather than as a page error. */
class PageBodyTooLarge extends Schema.TaggedError<PageBodyTooLarge>()("PageBodyTooLarge", {}) {}

const json = (body: unknown, status = 200) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: NO_STORE });

const readBody = Effect.fn("PreviewPagesLibraryHttp.readBody")(function* <A>(
  request: HttpServerRequest.HttpServerRequest,
  maxBytes: number,
  decode: (text: string) => Effect.Effect<A, Schema.SchemaError>,
) {
  const length = request.headers["content-length"];
  // Checked before reading, so an oversized upload is refused without being buffered.
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBytes))
    return yield* new PageBodyTooLarge();
  const text = yield* request.text.pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(maxBytes)),
    Effect.mapError(() => new PageBodyTooLarge()),
  );
  return yield* decode(text).pipe(
    Effect.mapError(
      () => new PreviewPagesError({ reason: "invalid", message: "The request is malformed." }),
    ),
  );
});

type PageHandler = (
  pages: PageLibraryService["Service"],
  computer: PageComputer,
  request: HttpServerRequest.HttpServerRequest,
) => Effect.Effect<HttpServerResponse.HttpServerResponse, PreviewPagesError | PageBodyTooLarge>;

const pagesRoute = (handle: PageHandler) =>
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
      const pages = yield* PageLibraryService;
      // Answered before the body is read, so a Library without pages never buffers an upload.
      if (pages.pagesOrigin === null) return json({ reason: "unavailable" }, 404);
      return yield* handle(
        pages,
        { subject: session.subject, environmentId: environmentId.value },
        request,
      );
    }),
  ).pipe(
    Effect.catchTags({
      // A computer reads 404 as "this Library does not serve pages", and shows a 409's message
      // as is, since only the Library knows its caps.
      PreviewPagesError: (error) =>
        Effect.succeed(
          json(
            { reason: error.reason, message: error.message },
            error.reason === "unavailable" ? 404 : 409,
          ),
        ),
      PageBodyTooLarge: () => Effect.succeed(json({ reason: "too-large" }, 413)),
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

const publish = pagesRoute((pages, computer, request) =>
  readBody(request, PUBLISH_MAX_BYTES, decodePublish).pipe(
    Effect.flatMap((input) => pages.publish(computer, input)),
    Effect.map((page) => json(page)),
  ),
);

const list = pagesRoute((pages, computer) =>
  pages.list(computer).pipe(Effect.map((listed) => json({ pages: listed }))),
);

const update = pagesRoute((pages, computer, request) =>
  readBody(request, SMALL_MAX_BYTES, decodeUpdate).pipe(
    Effect.flatMap((input) => pages.update(computer, input)),
    Effect.map((page) => json(page)),
  ),
);

const nextReplies = pagesRoute((pages, computer, request) =>
  readBody(request, SMALL_MAX_BYTES, decodeNext).pipe(
    Effect.flatMap((input) => pages.nextReplies(computer, input.waitMs)),
    Effect.map((replies) => json({ replies })),
  ),
);

const ackReply = pagesRoute((pages, computer, request) =>
  readBody(request, SMALL_MAX_BYTES, decodeAck).pipe(
    Effect.flatMap((input) => pages.ackReply(computer, input)),
    Effect.as(HttpServerResponse.empty({ status: 204, headers: NO_STORE })),
  ),
);

const signOutReaders = pagesRoute((pages, computer) =>
  pages
    .signOutReaders(computer)
    .pipe(Effect.as(HttpServerResponse.empty({ status: 204, headers: NO_STORE }))),
);

export const PageLibraryHttpRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const route = <R>(
      method: "GET" | "POST",
      path: HttpRouter.PathInput,
      handler: Effect.Effect<HttpServerResponse.HttpServerResponse, never, R>,
    ) => HttpRouter.add(method, path, handler.pipe(Effect.provideService(ForkRuntime, runtime)));
    return Layer.mergeAll(
      route("POST", `${PAGES_ROUTE}/publish`, publish),
      route("GET", PAGES_ROUTE, list),
      route("POST", `${PAGES_ROUTE}/update`, update),
      route("POST", `${PAGES_ROUTE}/replies/next`, nextReplies),
      route("POST", `${PAGES_ROUTE}/replies/ack`, ackReply),
      route("POST", `${PAGES_ROUTE}/sign-out`, signOutReaders),
    );
  }),
);
