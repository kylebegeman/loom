import {
  AuthLibraryPublishScope,
  AuthLibraryRecoveryReadScope,
  AuthOrchestrationOperateScope,
  EnvironmentId,
} from "@t3tools/contracts";
import {
  LibraryProjectsRead,
  LibraryConversationsRead,
  LibraryConversationLookup,
  LibraryHistoryRead,
  LibraryThreadArchive,
  LibrarySearchRequest,
  LibraryTimelineRequest,
  LibraryLaunchCandidatesRequest,
  LibraryConversationBriefProposal,
  LibraryDocumentsPublishRequest,
  LibraryDecisionsSearchInput,
  LibraryId,
  LibraryRegisterComputerRequest,
  LibraryError,
  LibraryImportShadowRequest,
  LibraryIngestHistoryRequest,
  LibraryRegisterCopyRequest,
  LibraryRecordActivityRequest,
  LibraryRequestId,
} from "@t3tools/contracts/fork";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  HttpIncomingMessage,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { LIBRARY_HISTORY_MAX_BYTES, readLibraryJson } from "./transfer.ts";
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as Timeline from "./LibraryTimeline.ts";
import * as Launch from "./LibraryLaunchCandidates.ts";
import * as LibraryService from "./LibraryService.ts";

// Large established threads retain complete tool history. Clients browse bounded windows.

