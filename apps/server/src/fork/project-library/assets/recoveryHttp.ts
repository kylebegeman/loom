import {
  AuthLibraryPublishScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentId,
} from "@t3tools/contracts";
import { LibraryError, LibraryRecoveryManifest } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Base64Url from "effect/encoding/Base64Url";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as EnvironmentAuth from "../../../auth/EnvironmentAuth.ts";
import { ForkRuntime, withForkRuntime } from "../../ForkRuntime.ts";
import * as Recovery from "./LibraryRecoveryStore.ts";
const decodeManifest = Schema.decodeEffect(Schema.fromJsonString(LibraryRecoveryManifest));
const decodeEnvironmentId = Schema.decodeUnknownEffect(EnvironmentId);
const prefix = "/api/loom/library/recovery/";
const handler = (method: "GET" | "PUT") =>
  withForkRuntime(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const session = yield* method === "GET"
        ? auth.authenticateWebSocketUpgrade(request)
        : auth.authenticateHttpRequest(request);
      const publisher =
        session.scopes.includes(AuthLibraryPublishScope) &&
        session.subject.startsWith("loom-host:");
      if (
        (!session.scopes.includes(
          method === "GET" ? AuthOrchestrationReadScope : AuthOrchestrationOperateScope,
        ) &&
          !publisher) ||
        session.subject === "mcp-client"
      )
        return HttpServerResponse.text("Access denied", { status: 403 });
      const url = HttpServerRequest.toURL(request);
      if (Option.isNone(url)) return HttpServerResponse.text("Invalid request", { status: 400 });
      const parts = yield* Effect.try({
        try: () => url.value.pathname.slice(prefix.length).split("/").map(decodeURIComponent),
        catch: () => new LibraryError({ reason: "invalid" }),
      });
      if (
        parts.length !== 3 ||
        !parts.slice(0, 2).every((value) => /^[A-Za-z0-9._:-]{1,200}$/.test(value)) ||
        !/^[a-f0-9]{64}$/.test(parts[2]!)
      )
        return HttpServerResponse.text("Invalid recovery archive", { status: 400 });
      const sourceEnvironmentId = yield* decodeEnvironmentId(parts[0]);
      if (
        session.subject.startsWith("loom-host:") &&
        session.subject !== `loom-host:${sourceEnvironmentId}`
      )
        return HttpServerResponse.text("Access denied", { status: 403 });
      const recovery = yield* Recovery.LibraryRecoveryStore;
      if (method === "PUT") {
        const length = request.headers["content-length"] ?? "";
        if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) <= 0)
          return HttpServerResponse.text("Archive size required", { status: 411 });
        if (Number(length) > Recovery.LIBRARY_RECOVERY_MAX_BYTES)
          return HttpServerResponse.text("Recovery archive exceeds 4 GiB", { status: 413 });
        const header = request.headers["x-loom-recovery-manifest"] ?? "";
        if (header.length > 16384)
          return HttpServerResponse.text("Invalid recovery manifest", { status: 400 });
        const manifest = yield* Effect.fromResult(Base64Url.decodeString(header)).pipe(
          Effect.flatMap(decodeManifest),
          Effect.mapError(() => new LibraryError({ reason: "invalid" })),
        );
        return HttpServerResponse.jsonUnsafe(
          yield* recovery.put({
            sourceEnvironmentId,
            copyId: parts[1]!,
            sha256: parts[2]!,
            byteLength: Number(length),
            manifest,
            body: request.stream,
          }),
          { headers: { "cache-control": "no-store" } },
        );
      }
      const archive = yield* recovery.get(sourceEnvironmentId, parts[1]!, parts[2]!);
      if (archive.url)
        return HttpServerResponse.empty({
          status: 302,
          headers: {
            location: archive.url,
            "cache-control": "no-store",
            "referrer-policy": "no-referrer",
          },
        });
      return HttpServerResponse.stream(archive.body, {
        headers: {
          "content-type": "application/x-tar",
          "content-disposition": `attachment; filename="${parts[1]}.tar"`,
          "content-length": String(archive.receipt.byteLength),
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
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
    Effect.orElseSucceed(() =>
      HttpServerResponse.text("Recovery archive unavailable", { status: 401 }),
    ),
  );
export const LibraryRecoveryHttpRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    return Layer.merge(
      HttpRouter.add(
        "PUT",
        `${prefix}*`,
        handler("PUT").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
      HttpRouter.add(
        "GET",
        `${prefix}*`,
        handler("GET").pipe(Effect.provideService(ForkRuntime, runtime)),
      ),
    );
  }),
);
