import { LibraryError } from "@t3tools/contracts/fork";
import {
  AuthLibraryPublishScope,
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  EnvironmentId,
} from "@t3tools/contracts";
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
import { ForkRuntime, withForkRuntime } from "../../ForkRuntime.ts";
import * as Assets from "./LibraryAssetService.ts";
import { LIBRARY_ASSET_MAX_BYTES } from "./LibraryObjectStore.ts";
const decodeEnvironmentId = Schema.decodeUnknownEffect(EnvironmentId);
const prefix = "/api/loom/library/assets/";
const handler = (method: "GET" | "PUT") =>
  withForkRuntime(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const session = yield* method === "GET"
        ? auth.authenticateWebSocketUpgrade(request, "media")
        : auth.authenticateHttpRequest(request);
      const permission =
        method === "PUT" ? AuthOrchestrationOperateScope : AuthOrchestrationReadScope;
      const publisher =
        session.scopes.includes(AuthLibraryPublishScope) &&
        session.subject.startsWith("loom-host:");
      if ((!session.scopes.includes(permission) && !publisher) || session.subject === "mcp-client")
        return HttpServerResponse.text("Access denied", { status: 403 });
      const url = HttpServerRequest.toURL(request);
      if (Option.isNone(url)) return HttpServerResponse.text("Invalid request", { status: 400 });
      const pieces = yield* Effect.try({
        try: () => url.value.pathname.slice(prefix.length).split("/").map(decodeURIComponent),
        catch: () => new LibraryError({ reason: "invalid" }),
      });
      if (pieces.length !== 2 || !pieces.every((value) => /^[A-Za-z0-9._:-]{1,200}$/.test(value)))
        return HttpServerResponse.text("Invalid asset", { status: 400 });
      const sourceEnvironmentId = yield* decodeEnvironmentId(pieces[0]);
      const attachmentId = pieces[1]!;
      if (
        session.subject.startsWith("loom-host:") &&
        session.subject !== `loom-host:${sourceEnvironmentId}`
      )
        return HttpServerResponse.text("Access denied", { status: 403 });
      const assets = yield* Assets.LibraryAssetService;
      if (method === "PUT") {
        const length = request.headers["content-length"];
        if (
          length !== undefined &&
          (!/^\d+$/.test(length) || Number(length) > LIBRARY_ASSET_MAX_BYTES)
        )
          return HttpServerResponse.text("Attachment too large", { status: 413 });
        const bytes = new Uint8Array(
          yield* request.arrayBuffer.pipe(
            Effect.provideService(
              HttpIncomingMessage.MaxBodySize,
              ByteSize.bytes(LIBRARY_ASSET_MAX_BYTES),
            ),
          ),
        );
        if (bytes.length > LIBRARY_ASSET_MAX_BYTES)
          return HttpServerResponse.text("Attachment too large", { status: 413 });
        const filename = yield* Effect.try({
          try: () => decodeURIComponent(request.headers["x-loom-filename"] ?? attachmentId),
          catch: (cause) => new LibraryError({ reason: "invalid", cause }),
        });
        const asset = yield* assets.put({
          sourceEnvironmentId,
          attachmentId,
          filename,
          contentType: request.headers["content-type"]?.split(";")[0] ?? "application/octet-stream",
          bytes,
        });
        return HttpServerResponse.jsonUnsafe(asset, { headers: { "cache-control": "no-store" } });
      }
      const asset = yield* assets.find(sourceEnvironmentId, attachmentId);
      const signed = yield* assets.url(asset);
      if (signed)
        return HttpServerResponse.empty({
          status: 302,
          headers: {
            location: signed,
            "cache-control": "no-store",
            "referrer-policy": "no-referrer",
          },
        });
      return HttpServerResponse.uint8Array(yield* assets.read(asset), {
        headers: {
          "content-type": asset.contentType,
          "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
          "cache-control": "private, max-age=300",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; sandbox",
        },
      });
    }),
  ).pipe(
    Effect.catchTags({
      LibraryError: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { reason: error.reason },
            {
              status:
                error.reason === "not-found"
                  ? 404
                  : error.reason === "invalid"
                    ? 400
                    : error.reason === "io"
                      ? 503
                      : 409,
            },
          ),
        ),
    }),
    Effect.orElseSucceed(() => HttpServerResponse.text("Asset unavailable", { status: 401 })),
  );
export const LibraryAssetHttpRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    return Layer.merge(
      HttpRouter.add(
        "GET",
        `${prefix}*`,
        handler("GET").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      HttpRouter.add(
        "PUT",
        `${prefix}*`,
        handler("PUT").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
    );
  }),
);