const DOCUMENTS_MAX_REQUEST_BYTES = 24 * 1024 * 1024;
const decodeDecisions = Schema.decodeUnknownEffect(LibraryDecisionsSearchInput);
const decodeDocuments = Schema.decodeUnknownEffect(LibraryDocumentsPublishRequest);
const decodeIngest = Schema.decodeUnknownEffect(Schema.toCodecJson(LibraryIngestHistoryRequest));
const decodeCopy = Schema.decodeUnknownEffect(LibraryRegisterCopyRequest);
const decodeVerify = Schema.decodeUnknownEffect(Schema.Struct({ requestId: LibraryRequestId }));
const decodeImport = Schema.decodeUnknownEffect(Schema.toCodecJson(LibraryImportShadowRequest));
const decodeComputer = Schema.decodeUnknownEffect(LibraryRegisterComputerRequest);
const decodeActivity = Schema.decodeUnknownEffect(LibraryRecordActivityRequest);
const decodeProjectRead = Schema.decodeUnknownEffect(Schema.Struct({ projectId: LibraryId }));
const decodeProposal = Schema.decodeUnknownEffect(LibraryConversationBriefProposal);
const decodeEnvironmentId = Schema.decodeUnknownEffect(EnvironmentId);
const decodeProjectsRead = Schema.decodeUnknownEffect(LibraryProjectsRead);
const decodeConversationsRead = Schema.decodeUnknownEffect(LibraryConversationsRead);
const decodeConversationLookup = Schema.decodeUnknownEffect(LibraryConversationLookup);
const decodeHistoryRead = Schema.decodeUnknownEffect(LibraryHistoryRead);
const decodeSearch = Schema.decodeUnknownEffect(LibrarySearchRequest);
const decodeTimeline = Schema.decodeUnknownEffect(LibraryTimelineRequest);
const decodeLaunchCandidates = Schema.decodeUnknownEffect(LibraryLaunchCandidatesRequest);
const encodeHistory = Schema.encodeEffect(Schema.toCodecJson(LibraryThreadArchive));
const handler = (
  operation:
    | "projects"
    | "conversations"
    | "lookup"
    | "history"
    | "search"
    | "timeline"
    | "candidates"
    | "decisions"
    | "documents"
    | "info"
    | "computer"
    | "ingest"
    | "copy"
    | "activity"
    | "import"
    | "verify"
    | "project"
    | "propose",
) =>
  withForkRuntime(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const session = yield* auth.authenticateHttpRequest(request);
      const operator = session.scopes.includes(AuthOrchestrationOperateScope);
      const publisher =
        session.scopes.includes(AuthLibraryPublishScope) &&
        session.subject.startsWith("loom-host:");
      if (
        (!operator &&
          !publisher &&
          !(operation === "info" && session.scopes.includes(AuthLibraryRecoveryReadScope))) ||
        session.subject === "mcp-client" ||
        ((operation === "import" || operation === "verify") && !operator) ||
        // A forwarded proposal names its conversation's computer by the session that sent it.
        ((operation === "propose" || operation === "documents") && !publisher)
      )
        return HttpServerResponse.text("Access denied", { status: 403 });
      const sourceAllowed = (
        source: EnvironmentId,
        fence: { authorityId?: string | undefined; authorityEpoch?: number | undefined },
      ) =>
        !session.subject.startsWith("loom-host:") ||
        (session.subject === `loom-host:${source}` &&
          fence.authorityId !== undefined &&
          fence.authorityEpoch !== undefined);
      const library = yield* LibraryService.LibraryService;
      if (operation === "info")
        return HttpServerResponse.jsonUnsafe(yield* library.info, {
          headers: { "cache-control": "no-store" },
        });
      const documentRequest = operation === "documents" || operation === "decisions";
      const maxBytes = documentRequest ? DOCUMENTS_MAX_REQUEST_BYTES : LIBRARY_HISTORY_MAX_BYTES;
      const length = request.headers["content-length"];
      if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBytes))
        return HttpServerResponse.text("History request too large", { status: 413 });
      const body = yield* documentRequest
        ? request.json.pipe(
            Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(maxBytes)),
            Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })),
          )
        : readLibraryJson(request);
      if (operation === "projects") {
        const input = yield* decodeProjectsRead(body).pipe(
          Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })),
        );
        return HttpServerResponse.jsonUnsafe(yield* library.projects(input), {
          headers: { "cache-control": "no-store" },
        });
      }
      if (operation === "conversations") {
        const input = yield* decodeConversationsRead(body).pipe(
          Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })),
        );
        return HttpServerResponse.jsonUnsafe(yield* library.conversations(input), {
          headers: { "cache-control": "no-store" },
        });
      }
      if (operation === "lookup") {
        const input = yield* decodeConversationLookup(body).pipe(
          Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })),
        );
        return HttpServerResponse.jsonUnsafe(yield* library.lookupThread(input), {
          headers: { "cache-control": "no-store" },
        });
      }
      if (operation === "history") {
        const input = yield* decodeHistoryRead(body).pipe(
          Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })),
        );
        return HttpServerResponse.jsonUnsafe(
          yield* library
            .history({ ...input, offset: input.offset ?? 0, limit: input.limit ?? 50 })
            .pipe(Effect.flatMap(encodeHistory)),
          { headers: { "cache-control": "no-store" } },
        );
      }
      if (operation === "search") {
        const input = yield* decodeSearch(body).pipe(
          Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })),
        );
        return HttpServerResponse.jsonUnsafe(yield* library.search(input), {
          headers: { "cache-control": "no-store" },
        });
      }
      if (operation === "timeline") {
        const input = yield* decodeTimeline(body).pipe(
          Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })),
        );
        return HttpServerResponse.jsonUnsafe(
          yield* Effect.flatMap(Timeline.LibraryTimeline, (service) => service.page(input)),
          { headers: { "cache-control": "no-store" } },
        );
      }
      if (operation === "candidates") {
        const input = yield* decodeLaunchCandidates(body).pipe(
          Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })),
        );
        return HttpServerResponse.jsonUnsafe(
          yield* Effect.flatMap(Launch.LibraryLaunchCandidates, (service) =>
            service.candidates(input),
          ),
          { headers: { "cache-control": "no-store" } },
        );
      }
      if (operation === "decisions") {
        const input = yield* decodeDecisions(body).pipe(
          Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })),
        );
        return HttpServerResponse.jsonUnsafe(yield* library.decisions(input), {
          headers: { "cache-control": "no-store" },
        });
      }
      if (operation === "verify") {
        const input = yield* decodeVerify(body).pipe(
          Effect.mapError(() => new LibraryError({ reason: "invalid" })),
        );
        return HttpServerResponse.jsonUnsafe(yield* library.verifyImport(input), {
          headers: { "cache-control": "no-store" },
        });
      }
      if (operation === "project") {
        const input = yield* decodeProjectRead(body).pipe(
          Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })),
        );
        return HttpServerResponse.jsonUnsafe(yield* library.project(input), {
          headers: { "cache-control": "no-store" },
        });
      }
      if (operation === "propose") {
        const { threadId, ...input } = yield* decodeProposal(body).pipe(
          Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })),
        );
        const environmentId = yield* decodeEnvironmentId(
          session.subject.slice("loom-host:".length),
        ).pipe(Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })));
        return HttpServerResponse.jsonUnsafe(
          yield* library.proposeBrief(input, { kind: "conversation", environmentId, threadId }),
          { headers: { "cache-control": "no-store" } },
        );
      }
      if (operation === "computer") {
        const input = yield* decodeComputer(body).pipe(
          Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })),
        );
        if (!sourceAllowed(input.computer.environmentId, input))
          return HttpServerResponse.text("Access denied", { status: 403 });
        return HttpServerResponse.jsonUnsafe(yield* library.registerComputer(input), {
          headers: { "cache-control": "no-store" },
        });
      }
      if (operation === "documents") {
        const input = yield* decodeDocuments(body).pipe(
          Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })),
        );
        if (!sourceAllowed(input.computerId, input))
          return HttpServerResponse.text("Access denied", { status: 403 });
        return HttpServerResponse.jsonUnsafe(yield* library.publishDocuments(input), {
          headers: { "cache-control": "no-store" },
        });
      }
      if (operation === "copy") {
        const input = yield* decodeCopy(body).pipe(
          Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })),
        );
        if (!sourceAllowed(input.copy.environmentId, input))
          return HttpServerResponse.text("Access denied", { status: 403 });
        return HttpServerResponse.jsonUnsafe(yield* library.registerCopy(input), {
          headers: { "cache-control": "no-store" },
        });
      }
      if (operation === "activity") {
        const input = yield* decodeActivity(body).pipe(
          Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })),
        );
        if (!sourceAllowed(input.environmentId, input))
          return HttpServerResponse.text("Access denied", { status: 403 });
        return HttpServerResponse.jsonUnsafe(yield* library.recordActivity(input), {
          headers: { "cache-control": "no-store" },
        });
      }
      if (operation === "import") {
        const input = yield* decodeImport(body).pipe(
          Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })),
        );
        if (!sourceAllowed(input.sourceEnvironmentId, input))
          return HttpServerResponse.text("Access denied", { status: 403 });
        return HttpServerResponse.jsonUnsafe(yield* library.importShadow(input), {
          headers: { "cache-control": "no-store" },
        });
      }
      const input = yield* decodeIngest(body).pipe(
        Effect.mapError((cause) => new LibraryError({ reason: "invalid", cause })),
      );
      if (!sourceAllowed(input.sourceEnvironmentId, input))
        return HttpServerResponse.text("Access denied", { status: 403 });
      return HttpServerResponse.jsonUnsafe(yield* library.ingestHistory(input), {
        headers: { "cache-control": "no-store" },
      });
    }),
  ).pipe(
    Effect.catchTags({
      LibraryError: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { reason: error.reason, detail: error.detail },
            { status: error.reason === "invalid" ? 400 : error.reason === "io" ? 503 : 409 },
          ),
        ),
    }),
    Effect.orElseSucceed(() =>
      HttpServerResponse.text("Library request unavailable", { status: 401 }),
    ),
  );

