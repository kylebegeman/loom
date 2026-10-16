import {
  AuthLibraryPublishScope,
  AuthOrchestrationOperateScope,
  EnvironmentId,
} from "@t3tools/contracts";
import {
  LibraryConversationBriefProposal,
  LibraryId,
  LibraryRegisterComputerRequest,
  LibraryError,
  LibraryImportShadowRequest,
  LibraryIngestHistoryRequest,
  LibraryRegisterCopyRequest,
  LibraryRequestId,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { LIBRARY_HISTORY_MAX_BYTES, readLibraryJson } from "./transfer.ts";
import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as LibraryService from "./LibraryService.ts";

// Large established threads retain complete tool history. Clients browse bounded windows.

const decodeIngest = Schema.decodeUnknownEffect(Schema.toCodecJson(LibraryIngestHistoryRequest));
const decodeCopy = Schema.decodeUnknownEffect(LibraryRegisterCopyRequest);
const decodeVerify = Schema.decodeUnknownEffect(Schema.Struct({ requestId: LibraryRequestId }));
const decodeImport = Schema.decodeUnknownEffect(Schema.toCodecJson(LibraryImportShadowRequest));
const decodeComputer = Schema.decodeUnknownEffect(LibraryRegisterComputerRequest);
const decodeProjectRead = Schema.decodeUnknownEffect(Schema.Struct({ projectId: LibraryId }));
const decodeProposal = Schema.decodeUnknownEffect(LibraryConversationBriefProposal);
const decodeEnvironmentId = Schema.decodeUnknownEffect(EnvironmentId);
const handler = (
  operation: "info" | "computer" | "ingest" | "copy" | "import" | "verify" | "project" | "propose",
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
        (!operator && !publisher) ||
        session.subject === "mcp-client" ||
        ((operation === "import" || operation === "verify") && !operator) ||
        // A forwarded proposal names its conversation's computer by the session that sent it.
        (operation === "propose" && !publisher)
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
      const length = request.headers["content-length"];
      if (
        length !== undefined &&
        (!/^\d+$/.test(length) || Number(length) > LIBRARY_HISTORY_MAX_BYTES)
      )
        return HttpServerResponse.text("History request too large", { status: 413 });
      const body = yield* readLibraryJson(request);
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
            { reason: error.reason },
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