export const LibraryHttpRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    return Layer.mergeAll(
      HttpRouter.add(
        "POST",
        "/api/loom/library/projects/list",
        handler("projects").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      HttpRouter.add(
        "POST",
        "/api/loom/library/conversations/list",
        handler("conversations").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      HttpRouter.add(
        "POST",
        "/api/loom/library/conversations/lookup",
        handler("lookup").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      HttpRouter.add(
        "POST",
        "/api/loom/library/history/read",
        handler("history").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      HttpRouter.add(
        "POST",
        "/api/loom/library/history/search",
        handler("search").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      HttpRouter.add(
        "POST",
        "/api/loom/library/timeline/read",
        handler("timeline").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      HttpRouter.add(
        "POST",
        "/api/loom/library/launch-candidates",
        handler("candidates").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),

      HttpRouter.add(
        "POST",
        "/api/loom/library/documents/search",
        handler("decisions").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      HttpRouter.add(
        "POST",
        "/api/loom/library/documents/publish",
        handler("documents").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      HttpRouter.add(
        "GET",
        "/api/loom/library/info",
        handler("info").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      HttpRouter.add(
        "POST",
        "/api/loom/library/computers/register",
        handler("computer").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      HttpRouter.add(
        "POST",
        "/api/loom/library/history/ingest",
        handler("ingest").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      HttpRouter.add(
        "POST",
        "/api/loom/library/copies/register",
        handler("copy").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      HttpRouter.add(
        "POST",
        "/api/loom/library/activity/record",
        handler("activity").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      HttpRouter.add(
        "POST",
        "/api/loom/library/verify-import",
        handler("verify").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      HttpRouter.add(
        "POST",
        "/api/loom/library/projects/read",
        handler("project").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      HttpRouter.add(
        "POST",
        "/api/loom/library/brief/propose",
        handler("propose").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      HttpRouter.add(
        "POST",
        "/api/loom/library/import-shadow",
        handler("import").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
    );
  }),
);
